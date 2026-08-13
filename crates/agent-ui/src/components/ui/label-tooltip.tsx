import { Tooltip } from "@base-ui/react";
import type { ReactNode } from "react";

/**
 * Compact label tooltip shared by small runtime controls.
 * Callers that need touch-friendly behavior can control `open` and disable
 * the trigger's close-on-click behavior so their click handler owns toggling.
 */
export function LabelTooltip(props: {
  label: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  closeOnClick?: boolean;
  children: ReactNode;
}) {
  const { onOpenChange } = props;
  return (
    <Tooltip.Root
      open={props.open}
      onOpenChange={onOpenChange ? (open) => onOpenChange(open) : undefined}
    >
      <Tooltip.Trigger
        delay={0}
        closeOnClick={props.closeOnClick ?? true}
        render={<span className="inline-flex shrink-0">{props.children}</span>}
      />
      <Tooltip.Portal>
        <Tooltip.Positioner
          side="top"
          align="center"
          sideOffset={6}
          collisionPadding={8}
          className="z-[9999]"
        >
          <Tooltip.Popup className="label-tooltip-popup max-w-64 rounded-xl border border-border/60 bg-popover px-3 py-2 text-xs font-medium leading-4 text-popover-foreground shadow-lg outline-hidden">
            {props.label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
