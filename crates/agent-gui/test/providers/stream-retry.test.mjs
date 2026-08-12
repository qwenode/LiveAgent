import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { withStreamRetry, computeStreamRetryBackoffMs, DEFAULT_STREAM_RETRY_MAX_ATTEMPTS } =
  loader.loadModule("src/lib/providers/runtime/streamRetry.ts");

function createUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function createAssistant(text, stopReason, extra = {}) {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test-model",
    usage: createUsage(),
    stopReason,
    timestamp: Date.now(),
    ...extra,
  };
}

function createErrorStream(errorMessage) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "error", error: createAssistant(undefined, "error", { errorMessage }) };
    },
    async result() {
      return createAssistant(undefined, "error", { errorMessage });
    },
  };
}

function createResultOnlyErrorStream(errorMessage) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: createAssistant(undefined, "stop") };
    },
    async result() {
      return createAssistant(undefined, "error", { errorMessage });
    },
  };
}

function createThrowingIteratorStream(errorMessage, text) {
  const partial = createAssistant(text, "stop");
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: { ...partial, content: [] } };
      if (text) {
        yield {
          type: "text_delta",
          contentIndex: 0,
          delta: text,
          partial,
        };
      }
      throw new Error(errorMessage);
    },
    async result() {
      throw new Error("result() should not be reached after iterator failure");
    },
  };
}

function createRejectingResultStream(errorMessage) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: createAssistant(undefined, "stop") };
    },
    async result() {
      throw new Error(errorMessage);
    },
  };
}

function createSuccessStream(text) {
  const assistant = createAssistant(text, "stop");
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: { ...assistant, content: [] } };
      yield {
        type: "text_delta",
        contentIndex: 0,
        delta: text,
        partial: { ...assistant, content: [{ type: "text", text }] },
      };
      yield { type: "done", message: assistant };
    },
    async result() {
      return assistant;
    },
  };
}

function createErrorAfterContentStream(text, errorMessage) {
  const partial = createAssistant(text, "error", { errorMessage });
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: { ...partial, content: [] } };
      yield {
        type: "text_delta",
        contentIndex: 0,
        delta: text,
        partial: { ...partial, content: [{ type: "text", text }] },
      };
      yield { type: "error", error: partial };
    },
    async result() {
      return partial;
    },
  };
}

function createAbortedDoneStream() {
  const assistant = createAssistant(undefined, "aborted");
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "done", message: assistant };
    },
    async result() {
      return assistant;
    },
  };
}

function createDoneOnlyStream(content, stopReason = "stop") {
  const assistant = createAssistant(undefined, stopReason, { content });
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: { ...assistant, content: [] } };
      yield { type: "done", message: assistant };
    },
    async result() {
      return assistant;
    },
  };
}

function createWhitespaceOnlyStream() {
  const assistant = createAssistant(undefined, "stop", {
    content: [{ type: "text", text: "  \n" }],
  });
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: { ...assistant, content: [] } };
      yield { type: "text_delta", contentIndex: 0, delta: "  \n", partial: assistant };
      yield { type: "text_end", contentIndex: 0, content: "  \n", partial: assistant };
      yield { type: "done", message: assistant };
    },
    async result() {
      return assistant;
    },
  };
}

async function collectEvents(eventStream) {
  const events = [];
  for await (const event of eventStream) events.push(event);
  return events;
}

test("withStreamRetry retries a network error returned only by result()", async () => {
  let calls = 0;
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      if (calls === 1) return createResultOnlyErrorStream("network error");
      return createSuccessStream("recovered from result-only network error");
    },
    { maxAttempts: 2 },
  );

  const events = await collectEvents(wrapped);
  assert.equal(calls, 2);
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "text_delta", "done"],
  );
  assert.equal((await wrapped.result()).content[0].text, "recovered from result-only network error");
});

test("withStreamRetry retries a network error thrown by the async iterator", async () => {
  let calls = 0;
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      if (calls === 1) return createThrowingIteratorStream("network error");
      return createSuccessStream("recovered from iterator network error");
    },
    { maxAttempts: 2 },
  );

  const events = await collectEvents(wrapped);
  assert.equal(calls, 2);
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "text_delta", "done"],
  );
  assert.equal((await wrapped.result()).content[0].text, "recovered from iterator network error");
});

