import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gatewayAppSource = readFileSync(
  new URL("../src/app/GatewayApp.tsx", import.meta.url),
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

test("Gateway focus helper skips mobile layout and waits for two animation frames", () => {
  const helper = between(
    gatewayAppSource,
    "const focusComposerAfterConversationChange = useCallback",
    "const composerDraftCacheRef",
  );

  assertInOrder(helper, [
    "if (isMobileSidebarLayout()) {",
    "return;",
    "window.requestAnimationFrame(() => {",
    "window.requestAnimationFrame(() => {",
    "composerRef.current?.focus();",
  ]);
  assert.equal(countOccurrences(helper, "window.requestAnimationFrame("), 2);
  assert.equal(countOccurrences(helper, "composerRef.current?.focus()"), 1);
  assert.match(
    helper,
    /window\.requestAnimationFrame\(\(\) => \{\s*window\.requestAnimationFrame\(\(\) => \{\s*composerRef\.current\?\.focus\(\);/s,
  );
});

test("Gateway project new conversation focuses only after the validated start path", () => {
  const projectActivation = between(
    gatewayAppSource,
    "const activateWorkspaceProject = useCallback",
    "const handleSelectWorkspaceProject",
  );
  assertInOrder(projectActivation, [
    "if (options?.startConversation) {",
    "startNewConversation({",
    "focusComposerAfterConversationChange();",
  ]);

  const validatedHandler = between(
    gatewayAppSource,
    "const handleNewConversationForProject = useCallback",
    "const handleBrowseWorkspaceProjectInFileTree",
  );
  assertInOrder(validatedHandler, [
    "if (!(await checkWorkspaceProjectDirectory(project))) {",
    "return;",
    "activateWorkspaceProject(project, { startConversation: true });",
  ]);
});

test("Gateway sidebar focuses both reused Hub drafts and newly created drafts", () => {
  const sidebarHandler = between(
    gatewayAppSource,
    "function handleSidebarNewConversation()",
    "function handleSidebarSelectConversation",
  );

  assert.equal(countOccurrences(sidebarHandler, "focusComposerAfterConversationChange();"), 2);
  assertInOrder(sidebarHandler, [
    'activeView !== "chat"',
    "focusComposerAfterConversationChange();",
    "return;",
    "startNewConversation({",
    "focusComposerAfterConversationChange();",
  ]);
});

test("Gateway shared startNewConversation remains free of focus side effects", () => {
  const sharedStart = between(
    gatewayAppSource,
    "function startNewConversation(options?: {",
    "const removeWorkspaceProjectFromSettings",
  );

  assert.doesNotMatch(sharedStart, /focusComposer|requestAnimationFrame/);
});
