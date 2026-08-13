import type { AssistantMessage, Message } from "@earendil-works/pi-ai";

/** Persisted message-level context usage anchor shared by desktop and Gateway Web. */
export const LIVEAGENT_CONTEXT_USAGE_FIELD = "liveAgentContextUsage" as const;

export type MessageContextUsage = {
  totalTokens: number;
  fixedTokens: number;
};

type MessageWithContextUsage = Message & {
  [LIVEAGENT_CONTEXT_USAGE_FIELD]?: unknown;
};

function positiveTokenCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

export function readMessageContextUsage(message: Message): MessageContextUsage | undefined {
  const raw = (message as MessageWithContextUsage)[LIVEAGENT_CONTEXT_USAGE_FIELD];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const totalTokens = positiveTokenCount(record.totalTokens);
  if (totalTokens === undefined) {
    return undefined;
  }
  return {
    totalTokens,
    fixedTokens: positiveTokenCount(record.fixedTokens) ?? 0,
  };
}

/**
 * Write only usage-derived, authoritative values. Estimates must never be
 * persisted as anchors because an anchor intentionally outlives the current
 * runtime and would otherwise mask a later provider usage observation.
 */
export function writeAssistantContextUsage(
  message: AssistantMessage,
  usage: MessageContextUsage,
): void {
  (message as MessageWithContextUsage)[LIVEAGENT_CONTEXT_USAGE_FIELD] = {
    totalTokens: Math.max(1, Math.floor(usage.totalTokens)),
    fixedTokens: Math.max(0, Math.floor(usage.fixedTokens)),
  };
}
