import { Meter } from "@base-ui/react";
import { useLocale } from "@liveagent/ui/i18n/index";
import { cn } from "@liveagent/ui/lib/shared/utils";
import {
  contextUsageLevel,
  contextUsageRatio,
} from "../../lib/chat/contextUsage";

const RING_STROKE_BY_LEVEL = {
  ok: "stroke-emerald-500 dark:stroke-emerald-400",
  warn: "stroke-amber-500 dark:stroke-amber-400",
  danger: "stroke-red-500 dark:stroke-red-400",
} as const;

const tokenFormatterByLocale = new Map<string, Intl.NumberFormat>();

function getTokenFormatter(locale: string): Intl.NumberFormat {
  const cached = tokenFormatterByLocale.get(locale);
  if (cached) return cached;
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  tokenFormatterByLocale.set(locale, formatter);
  return formatter;
}

export function ContextUsageRing(props: {
  totalTokens?: number;
  contextWindow?: number;
  className?: string;
}) {
  const { totalTokens, contextWindow, className } = props;
  const { t, locale } = useLocale();
  if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return null;
  }

  const ratio = contextUsageRatio(totalTokens, contextWindow);
  const displayedPercentage = Math.min(999, Math.round(ratio * 100));
  const clampedPercentage = Math.min(100, ratio * 100);
  const formatTokens = getTokenFormatter(locale);
  const usageLabel = `${displayedPercentage}% · ${t("chat.usageTotal")} ${formatTokens.format(
    Math.max(0, Math.floor(totalTokens ?? 0)),
  )} · ${t("chat.contextWindow")} ${formatTokens.format(contextWindow)}`;

  return (
    <span
      className={cn(
        "inline-flex h-8 w-8 shrink-0 cursor-default items-center justify-center opacity-90",
        className,
      )}
      title={usageLabel}
      aria-label={usageLabel}
    >
      <Meter.Root
        value={clampedPercentage}
        aria-valuetext={usageLabel}
        className="relative flex h-8 w-8 items-center justify-center text-[8px] font-semibold leading-none tabular-nums text-foreground/75"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="absolute inset-0 h-8 w-8 -rotate-90">
          <circle
            cx="12"
            cy="12"
            r="9.5"
            fill="none"
            strokeWidth="2.25"
            className="stroke-foreground/10 dark:stroke-white/10"
          />
          <circle
            cx="12"
            cy="12"
            r="9.5"
            fill="none"
            pathLength="100"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeDasharray="100"
            strokeDashoffset={100 - clampedPercentage}
            className={cn(
              "transition-[stroke-dashoffset,stroke] duration-300",
              RING_STROKE_BY_LEVEL[contextUsageLevel(ratio)],
            )}
          />
        </svg>
        <span className="relative">{displayedPercentage}%</span>
      </Meter.Root>
    </span>
  );
}
