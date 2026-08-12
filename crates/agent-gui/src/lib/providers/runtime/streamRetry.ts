import {
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  isRetryableAssistantError,
} from "@earendil-works/pi-ai";

/** 6 total attempts = 5 retries after the initial try — matches codex's stream_max_retries=5. */
export const DEFAULT_STREAM_RETRY_MAX_ATTEMPTS = 6;
export const EMPTY_ASSISTANT_RESPONSE_ERROR = "Upstream returned an empty response";

export function isEmptyAssistantResponseError(errorMessage: string | undefined): boolean {
  return errorMessage === EMPTY_ASSISTANT_RESPONSE_ERROR;
}

export type RetryAttemptRecord = {
  attempt: number;
  maxAttempts: number;
  errorMessage: string;
};

const STREAM_RETRY_BASE_DELAY_MS = 200;
const STREAM_RETRY_BACKOFF_FACTOR = 2;

export type StreamRetryConfig = {
  maxAttempts?: number;
  disabled?: boolean;
  /**
   * Retry ordinal (1..maxRetries) about to be attempted, invoked before the
   * backoff sleep. `errorMessage` is the failure that triggered this retry.
   */
  onRetry?: (attempt: number, maxAttempts: number, errorMessage: string) => void;
  /** Invoked once a retried attempt commits its first content-bearing event. */
  onRetryRecovered?: () => void;
};

export type StreamRetryOptions = StreamRetryConfig & {
  signal?: AbortSignal;
  /** Used to synthesize a terminal message when the stream fails before emitting one. */
  model?: {
    api: AssistantMessage["api"];
    provider: AssistantMessage["provider"];
    id: string;
  };
};

type TerminalEvent = Extract<AssistantMessageEvent, { type: "done" | "error" }>;

function isCommittingEvent(event: AssistantMessageEvent): boolean {
  if (event.type === "text_delta" || event.type === "thinking_delta") {
    return event.delta.trim().length > 0;
  }
  return event.type === "toolcall_start";
}

// A terminal-less EOF is a transport truncation, not a semantic provider error.
// Some relays collapse the useful EOF detail into `stream_error: no message`, so
// recognize both the generic stream error code and known SDK terminal-less text.
// The pre-commit guard in withStreamRetry remains the safety boundary against
// duplicated output/tool calls.
const RETRYABLE_PREMATURE_STREAM_END_ERROR_PATTERN = new RegExp(
  [
    "\\bstream_error\\b",
    "unexpected\\s*EOF",
    "OpenAI Responses stream ended before a terminal response event",
    "stream ended without (?:a )?terminal event(?: or completed response)?",
  ].join("|"),
  "i",
);

export function isRetryablePrematureStreamEndError(errorMessage: string | undefined): boolean {
  return RETRYABLE_PREMATURE_STREAM_END_ERROR_PATTERN.test(errorMessage ?? "");
}

function isTerminalEvent(event: AssistantMessageEvent): event is TerminalEvent {
  return event.type === "done" || event.type === "error";
}

function hasMeaningfulAssistantContent(message: AssistantMessage): boolean {
  return message.content.some((block) => {
    if (block.type === "text") return block.text.trim().length > 0;
    if (block.type === "thinking") return block.thinking.trim().length > 0;
    // Tool calls and any future provider-specific block types are meaningful.
    return true;
  });
}

function isCleanEmptyAssistantResponse(message: AssistantMessage): boolean {
  return (
    message.stopReason !== "error" &&
    message.stopReason !== "aborted" &&
    !hasMeaningfulAssistantContent(message)
  );
}

function buildEmptyAssistantResponseError(message: AssistantMessage): AssistantMessage {
  return {
    ...message,
    content: [],
    stopReason: "error",
    errorMessage: EMPTY_ASSISTANT_RESPONSE_ERROR,
  };
}

function isRetryableStreamMessage(message: AssistantMessage): boolean {
  return (
    isRetryableAssistantError(message) ||
    (message.stopReason === "error" && isRetryablePrematureStreamEndError(message.errorMessage))
  );
}

function eventAssistantMessage(event: AssistantMessageEvent): AssistantMessage {
  if (event.type === "done") return event.message;
  if (event.type === "error") return event.error;
  return event.partial;
}

function readStreamFailureMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim() || error.name || "Unknown error";
  const message = String(error).trim();
  return message || "Unknown error";
}

function isAbortStreamFailure(error: unknown, signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) return false;
  if (error === signal.reason) return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  const message = readStreamFailureMessage(error);
  return /\b(?:abort(?:ed)?|cancel(?:led|ed)?)\b/i.test(message);
}

function buildStreamFailureAssistantMessage(
  error: unknown,
  lastMessage: AssistantMessage | undefined,
  options: StreamRetryOptions | undefined,
): AssistantMessage {
  const aborted = isAbortStreamFailure(error, options?.signal);
  const effectiveError = aborted ? (options?.signal?.reason ?? error) : error;
  return {
    role: "assistant",
    content: lastMessage?.content ?? [],
    api: lastMessage?.api ?? options?.model?.api ?? "anthropic-messages",
    provider: lastMessage?.provider ?? options?.model?.provider ?? "anthropic",
    model: lastMessage?.model ?? options?.model?.id ?? "unknown",
    usage: lastMessage?.usage ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: aborted ? "aborted" : "error",
    errorMessage: readStreamFailureMessage(effectiveError),
    timestamp: lastMessage?.timestamp ?? Date.now(),
  };
}

