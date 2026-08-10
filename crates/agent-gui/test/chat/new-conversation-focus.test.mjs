import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatPageSource = readFileSync(
  new URL("../../src/pages/ChatPage.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const workspaceProjectsSource = readFileSync(
  new URL("../../src/pages/chat/workspace/useWorkspaceProjects.ts", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const historyActionsSource = readFileSync(
  new URL("../../src/pages/chat/history/useConversationHistoryActions.ts", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function assertInOrder(source, needles) {
  let previous = -1;
  for (const needle of needles) {
    const current = source.indexOf(needle, previous + 1);
    assert.ok(current > previous, `${needle} must appear in the expected order`);
    previous = current;
  }
}

test("conversation-change focus waits for two animation frames", () => {
  const helper = between(
    chatPageSource,
    "const focusComposerAfterConversationChange = useCallback",
    "const {\n    queuedChatTurnsRef,",
  );

  assert.equal(countOccurrences(helper, "window.requestAnimationFrame("), 2);
  assert.equal(countOccurrences(helper, "composerRef.current?.focus()"), 1);
  assert.match(
    helper,
    /window\.requestAnimationFrame\(\(\) => \{\s*window\.requestAnimationFrame\(\(\) => \{\s*composerRef\.current\?\.focus\(\);/s,
  );
  assert.match(
    helper,
    /focusComposerAfterConversationChangeActionRef\.current\s*=\s*focusComposerAfterConversationChange;/,
  );
});

test("normal new conversation prepares, starts, then focuses the composer", () => {
  const handler = between(
    chatPageSource,
    "const handleNewConversation = useCallback",
    "// 动作总线（Rust `app:action`）",
  );

  assertInOrder(handler, [
    "prepareComposerForConversationChange();",
    "startNewConversationActionRef.current({",
    "focusComposerAfterConversationChangeActionRef.current();",
  ]);
});

test("Hub draft reuse and the new-chat app action request focus without duplicate drafts", () => {
  const sidebarHandler = between(
    chatPageSource,
    "onNewConversation={() => {",
    "onSelectConversation={(id) => {",
  );
  assertInOrder(sidebarHandler, [
    'if (activeView !== "chat" && isDraftConversation) {',
    "focusComposerAfterConversationChangeActionRef.current();",
    "return;",
    "handleNewConversation();",
  ]);
  assert.equal(countOccurrences(sidebarHandler, "handleNewConversation();"), 1);

  const appAction = between(chatPageSource, 'case "new-chat": {', 'case "open-conversation": {');
  assert.match(appAction, /if \(!wasInHub \|\| !isDraftConversationRef\.current\)/);
  assert.equal(countOccurrences(appAction, "handleNewConversationRef.current();"), 1);
  assert.equal(
    countOccurrences(appAction, "focusComposerAfterConversationChangeActionRef.current();"),
    1,
  );
});

test("project new conversation prepares, starts, then focuses after validation", () => {
  const projectStart = between(
    workspaceProjectsSource,
    "if (options?.startConversation) {",
    "const handleSelectWorkspaceProject",
  );

  assertInOrder(projectStart, [
    "prepareComposerForConversationChangeActionRef.current();",
    "startNewConversationActionRef.current({ workdir: targetProject.path });",
    "focusComposerAfterConversationChangeActionRef.current();",
  ]);

  const validatedHandler = between(
    workspaceProjectsSource,
    "const handleNewConversationForProject = useCallback",
    "const handleBrowseWorkspaceProjectInFileTree",
  );
  assertInOrder(validatedHandler, [
    "if (!(await checkWorkspaceProjectDirectory(project))) {",
    "return;",
    "activateWorkspaceProject(project, { startConversation: true });",
  ]);
});

test("shared startNewConversation remains free of focus side effects", () => {
  const sharedStart = between(
    historyActionsSource,
    "function startNewConversation(options?: { workdir?: string })",
    "async function openInitial",
  );

  assert.doesNotMatch(sharedStart, /focusComposer|requestAnimationFrame/);
});
