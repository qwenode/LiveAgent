import { Popover } from "@base-ui/react";
import {
  Check,
  ChevronDown,
  ClaudeIcon,
  GeminiIcon,
  GrokIcon,
  OpenaiChatgptIcon,
  Search,
} from "@liveagent/app/components/icons";
import { type ModelOption, parseModelValue } from "@liveagent/app/lib/providers/llm";
import {
  type AppSettings,
  isAgentDevMode,
  isAgentExecutionMode,
  type ProviderId,
  type SelectedModel,
} from "@liveagent/app/lib/settings";
import { Button } from "@liveagent/ui/components/ui/button";
import { useLocale } from "@liveagent/ui/i18n/index";
import { cn } from "@liveagent/ui/lib/shared/utils";
import { useEffect, useId, useRef, useState } from "react";

function ProviderBrandIcon({ type, className }: { type: ProviderId; className?: string }) {
  const cls = cn("h-4 w-4 shrink-0", className);
  if (type === "claude_code") return <ClaudeIcon className={cls} />;
  if (type === "gemini") return <GeminiIcon className={cls} />;
  if (type === "xai") return <GrokIcon className={cls} />;
  return <OpenaiChatgptIcon className={cn(cls, "fill-current dark:text-white")} />;
}

export type ChatModelSelectorProps = {
  executionMode: AppSettings["system"]["executionMode"];
  hasModels: boolean;
  currentModelLabel: string;
  modelOptions: ModelOption[];
  selectedValue?: string;
  onSelectModel: (selection: SelectedModel) => void;
  // 模型下拉内嵌的执行模式分段器：请求切到 Chat("text") 或 Agent("tools")。
  // agent-dev 视为 Agent 的一种，由调用方决定是否保持不降级。
  onSelectExecutionMode: (mode: "text" | "tools") => void;
  side?: "top" | "bottom";
};

export function ChatModelSelector(props: ChatModelSelectorProps) {
  const {
    executionMode,
    hasModels,
    currentModelLabel,
    modelOptions,
    selectedValue,
    onSelectModel,
    onSelectExecutionMode,
    side = "top",
  } = props;
  const { t } = useLocale();
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const executionModeRadioName = useId();

  useEffect(() => {
    if (isModelPickerOpen) setModelSearch("");
  }, [isModelPickerOpen]);

  const normalizedSearch = modelSearch.trim().toLowerCase();
  const filteredOptions = normalizedSearch
    ? modelOptions.filter(
        (option) =>
          option.model.toLowerCase().includes(normalizedSearch) ||
          option.providerName.toLowerCase().includes(normalizedSearch),
      )
    : modelOptions;
  const selectedOption = modelOptions.find((option) => option.value === selectedValue);

  return (
    <Popover.Root open={isModelPickerOpen} onOpenChange={setIsModelPickerOpen}>
      <Popover.Trigger
        render={
          <Button
            variant="ghost"
            disabled={!hasModels}
            className={cn(
              "model-selector-trigger h-8 min-w-0 max-w-[12rem] shrink rounded-full px-2.5 py-1 cursor-pointer justify-between gap-1.5 overflow-hidden text-xs font-normal text-foreground transition-all duration-200 ease-out hover:bg-muted/60 dark:text-white disabled:pointer-events-none disabled:opacity-40",
              isModelPickerOpen && "bg-muted/60",
            )}
          />
        }
      >
        <span className="model-selector-current-label flex min-w-0 items-center gap-1.5 text-left">
          {selectedOption ? (
            <ProviderBrandIcon type={selectedOption.providerType} className="opacity-80" />
          ) : null}
          <span className="min-w-0 truncate">{currentModelLabel}</span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out dark:text-white",
            isModelPickerOpen && "rotate-180",
          )}
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side={side}
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-[9999]"
        >
          <Popover.Popup
            initialFocus={searchInputRef}
            aria-label={t("chat.selectModel")}
            className="model-selector-dropdown w-[min(18rem,calc(100vw-1rem))] overflow-hidden rounded-xl border bg-popover p-0 text-xs text-popover-foreground shadow-md outline-none"
          >
            {(() => {
              const isAgent = isAgentExecutionMode(executionMode);
              const isDev = isAgentDevMode(executionMode);
              return (
                <div className="px-2 pt-2">
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {t("settings.executionMode")}
                    </span>
                    <div
                      role="radiogroup"
                      aria-label={t("settings.executionMode")}
                      className="flex rounded-md bg-background/80 p-0.5 shadow-sm ring-1 ring-border/40"
                    >
                      <label
                        className={cn(
                          "relative cursor-pointer rounded-[5px] px-2.5 py-1 text-[11px] font-medium transition-colors has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40",
                          isAgent
                            ? "text-muted-foreground hover:text-foreground"
                            : "bg-foreground/[0.07] text-foreground",
                        )}
                      >
                        <input
                          type="radio"
                          name={executionModeRadioName}
                          value="text"
                          checked={!isAgent}
                          onChange={() => onSelectExecutionMode("text")}
                          className="sr-only"
                        />
                        Chat
                      </label>
                      <label
                        className={cn(
                          "relative cursor-pointer rounded-[5px] px-2.5 py-1 text-[11px] font-medium transition-colors has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40",
                          isAgent
                            ? "bg-foreground/[0.07] text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <input
                          type="radio"
                          name={executionModeRadioName}
                          value="tools"
                          checked={isAgent}
                          onChange={() => onSelectExecutionMode("tools")}
                          className="sr-only"
                        />
                        {isDev ? "Agent·dev" : "Agent"}
                      </label>
                    </div>
                  </div>
                </div>
              );
            })()}
            <div className="px-2 py-1.5">
              <div className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/40 px-2 py-1">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                <input
                  ref={searchInputRef}
                  value={modelSearch}
                  onChange={(event) => setModelSearch(event.target.value)}
                  placeholder={t("chat.searchModel")}
                  className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </div>
            </div>
            <div className="max-h-[min(20rem,var(--available-height,20rem))] overflow-y-auto overscroll-contain px-1 pb-1 [scrollbar-gutter:stable]">
              {filteredOptions.length === 0 ? (
                <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                  {t("chat.noModelFound")}
                </div>
              ) : (
                filteredOptions.map((option, index) => {
                  const isSelected = option.value === selectedValue;
                  const itemAnimationDelay = `${Math.min(index, 5) * 0.025}s`;
                  return (
                    <button
                      type="button"
                      key={option.value}
                      aria-pressed={isSelected}
                      onClick={() => {
                        const parsed = parseModelValue(option.value);
                        if (!parsed) return;
                        onSelectModel(parsed);
                        setIsModelPickerOpen(false);
                      }}
                      className={cn(
                        "model-selector-item flex h-[30px] w-full max-w-full shrink-0 cursor-pointer items-center justify-between gap-3 overflow-hidden rounded-md px-2 py-0 text-left text-xs font-normal leading-5 text-foreground transition-none hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 dark:text-white",
                        isSelected &&
                          "bg-foreground/[0.07] font-medium text-foreground hover:bg-foreground/[0.09] focus-visible:bg-foreground/[0.09]",
                      )}
                      style={{ animationDelay: itemAnimationDelay }}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <ProviderBrandIcon
                          type={option.providerType}
                          className={cn("opacity-70", isSelected && "opacity-100")}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          <span>{option.model}</span>
                          <span className="ml-1.5 font-normal text-muted-foreground/65 dark:text-white/55">
                            {option.providerName}
                          </span>
                        </span>
                      </span>
                      {isSelected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                    </button>
                  );
                })
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
