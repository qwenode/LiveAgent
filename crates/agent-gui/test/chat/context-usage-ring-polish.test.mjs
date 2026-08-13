import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ringSource = readFileSync(
  new URL("../../../agent-ui/src/components/chat/ContextUsageRing.tsx", import.meta.url),
  "utf8",
);
const tooltipSource = readFileSync(
  new URL("../../../agent-ui/src/components/ui/label-tooltip.tsx", import.meta.url),
  "utf8",
);
const guiCss = readFileSync(new URL("../../src/index.css", import.meta.url), "utf8");
const gatewayCss = readFileSync(
  new URL("../../../agent-gateway/web/src/styles.css", import.meta.url),
  "utf8",
);

test("context usage ring has touch-safe two-line tooltip and reduced-motion polish", () => {
  assert.match(ringSource, /matchMedia\("\(hover: none\), \(pointer: coarse\)"\)/);
  assert.match(ringSource, /useState\(false\)/);
  assert.match(ringSource, /usageLine/);
  assert.match(ringSource, /windowLine/);
  assert.match(ringSource, /closeOnClick=\{!isCoarsePointer\}/);
  assert.match(ringSource, /onClick=\{\(\) => setTooltipOpen\(\(open\) => !open\)\}/);
  assert.match(ringSource, /focus-visible:ring-2/);
  assert.match(ringSource, /motion-reduce:transition-none/);
  assert.match(ringSource, /aria-hidden="true" className="relative"/);
});

test("LabelTooltip exposes controlled open state and animated host styling", () => {
  assert.match(tooltipSource, /open\?: boolean/);
  assert.match(tooltipSource, /onOpenChange\?: \(open: boolean\) => void/);
  assert.match(tooltipSource, /closeOnClick\?: boolean/);
  assert.match(tooltipSource, /label-tooltip-popup/);
  assert.match(guiCss, /\.label-tooltip-popup\[data-starting-style\]/);
  assert.match(guiCss, /\.label-tooltip-popup\[data-ending-style\]/);
  assert.match(guiCss, /\.label-tooltip-popup[\s\S]*transition:/);
  assert.match(gatewayCss, /\.label-tooltip-popup\[data-starting-style\]/);
  assert.match(gatewayCss, /\.label-tooltip-popup\[data-ending-style\]/);
  assert.match(gatewayCss, /\.label-tooltip-popup[\s\S]*transition:/);
});
