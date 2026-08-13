import type { TranscriptRow } from "./transcript/types";

/**
 * Derive the latest observed context usage from transcript rows.
 *
 * This is intentionally display-only: the desktop CompactionController and
 * TokenLedger remain the authoritative accounting source. Gateway Web can
 * render the latest assistant usage already present in the transcript without
 * introducing a second compaction state machine.
 */
export function deriveGatewayContextUsageTokens(
  rows: readonly TranscriptRow[],
): number | undefined {
  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const row = rows[rowIndex];
    if (!row) {
      continue;
    }
    if (row.kind === "checkpoint") {
      if (typeof row.contextUsageTokens === "number" && Number.isFinite(row.contextUsageTokens)) {
        return Math.max(0, Math.floor(row.contextUsageTokens));
      }
      continue;
    }
    if (row.kind !== "assistant") {
      continue;
    }
    for (let roundIndex = row.rounds.length - 1; roundIndex >= 0; roundIndex -= 1) {
      const meta = row.rounds[roundIndex]?.meta as
        | {
            contextUsageTokens?: unknown;
            contextRelevant?: unknown;
            usageTotalTokens?: unknown;
            usage?: { totalTokens?: unknown };
          }
        | undefined;
      if (meta?.contextRelevant === false) continue;
      const contextUsageTokens =
        typeof meta?.contextUsageTokens === "number" ? meta.contextUsageTokens : undefined;
      if (contextUsageTokens !== undefined && Number.isFinite(contextUsageTokens)) {
        return Math.max(0, Math.floor(contextUsageTokens));
      }
      const usageTotalTokens =
        typeof meta?.usageTotalTokens === "number"
          ? meta.usageTotalTokens
          : typeof meta?.usage?.totalTokens === "number"
            ? meta.usage.totalTokens
            : undefined;
      if (usageTotalTokens !== undefined && Number.isFinite(usageTotalTokens)) {
        return Math.max(0, Math.floor(usageTotalTokens));
      }
    }
  }
  return undefined;
}
