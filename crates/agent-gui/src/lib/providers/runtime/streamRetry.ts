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

function terminalMessage(event: TerminalEvent) {
  return event.type === "done" ? event.message : event.error;
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

function isRetryableStreamError(event: TerminalEvent): boolean {
  const message = terminalMessage(event);
  return (
    isRetryableAssistantError(message) ||
    (message.stopReason === "error" && isRetryablePrematureStreamEndError(message.errorMessage))
  );
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
  const firstSource = factory();

  void (async () => {
    let attempt = 1;
    let source = firstSource;
    let hasRetried = false;

    while (true) {
      let committed = false;
      const buffered: AssistantMessageEvent[] = [];
      let terminal: TerminalEvent | undefined;

      for await (const event of source) {
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

      // Some streams (notably minimal test doubles) never yield a terminal
      // done/error event through iteration and only expose the final message
      // via result(), so empty-response detection must inspect the result too.
      const result = await source.result();
      const emptyResponse = !committed && isCleanEmptyAssistantResponse(result);
      const retryErrorMessage = emptyResponse
        ? EMPTY_ASSISTANT_RESPONSE_ERROR
        : terminal?.type === "error" && !committed && isRetryableStreamError(terminal)
          ? terminalMessage(terminal).errorMessage || "Unknown error"
          : undefined;

      if (retryErrorMessage && !disabled && attempt < maxAttempts) {
        attempt += 1;
        options?.onRetry?.(attempt - 1, maxAttempts - 1, retryErrorMessage);
        hasRetried = true;
        try {
          await sleepWithAbort(computeStreamRetryBackoffMs(attempt - 1), signal);
          source = factory();
          continue;
        } catch {
          // Aborted mid-backoff, or the next attempt failed to start —
          // surface the prior attempt's real failure below instead of
          // hanging the consumer on a retry that will never happen.
        }
      }

      if (emptyResponse) {
        const error = buildEmptyAssistantResponseError(result);
        output.push({ type: "error", reason: "error", error });
        output.end(error);
        return;
      }

      if (!committed) {
        for (const bufferedEvent of buffered) output.push(bufferedEvent);
      }
      // output.end() is idempotent once a terminal event has already been
      // pushed above, so this also safety-nets terminal-less test doubles.
      output.end(result);
      return;
    }
  })();

  return output;
}