function pushStreamFailure(output: AssistantMessageEventStream, message: AssistantMessage): void {
  const error = {
    ...message,
    stopReason: message.stopReason === "aborted" ? "aborted" : "error",
  } satisfies AssistantMessage;
  output.push({ type: "error", reason: error.stopReason, error });
  output.end(error);
}

/** Codex-style backoff: base * factor^(attempt-1) * uniform(0.9, 1.1), uncapped. */
export function computeStreamRetryBackoffMs(attempt: number): number {
  const base = STREAM_RETRY_BASE_DELAY_MS * STREAM_RETRY_BACKOFF_FACTOR ** (attempt - 1);
  return base * (0.9 + Math.random() * 0.2);
}

function sleepWithAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Wraps a fresh-stream factory with attempt-scoped retry for transient
 * provider/transport failures and clean responses with no meaningful content.
 *
 * Events are buffered per attempt until the first content-bearing event
 * ("committed": text_delta / thinking_delta / toolcall_start) is observed. An
 * attempt that fails before committing, or completes cleanly with empty
 * content, is discarded wholesale and replaced by a fresh `factory()` call
 * after a codex-style backoff — the caller never sees the discarded attempt's
 * events. Once committed, events pass straight through untouched. A clean
 * empty response that exhausts or disables retries is converted into an
 * explicit error rather than silently succeeding. `onRetry` /
 * `onRetryRecovered` let callers surface an ephemeral "reconnecting" status
 * in place of the frozen UI, mirroring codex's TUI behavior.
 *
 * The pump below runs eagerly (not gated on the returned stream being
 * iterated) because pi-ai's own stream factories start their network work as
 * soon as they're called, independent of consumer iteration — some callers
 * only await `.result()` without ever iterating events, and that pattern must
 * keep working through this wrapper.
 */
export function withStreamRetry(
  factory: () => AssistantMessageEventStream,
  options?: StreamRetryOptions,
): AssistantMessageEventStream {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? DEFAULT_STREAM_RETRY_MAX_ATTEMPTS);
  const disabled = options?.disabled ?? false;
  const signal = options?.signal;

  const output = createAssistantMessageEventStream();

  void (async () => {
    let attempt = 1;
    let hasRetried = false;

    while (true) {
      let committed = false;
      const buffered: AssistantMessageEvent[] = [];
      let terminal: TerminalEvent | undefined;
      let lastMessage: AssistantMessage | undefined;
      let result: AssistantMessage | undefined;
      let thrownFailure: AssistantMessage | undefined;

      try {
        // Keep factory creation inside the attempt boundary: provider SDKs can
        // throw synchronously before returning an event stream.
        const source = factory();
        for await (const event of source) {
          lastMessage = eventAssistantMessage(event);
          if (!committed && isCommittingEvent(event)) {
            committed = true;
            for (const bufferedEvent of buffered.splice(0)) output.push(bufferedEvent);
            if (hasRetried) {
              hasRetried = false;
              options?.onRetryRecovered?.();
            }
          }
          if (committed) {
            output.push(event);
          } else {
            buffered.push(event);
          }
          if (isTerminalEvent(event)) terminal = event;
        }

        // Some stream adapters only expose their terminal failure via result(),
        // while malformed transports may reject result() outright.
        result = await source.result();
        lastMessage = result;
      } catch (error) {
        thrownFailure = buildStreamFailureAssistantMessage(error, lastMessage, options);
      }

      const emptyResponse = Boolean(result && !committed && isCleanEmptyAssistantResponse(result));
      const resultFailure =
        result?.stopReason === "error" || result?.stopReason === "aborted" ? result : undefined;
      const retryFailure = thrownFailure ?? resultFailure;
      const retryErrorMessage = emptyResponse
        ? EMPTY_ASSISTANT_RESPONSE_ERROR
        : !committed && retryFailure && isRetryableStreamMessage(retryFailure)
          ? retryFailure.errorMessage || "Unknown error"
          : undefined;

      if (retryErrorMessage && !disabled && attempt < maxAttempts) {
        options?.onRetry?.(attempt, maxAttempts - 1, retryErrorMessage);
        hasRetried = true;
        try {
          await sleepWithAbort(computeStreamRetryBackoffMs(attempt), signal);
          attempt += 1;
          continue;
        } catch {
          // Preserve the failure that triggered the retry. This matches the
          // terminal-event path and avoids reporting a different error solely
          // because cancellation happened during the backoff sleep.
        }
      }

      if (emptyResponse && result) {
        const error = buildEmptyAssistantResponseError(result);
        output.push({ type: "error", reason: "error", error });
        output.end(error);
        return;
      }

      if (!committed) {
        for (const bufferedEvent of buffered) output.push(bufferedEvent);
      }

      if (thrownFailure) {
        pushStreamFailure(output, thrownFailure);
        return;
      }

      if (resultFailure && terminal === undefined) {
        pushStreamFailure(output, resultFailure);
        return;
      }

      if (result) {
        // output.end() is idempotent once a terminal event has already been
        // pushed above, so this also safety-nets terminal-less test doubles.
        output.end(result);
        return;
      }

      pushStreamFailure(
        output,
        buildStreamFailureAssistantMessage(
          new Error("Stream ended without a result"),
          lastMessage,
          options,
        ),
      );
      return;
    }
  })();

  return output;
}