test("withStreamRetry retries a network error thrown by result()", async () => {
  let calls = 0;
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      if (calls === 1) return createRejectingResultStream("network error");
      return createSuccessStream("recovered from rejected result");
    },
    { maxAttempts: 2 },
  );

  const events = await collectEvents(wrapped);
  assert.equal(calls, 2);
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "text_delta", "done"],
  );
  assert.equal((await wrapped.result()).content[0].text, "recovered from rejected result");
});

test("withStreamRetry retries a network error thrown while creating the stream", async () => {
  let calls = 0;
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      if (calls === 1) throw new Error("network error");
      return createSuccessStream("recovered from factory network error");
    },
    {
      maxAttempts: 2,
      model: { api: "openai-responses", provider: "openai", id: "test-model" },
    },
  );

  const events = await collectEvents(wrapped);
  assert.equal(calls, 2);
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "text_delta", "done"],
  );
  assert.equal((await wrapped.result()).content[0].text, "recovered from factory network error");
});

test("withStreamRetry succeeds after N retryable errors without leaking failed-attempt events", async () => {
  let calls = 0;
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      if (calls < 3) return createErrorStream("503 service unavailable");
      return createSuccessStream("final answer");
    },
    { maxAttempts: 5 },
  );

  const events = await collectEvents(wrapped);
  assert.equal(calls, 3);
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "text_delta", "done"],
  );
  const final = await wrapped.result();
  assert.equal(final.stopReason, "stop");
  assert.equal(final.content[0].text, "final answer");
});

test("withStreamRetry retries an OpenAI Responses stream that ends without a terminal event", async () => {
  let calls = 0;
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      if (calls === 1) {
        return createErrorStream(
          "OpenAI Responses stream ended before a terminal response event",
        );
      }
      return createSuccessStream("recovered answer");
    },
    { maxAttempts: 2 },
  );

  const events = await collectEvents(wrapped);
  assert.equal(calls, 2);
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "text_delta", "done"],
  );
  const final = await wrapped.result();
  assert.equal(final.stopReason, "stop");
  assert.equal(final.content[0].text, "recovered answer");
});

test("withStreamRetry retries an upstream stream_error without a provider message", async () => {
  let calls = 0;
  const retryErrorMessages = [];
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      if (calls === 1) return createErrorStream("stream_error: no message");
      return createSuccessStream("recovered from upstream stream error");
    },
    {
      maxAttempts: 2,
      onRetry: (_attempt, _maxAttempts, errorMessage) => retryErrorMessages.push(errorMessage),
    },
  );

  const events = await collectEvents(wrapped);
  assert.equal(calls, 2);
  assert.deepEqual(retryErrorMessages, ["stream_error: no message"]);
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "text_delta", "done"],
  );
  const final = await wrapped.result();
  assert.equal(final.stopReason, "stop");
  assert.equal(final.content[0].text, "recovered from upstream stream error");
});

test("withStreamRetry retries the generic terminal-less upstream wording", async () => {
  let calls = 0;
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      if (calls === 1) {
        return createErrorStream("stream ended without terminal event or completed response");
      }
      return createSuccessStream("recovered from terminal-less stream");
    },
    { maxAttempts: 2 },
  );

  const events = await collectEvents(wrapped);
  assert.equal(calls, 2);
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "text_delta", "done"],
  );
  const final = await wrapped.result();
  assert.equal(final.stopReason, "stop");
  assert.equal(final.content[0].text, "recovered from terminal-less stream");
});

test("withStreamRetry retries stream_error unexpected EOF before content commits", async () => {
  let calls = 0;
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      if (calls === 1) return createErrorStream("stream_error: unexpected EOF");
      return createSuccessStream("recovered from unexpected EOF");
    },
    { maxAttempts: 2 },
  );

  const events = await collectEvents(wrapped);
  assert.equal(calls, 2);
  assert.deepEqual(events.map((event) => event.type), ["start", "text_delta", "done"]);
  assert.equal((await wrapped.result()).content[0].text, "recovered from unexpected EOF");
});

test("withStreamRetry retries bare unexpected EOF before content commits", async () => {
  let calls = 0;
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      if (calls === 1) return createErrorStream("unexpected EOF");
      return createSuccessStream("recovered from bare EOF");
    },
    { maxAttempts: 2 },
  );

  await collectEvents(wrapped);
  assert.equal(calls, 2);
});

