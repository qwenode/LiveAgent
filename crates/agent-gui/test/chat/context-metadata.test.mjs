import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const controllerModule = loader.loadModule("src/lib/chat/compaction/controller.ts");
const conversationState = loader.loadModule("src/lib/chat/conversation/conversationState.ts");
const cancellationModule = loader.loadModule("src/lib/chat/conversation/turnCancellation.ts");

const { CompactionController } = controllerModule;

function usage(totalTokens) {
  return {
    input: totalTokens,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistant(totalTokens) {
  return {
    role: "assistant",
    content: [{ type: "text", text: "answer" }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude",
    stopReason: "stop",
    usage: usage(totalTokens),
    timestamp: 2,
  };
}

function stateWithAssistant(message) {
  return conversationState.createConversationStateFromContext({
    systemPrompt: "sys",
    messages: [
      { role: "user", content: "question", timestamp: 1 },
      message,
    ],
  });
}

function binding() {
  const cancellation = cancellationModule.createTurnCancellation();
  return {
    providerId: "anthropic",
    model: "claude",
    runtime: {
      baseUrl: "https://example",
      apiKey: "key",
      modelConfig: { contextWindow: 200_000, maxOutputToken: 32_000 },
    },
    cancellation,
    sinks: {},
    buildPreparedContext: (state, _tools, options) =>
      conversationState.buildRequestContext(state, options),
    buildResumeContext: (state, resumeMessage, _tools, options) => {
      const context = conversationState.buildRequestContext(state, options);
      return resumeMessage ? { ...context, messages: [...context.messages, resumeMessage] } : context;
    },
  };
}

test("observeContextMessages persists an authoritative anchor and updates the shared ledger", () => {
  const controller = new CompactionController();
  const message = assistant(1234);
  const state = stateWithAssistant({ role: "user", content: "question", timestamp: 1 });
  controller.bindTurn(binding());
  controller.beginRequest(conversationState.buildRequestContext(state), state);
  const notifications = [];
  controller.subscribeContextUsage(() => notifications.push(controller.contextUsageTokens));

  const observed = controller.observeContextMessages([message]);

  assert.equal(observed, 1234);
  assert.equal(message.liveAgentContextUsage.totalTokens, 1234);
  assert.ok(notifications.length >= 1);
  assert.equal(controller.contextUsageTokens, 1234);
});

test("summary timeline accepts persisted contextTokensAfter metadata", () => {
  const message = assistant(1234);
  const state = stateWithAssistant(message);
  const summary = {
    role: "summary",
    id: "summary-1",
    timestamp: 3,
    content: "checkpoint",
    summaryMeta: {
      format: "plain-text-v1",
      strategy: "cumulative-checkpoint",
      coversThroughMessageId: "m1",
      coveredMessageCount: 2,
      generatedBy: { providerId: "liveagent", model: "summary" },
      stats: { sourceMessageCount: 2, contextTokensAfter: 9876 },
    },
  };
  const next = { ...state, segments: [{ ...state.segments[0], summary }] };
  const timeline = next.transcript.items;
  assert.ok(Array.isArray(timeline));
  assert.equal(next.segments[0].summary.summaryMeta.stats.contextTokensAfter, 9876);
});
