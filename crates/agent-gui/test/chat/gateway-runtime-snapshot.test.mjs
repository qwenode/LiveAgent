import assert from "node:assert/strict";
import test from "node:test";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();

const { buildGatewayFinalProjectionEntries, buildGatewayRuntimeSnapshotEntries } = loader.loadModule(
  "src/pages/chat/gateway/chatRuntimeSnapshot.ts",
);
const { buildGatewayToolCallPreviewArguments } = loader.loadModule(
  "src/pages/chat/turns/gatewayToolPreview.ts",
);
const toolPreview = loader.loadModule("src/lib/chat/messages/toolPreview.ts");
const askTools = loader.loadModule("src/lib/tools/askUserQuestionTools.ts");
const askShared = loader.loadModule("@liveagent/ui/lib/chat/askUserQuestion.ts");

test("gateway runtime snapshot projects live rounds into chat entries", () => {
  const entries = buildGatewayRuntimeSnapshotEntries({
    userMessage: {
      role: "user",
      id: "user-1",
      content: "Run the checks",
    },
    liveTranscript: {
      draftAssistantText: "",
      toolStatus: "Running shell",
      retryAttempts: [
        { attempt: 1, maxAttempts: 3, errorMessage: "temporary network failure" },
      ],
      liveRounds: [
        {
          key: "round-1",
          round: 1,
          meta: {
            contextUsageTokens: 321,
            contextRelevant: true,
            usageTotalTokens: 300,
          },
          runningToolCallIds: [],
          thinkingOpen: false,
          blocks: [
            { kind: "thinking", text: "I will inspect the repo." },
            { kind: "text", text: "I found the issue." },
            {
              kind: "tool",
              item: {
                toolCall: {
                  type: "toolCall",
                  id: "tool-1",
                  name: "Shell",
                  arguments: { cmd: "pnpm test" },
                },
                toolResult: {
                  role: "toolResult",
                  toolCallId: "tool-1",
                  toolName: "Shell",
                  content: [{ type: "text", text: "ok" }],
                },
              },
            },
            { kind: "text", text: " Next step is ready." },
          ],
        },
      ],
    },
  });

  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["user", "assistant", "thinking", "assistant", "tool_call", "tool_result", "assistant", "runtime_state"],
  );
  assert.equal(entries.at(-1)?.toolStatus, "Running shell");
  assert.deepEqual(entries.at(-1)?.retryAttempts, [
    { attempt: 1, maxAttempts: 3, errorMessage: "temporary network failure" },
  ]);
  assert.equal(entries[0].text, "Run the checks");
  assert.equal(entries[0].messageId, "user-1");
  assert.equal(entries[1].meta?.contextUsageTokens, 321);
  assert.equal(entries[2].text, "I will inspect the repo.");
  assert.equal(entries[3].text, "I found the issue.");
  assert.equal(entries[4].toolCall.name, "Shell");
  assert.equal(entries[5].toolResult.toolCallId, "tool-1");
  assert.equal(entries[6].text, " Next step is ready.");
});

test("gateway runtime snapshot carries the same tool preview shape as bridge deltas", () => {
  const content = "z".repeat(9000);
  const toolCall = {
    type: "toolCall",
    id: "tool-write",
    name: "Write",
    arguments: { path: "big.txt", content },
  };
  const entries = buildGatewayRuntimeSnapshotEntries({
    userMessage: null,
    liveTranscript: {
      draftAssistantText: "",
      toolStatus: null,
      liveRounds: [
        {
          key: "round-1",
          round: 1,
          runningToolCallIds: ["tool-write"],
          thinkingOpen: false,
          blocks: [{ kind: "tool", item: { toolCall } }],
        },
      ],
    },
  });

  const entry = entries.find((candidate) => candidate.kind === "tool_call");
  assert.ok(entry, "expected a tool_call entry");
  assert.deepEqual(entry.toolCall.arguments, buildGatewayToolCallPreviewArguments(toolCall));
  assert.ok(entry.toolCall.arguments.content.length <= 4000);
  const metadata = entry.toolCall.arguments[toolPreview.LIVE_TOOL_PREVIEW_META_KEY];
  assert.equal(metadata.progress, content.length);
  assert.equal(metadata.fields.content.chars, content.length);
});

