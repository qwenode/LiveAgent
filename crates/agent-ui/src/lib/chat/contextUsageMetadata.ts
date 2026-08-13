/** Optional context-usage metadata carried by live assistant/checkpoint events. */
export type ContextUsageMetadata = {
  /** Authoritative context tokens observed after the message/round. */
  contextUsageTokens?: number;
  /** False for render-only assistant work that must not anchor the usage ring. */
  contextRelevant?: boolean;
};

export function positiveTokenCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

/** Normalize both camelCase and gateway-style snake_case payloads. */
export function normalizeContextUsageMetadata(raw: unknown): ContextUsageMetadata | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const contextUsageTokens = positiveTokenCount(
    record.contextUsageTokens ?? record.context_usage_tokens,
  );
  const contextRelevant =
    typeof record.contextRelevant === "boolean"
      ? record.contextRelevant
      : typeof record.context_relevant === "boolean"
        ? record.context_relevant
        : undefined;
  if (contextUsageTokens === undefined && contextRelevant === undefined) {
    return undefined;
  }
  return {
    ...(contextUsageTokens === undefined ? {} : { contextUsageTokens }),
    ...(contextRelevant === undefined ? {} : { contextRelevant }),
  };
}
