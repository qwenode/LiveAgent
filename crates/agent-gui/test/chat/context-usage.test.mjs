import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const usage = loader.loadModule("@liveagent/ui/lib/chat/contextUsage.ts");
const controllerModule = loader.loadModule("src/lib/chat/compaction/controller.ts");
const conversationState = loader.loadModule("src/lib/chat/conversation/conversationState.ts");

const { CompactionController } = controllerModule;

function user(content, timestamp = 1) {
  return { role: "user", content, timestamp };
}

test("context usage ratio and levels use the shared warning thresholds", () => {
  assert.equal(usage.contextUsageRatio(undefined, 100), 0);
  assert.equal(usage.contextUsageRatio(25, 0), 0);
  assert.equal(usage.contextUsageRatio(50, 100), 0.5);
  assert.equal(usage.contextUsageLevel(0.49), "ok");
  assert.equal(usage.contextUsageLevel(0.5), "warn");
  assert.equal(usage.contextUsageLevel(0.8), "danger");
  assert.equal(usage.contextUsageLevel(1.25), "danger");
  assert.equal(usage.canManualCompact(0.49), false);
  assert.equal(usage.canManualCompact(0.5), true);
});

test("compaction controller exposes reactive read-only usage after ledger rebases", () => {
  const controller = new CompactionController();
  const state = conversationState.createConversationStateFromContext({
    systemPrompt: "system",
    messages: [user("first message")],
  });
  const firstContext = conversationState.buildRequestContext(state);
  let notifications = 0;
  const unsubscribe = controller.subscribeContextUsage(() => {
    notifications += 1;
  });

  controller.beginRequest(firstContext, state);
  const firstTotal = controller.contextUsageTokens;
  assert.equal(notifications, 1);
  assert.ok(typeof firstTotal === "number" && firstTotal > 0);
  assert.equal(controller.contextUsageSnapshot.totalTokens, firstTotal);

  controller.beginRequest(
    { ...firstContext, messages: [...firstContext.messages, user("second message", 2)] },
    state,
  );
  assert.equal(notifications, 2);
  assert.ok(controller.contextUsageTokens > firstTotal);

  unsubscribe();
  controller.beginRequest(firstContext, state);
  assert.equal(notifications, 2);
});

test("desktop ChatPage and shared composer wire the controller-backed read-only ring", () => {
  const chatPage = readFileSync(
    fileURLToPath(new URL("../../src/pages/ChatPage.tsx", import.meta.url)),
    "utf8",
  );
  const composer = readFileSync(
    fileURLToPath(new URL("../../../agent-ui/src/pages/chat/ChatComposerBar.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(chatPage, /contextUsageTokensSource=\{contextUsageTokensSource\}/);
  assert.match(chatPage, /contextWindow=\{currentModelContextWindow\}/);
  assert.match(composer, /useSyncExternalStore/);
  assert.match(composer, /<ContextUsageRing/);
});