test("gateway runtime snapshots preserve an AskUserQuestion deadline across reconnects", async () => {
  const toolCall = {
    type: "toolCall",
    id: "tool-ask-snapshot",
    name: "AskUserQuestion",
    arguments: {
      questions: [
        {
          id: "choice",
          prompt: "Choose one",
          options: [{ label: "First" }, { label: "Second" }],
        },
      ],
    },
  };
  const liveTranscript = {
    draftAssistantText: "",
    toolStatus: null,
    liveRounds: [
      {
        key: "round-1",
        round: 1,
        runningToolCallIds: [toolCall.id],
        thinkingOpen: false,
        blocks: [{ kind: "tool", item: { toolCall } }],
      },
    ],
  };

  const first = buildGatewayRuntimeSnapshotEntries({ userMessage: null, liveTranscript });
  const firstToolCall = first.find((entry) => entry.kind === "tool_call");
  assert.ok(firstToolCall);
  const deadlineAt =
    firstToolCall.toolCall.arguments[askShared.ASK_USER_QUESTION_DEADLINE_ARG];
  assert.ok(deadlineAt > Date.now());

  const reconnected = buildGatewayRuntimeSnapshotEntries({ userMessage: null, liveTranscript });
  const reconnectedToolCalls = reconnected.filter((entry) => entry.kind === "tool_call");
  assert.equal(reconnectedToolCalls.length, 1);
  assert.equal(
    reconnectedToolCalls[0].toolCall.arguments[askShared.ASK_USER_QUESTION_DEADLINE_ARG],
    deadlineAt,
  );
  assert.equal(askTools.getAskUserQuestionDeadlineAt(toolCall.id), deadlineAt);

  // Consume the preset through the real pending lifecycle and clean it up.
  const bundle = askTools.createAskUserQuestionTools({ conversationId: "conv-snapshot" });
  const resultPromise = bundle.executeToolCall(toolCall);
  assert.equal(askTools.hasPendingAskUserQuestion(toolCall.id), true);
  assert.equal(
    askTools.answerAskUserQuestion(toolCall.id, [
      { questionId: "choice", selectedLabel: "Second" },
    ]).ok,
    true,
  );
  const result = await resultPromise;
  assert.equal(result.details.answers[0].selectedLabel, "Second");
  assert.equal(askTools.getAskUserQuestionDeadlineAt(toolCall.id), null);
});

test("gateway runtime snapshot falls back to draft assistant text", () => {
  const entries = buildGatewayRuntimeSnapshotEntries({
    userMessage: {
      role: "user",
      id: "user-2",
      content: "Continue",
    },
    liveTranscript: {
      draftAssistantText: "streaming text",
      toolStatus: null,
      liveRounds: [],
    },
  });

  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["user", "assistant"],
  );
  assert.equal(entries[1].text, "streaming text");
  assert.equal(entries[0].messageId, "user-2");
});

test("gateway final projection is frozen from the persisted conversation state", () => {
  const userMessage = {
    role: "user",
    id: "user-final",
    content: "Inspect the project",
  };
  const entries = buildGatewayFinalProjectionEntries({
    runId: "run-final",
    userMessage,
    runtimeState: {
      toolStatus: null,
      toolStatusIsCompaction: false,
      retryAttempts: [],
    },
    state: {
      meta: {},
      segments: [],
      activeSegmentIndex: 0,
      transcript: {
        items: [
          {
            kind: "user",
            key: "user-row",
            messageRef: { messageId: "user-final" },
            text: "Inspect the project",
            attachments: [],
          },
          {
            kind: "assistant",
            key: "assistant-row",
            rounds: [
              {
                key: "round-1",
                round: 1,
                runningToolCallIds: [],
                blocks: [
                  { kind: "thinking", text: "Checking files" },
                  { kind: "text", text: "The project is healthy." },
                ],
              },
            ],
          },
          {
            kind: "summary",
            key: "summary-row",
            summaryId: "summary-final",
            content: "Compressed context",
            coveredMessageCount: 3,
            coversThroughMessageId: "assistant-final",
            generatedBy: { providerId: "provider", model: "model" },
            contextUsageTokens: 144,
            timestamp: 123,
            collapsed: false,
          },
          {
            kind: "user",
            key: "next-user",
            messageRef: { messageId: "user-next" },
            text: "Next prompt",
            attachments: [],
          },
        ],
        segmentWindows: [],
        oldestMessageOffset: 0,
        hasMoreBefore: false,
        revision: null,
      },
    },
  });

  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["user", "thinking", "assistant", "checkpoint"],
  );
  assert.equal(entries[1].text, "Checking files");
  assert.equal(entries[2].text, "The project is healthy.");
  assert.equal(entries[3].contextUsageTokens, 144);
  assert.equal(entries[3].summaryId, "summary-final");
  assert.equal(entries.some((entry) => entry.kind === "user" && entry.text === "Next prompt"), false);
});