test("withStreamRetry does not retry unexpected EOF after content commits", async () => {
  let calls = 0;
  const wrapped = withStreamRetry(() => {
    calls += 1;
    return createErrorAfterContentStream("partial", "stream_error: unexpected EOF");
  }, { maxAttempts: 2 });

  const events = await collectEvents(wrapped);
  assert.equal(calls, 1);
  assert.deepEqual(events.map((event) => event.type), ["start", "text_delta", "error"]);
});

test("withStreamRetry retries a clean empty response before content commits", async () => {
  let calls = 0;
  const retryErrorMessages = [];
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      if (calls === 1) return createDoneOnlyStream([]);
      return createSuccessStream("recovered from empty response");
    },
    {
      maxAttempts: 2,
      onRetry: (_attempt, _maxAttempts, errorMessage) => retryErrorMessages.push(errorMessage),
    },
  );

  const events = await collectEvents(wrapped);
  assert.equal(calls, 2);
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "text_delta", "done"],
  );
  assert.deepEqual(retryErrorMessages, ["Upstream returned an empty response"]);
  const final = await wrapped.result();
  assert.equal(final.stopReason, "stop");
  assert.equal(final.content[0].text, "recovered from empty response");
});

test("withStreamRetry turns repeated clean empty responses into an explicit failure", async () => {
  let calls = 0;
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      return createWhitespaceOnlyStream();
    },
    { maxAttempts: 3 },
  );

  const events = await collectEvents(wrapped);
  assert.equal(calls, 3);
  assert.deepEqual(
    events.map((event) => event.type),
    ["error"],
  );
  const final = await wrapped.result();
  assert.equal(final.stopReason, "error");
  assert.equal(final.errorMessage, "Upstream returned an empty response");
});

test("withStreamRetry accepts a clean done carrying a tool call even without delta events", async () => {
  let calls = 0;
  const toolCall = { type: "toolCall", id: "call_1", name: "Read", arguments: { path: "." } };
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      return createDoneOnlyStream([toolCall], "toolUse");
    },
    { maxAttempts: 3 },
  );

  const events = await collectEvents(wrapped);
  assert.equal(calls, 1);
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "done"],
  );
  const final = await wrapped.result();
  assert.equal(final.stopReason, "toolUse");
  assert.deepEqual(final.content, [toolCall]);
});

test("withStreamRetry invokes onRetry per attempt and onRetryRecovered once content commits", async () => {
  let calls = 0;
  const retryCalls = [];
  let recoveredCalls = 0;
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      if (calls < 3) return createErrorStream("503 service unavailable");
      return createSuccessStream("final answer");
    },
    {
      maxAttempts: 5,
      onRetry: (attempt, maxAttempts) => retryCalls.push([attempt, maxAttempts]),
      onRetryRecovered: () => {
        recoveredCalls += 1;
      },
    },
  );

  await collectEvents(wrapped);
  assert.deepEqual(retryCalls, [
    [1, 4],
    [2, 4],
  ]);
  assert.equal(recoveredCalls, 1);
});

test("withStreamRetry passes the failing attempt's error message as onRetry's third argument", async () => {
  let calls = 0;
  const retryErrorMessages = [];
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      if (calls < 3) return createErrorStream(`503 service unavailable (call ${calls})`);
      return createSuccessStream("final answer");
    },
    {
      maxAttempts: 5,
      onRetry: (_attempt, _maxAttempts, errorMessage) => retryErrorMessages.push(errorMessage),
    },
  );

  await collectEvents(wrapped);
  assert.deepEqual(retryErrorMessages, [
    "503 service unavailable (call 1)",
    "503 service unavailable (call 2)",
  ]);
});

test("withStreamRetry never calls onRetryRecovered when no retry occurred", async () => {
  let recoveredCalls = 0;
  const wrapped = withStreamRetry(() => createSuccessStream("first try"), {
    onRetryRecovered: () => {
      recoveredCalls += 1;
    },
  });

  await collectEvents(wrapped);
  assert.equal(recoveredCalls, 0);
});

test("withStreamRetry does not retry once content has been committed", async () => {
  let calls = 0;
  const wrapped = withStreamRetry(() => {
    calls += 1;
    return createErrorAfterContentStream("partial", "503 service unavailable");
  });

  const events = await collectEvents(wrapped);
  assert.equal(calls, 1);
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "text_delta", "error"],
  );
  const final = await wrapped.result();
  assert.equal(final.stopReason, "error");
});

