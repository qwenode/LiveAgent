import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createWebModuleLoader } from "../helpers/load-web-module.mjs";

const loader = createWebModuleLoader();
const usage = loader.loadModule("@/lib/chat/contextUsage.ts");

function assistantRow(rounds) {
  return { key: "assistant-1", origin: "history", kind: "assistant", rounds };
}

test("Gateway context usage derives the latest assistant total token count", () => {
  const rows = [
    assistantRow([
      { round: 1, blocks: [{ kind: "text", id: "t1", text: "old" }], meta: { usageTotalTokens: 12 } },
      { round: 2, blocks: [{ kind: "text", id: "t2", text: "new" }], meta: { usage: { totalTokens: 42 } } },
    ]),
  ];
  assert.equal(usage.deriveGatewayContextUsageTokens(rows), 42);
});

test("GatewayApp passes context usage data to the shared composer ring", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../web/src/app/GatewayApp.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(source, /contextUsageTokens=\{gatewayContextUsageTokens\}/);
  assert.match(source, /contextWindow=\{currentModelContextWindow\}/);
});

test("GatewayApp wires the read-only ring and manual compact command in every execution mode", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../web/src/app/GatewayApp.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(source, /contextUsageTokens=\{gatewayContextUsageTokens\}/);
  assert.match(source, /contextWindow=\{currentModelContextWindow\}/);
  assert.match(source, /onManualCompactConfirm=\{handleManualCompact\}/);
  assert.match(source, /commandType: "chat\.compact"/);
  assert.match(source, /const composerRuntimeDisabled =/);
  assert.match(source, /const composerInputDisabled = composerRuntimeDisabled/);
  assert.match(source, /: transcriptToolStatusIsCompaction\s*\? translate\("chat\.compactingContextWait"/);
  assert.doesNotMatch(source, /isAgentDevExecutionMode\s*\?\s*handleManualCompact/);
  assert.doesNotMatch(source, /const composerInputDisabled =[\s\S]{0,180}composerCompactionBlocked;/);
});

test("Gateway context usage prefers the latest checkpoint total after compaction", () => {
  assert.equal(
    usage.deriveGatewayContextUsageTokens([
      assistantRow([{ round: 1, blocks: [{ kind: "text", id: "t1", text: "x" }], meta: { usageTotalTokens: 12 } }]),
      { key: "checkpoint-1", origin: "history", kind: "checkpoint", content: "summary", summaryId: "s1", coveredMessageCount: 1, contextUsageTokens: 88, generatedBy: { providerId: "p", model: "m" } },
    ]),
    88,
  );
});

test("Gateway context usage ignores non-finite or missing usage", () => {
  assert.equal(
    usage.deriveGatewayContextUsageTokens([
      assistantRow([{ round: 1, blocks: [{ kind: "text", id: "t1", text: "x" }], meta: { usageTotalTokens: NaN } }]),
      { key: "checkpoint-1", origin: "history", kind: "checkpoint", content: "summary", summaryId: "s1", coveredMessageCount: 1, generatedBy: { providerId: "p", model: "m" } },
    ]),
    undefined,
  );
});
