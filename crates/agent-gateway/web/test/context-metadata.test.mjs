import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createWebModuleLoader } from "../../test/helpers/load-web-module.mjs";

const loader = createWebModuleLoader({
  rootDir: fileURLToPath(new URL("../", import.meta.url)),
});
const { parseHistoryMessagesJson } = loader.loadModule("src/lib/chatUi.ts");
const { createTurn, applyEventToTurn } = loader.loadModule("src/lib/chat/transcript/turnReducer.ts");
const { buildRowsFromEntries } = loader.loadModule("src/lib/chat/transcript/rows.ts");
const { deriveGatewayContextUsageTokens } = loader.loadModule("src/lib/chat/contextUsage.ts");

test("stream token metadata survives reducer and row construction", () => {
  let turn = createTurn({ key: "run:metadata", runId: "run-metadata" });
  turn = applyEventToTurn(turn, {
    type: "token",
    text: "answer",
    round: 1,
    contextUsageTokens: 4321,
    contextRelevant: true,
  });
  const rows = buildRowsFromEntries(turn.entries, "stream");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "assistant");
  assert.equal(rows[0].rounds[0].meta.contextUsageTokens, 4321);
  assert.equal(deriveGatewayContextUsageTokens(rows), 4321);
});

test("render-only metadata does not become the context usage anchor", () => {
  let turn = createTurn({ key: "run:render-only", runId: "run-render-only" });
  turn = applyEventToTurn(turn, {
    type: "token",
    text: "memory extraction",
    round: 1,
    contextUsageTokens: 9999,
    contextRelevant: false,
  });
  const rows = buildRowsFromEntries(turn.entries, "stream");
  assert.equal(deriveGatewayContextUsageTokens(rows), undefined);
});

test("history metadata restores the persisted context usage anchor", () => {
  const entries = parseHistoryMessagesJson(
    JSON.stringify([
      { role: "user", id: "u1", content: "question" },
      {
        role: "assistant",
        content: [{ type: "text", text: "answer" }],
        provider: "anthropic",
        model: "claude",
        usage: { input: 100, output: 10, totalTokens: 110 },
        liveAgentContextUsage: { totalTokens: 8765, fixedTokens: 123 },
      },
    ]),
  );
  const assistant = entries.find((entry) => entry.kind === "assistant" && entry.text === "answer");
  assert.ok(assistant);
  assert.equal(assistant.meta.contextUsageTokens, 8765);
  const rows = buildRowsFromEntries(entries, "history");
  assert.equal(deriveGatewayContextUsageTokens(rows), 8765);
});

test("checkpoint context usage is preserved and preferred over ordinary usage", () => {
  const entries = parseHistoryMessagesJson(
    JSON.stringify([
      {
        role: "summary",
        id: "sum-1",
        content: "checkpoint",
        timestamp: 1,
        summaryMeta: {
          coveredMessageCount: 2,
          generatedBy: { providerId: "liveagent", model: "summary" },
          stats: { sourceMessageCount: 2, contextTokensAfter: 6543 },
        },
      },
    ]),
  );
  assert.equal(entries[0].contextUsageTokens, 6543);
  const rows = buildRowsFromEntries(entries, "history");
  assert.equal(rows[0].contextUsageTokens, 6543);
});