test("withStreamRetry does not retry an iterator network error after content commits", async () => {
  let calls = 0;
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      return createThrowingIteratorStream("network error", "partial");
    },
    { maxAttempts: 3 },
  );

  const events = await collectEvents(wrapped);
  assert.equal(calls, 1);
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "text_delta", "error"],
  );
  const final = await wrapped.result();
  assert.equal(final.stopReason, "error");
  assert.equal(final.errorMessage, "network error");
  assert.equal(final.content[0].text, "partial");
});

test("withStreamRetry never retries an aborted stream", async () => {
  let calls = 0;
  const wrapped = withStreamRetry(() => {
    calls += 1;
    return createAbortedDoneStream();
  });

  const events = await collectEvents(wrapped);
  assert.equal(calls, 1);
  assert.deepEqual(
    events.map((event) => event.type),
    ["done"],
  );
  const final = await wrapped.result();
  assert.equal(final.stopReason, "aborted");
});

test("withStreamRetry respects maxAttempts and surfaces the last failure", async () => {
  let calls = 0;
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      return createErrorStream(`rate limit exceeded (attempt ${calls})`);
    },
    { maxAttempts: 3 },
  );

  const events = await collectEvents(wrapped);
  assert.equal(calls, 3);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "error");
  const final = await wrapped.result();
  assert.equal(final.stopReason, "error");
  assert.match(final.errorMessage, /attempt 3/);
});

test("withStreamRetry exhausts repeated factory network errors without hanging", async () => {
  let calls = 0;
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      throw new Error(`network error (attempt ${calls})`);
    },
    {
      maxAttempts: 3,
      model: { api: "openai-responses", provider: "openai", id: "test-model" },
    },
  );

  const events = await collectEvents(wrapped);
  assert.equal(calls, 3);
  assert.deepEqual(
    events.map((event) => event.type),
    ["error"],
  );
  const final = await wrapped.result();
  assert.equal(final.stopReason, "error");
  assert.match(final.errorMessage, /attempt 3/);
  assert.equal(final.api, "openai-responses");
  assert.equal(final.provider, "openai");
  assert.equal(final.model, "test-model");
});

test("withStreamRetry does not retry non-retryable errors", async () => {
  let calls = 0;
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      return createErrorStream("insufficient_quota: billing required");
    },
    { maxAttempts: 5 },
  );

  const events = await collectEvents(wrapped);
  assert.equal(calls, 1);
  assert.equal(events[0].type, "error");
});

test("withStreamRetry backoff aborted before it can fire prevents any further attempt", async () => {
  // Pre-abort so the retry loop's sleepWithAbort() rejects synchronously on
  // its aborted-check, instead of racing a real timer against a real abort
  // (which would make this test's timing non-deterministic).
  let calls = 0;
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      return createErrorStream("503 service unavailable");
    },
    { maxAttempts: 5, signal: controller.signal },
  );

  const events = await collectEvents(wrapped);
  assert.equal(calls, 1);
  assert.equal(events[0].type, "error");
  assert.match(events[0].error.errorMessage, /503/);
});

test("withStreamRetry preserves a factory network error when backoff is aborted", async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      throw new Error("network error");
    },
    {
      maxAttempts: 5,
      signal: controller.signal,
      model: { api: "openai-responses", provider: "openai", id: "test-model" },
    },
  );

  const events = await collectEvents(wrapped);
  assert.equal(calls, 1);
  assert.deepEqual(
    events.map((event) => event.type),
    ["error"],
  );
  const final = await wrapped.result();
  assert.equal(final.stopReason, "error");
  assert.equal(final.errorMessage, "network error");
});

test("withStreamRetry with disabled:true never retries", async () => {
  let calls = 0;
  const wrapped = withStreamRetry(
    () => {
      calls += 1;
      return createErrorStream("503 service unavailable");
    },
    { maxAttempts: 5, disabled: true },
  );

  await collectEvents(wrapped);
  assert.equal(calls, 1);
});

test("computeStreamRetryBackoffMs follows codex's uncapped base*2^(n-1)*jitter(0.9,1.1) formula", () => {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const delay = computeStreamRetryBackoffMs(attempt);
    const base = 200 * 2 ** (attempt - 1);
    assert.ok(delay >= base * 0.9);
    assert.ok(delay <= base * 1.1);
  }
});

test("DEFAULT_STREAM_RETRY_MAX_ATTEMPTS is 6 total attempts (5 retries), matching codex", () => {
  assert.equal(DEFAULT_STREAM_RETRY_MAX_ATTEMPTS, 6);
});
