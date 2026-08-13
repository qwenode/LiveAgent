export const CONTEXT_USAGE_WARN_RATIO = 0.5;
export const CONTEXT_USAGE_DANGER_RATIO = 0.8;

export { positiveTokenCount } from "./contextUsageMetadata";

export type ContextUsageLevel = "ok" | "warn" | "danger";

export function contextUsageRatio(
  totalTokens: number | undefined,
  contextWindow: number | undefined,
): number {
  if (
    typeof totalTokens !== "number" ||
    !Number.isFinite(totalTokens) ||
    totalTokens <= 0 ||
    typeof contextWindow !== "number" ||
    !Number.isFinite(contextWindow) ||
    contextWindow <= 0
  ) {
    return 0;
  }
  return totalTokens / contextWindow;
}

export function contextUsageLevel(ratio: number): ContextUsageLevel {
  if (ratio >= CONTEXT_USAGE_DANGER_RATIO) return "danger";
  if (ratio >= CONTEXT_USAGE_WARN_RATIO) return "warn";
  return "ok";
}

export function canManualCompact(ratio: number): boolean {
  return ratio >= CONTEXT_USAGE_WARN_RATIO;
}
