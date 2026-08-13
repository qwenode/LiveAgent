import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativeUrl) {
  return readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
}

const chatPageSource = read("../../src/pages/ChatPage.tsx");
const adapterSource = read("../../src/pages/chat/runtime/useManualCompaction.ts");
const composerSource = read("../../../agent-ui/src/pages/chat/ChatComposerBar.tsx");

test("desktop manual compaction stays controller-backed and uses the existing stop lifecycle", () => {
  assert.match(chatPageSource, /useManualCompaction\(\{/);
  assert.match(chatPageSource, /setConversationStopHandler,\s*clearConversationStopHandler/);
  assert.match(chatPageSource, /onManualCompactConfirm=\{/);
  assert.match(chatPageSource, /manualCompactBlocked=\{/);
  assert.match(chatPageSource, /isConversationRunning\(currentConversationId\)/);

  assert.match(adapterSource, /controller\.compactManually\(/);
  assert.match(adapterSource, /setConversationStopHandler\(conversationId, handleStop\)/);
  assert.match(adapterSource, /clearConversationStopHandler\(conversationId, handleStop\)/);
  assert.match(adapterSource, /persistRollback: persistState/);
});

test("composer keeps manual compaction adjacent to the read-only ring behind confirmation", () => {
  assert.match(composerSource, /onManualCompactConfirm\?:/);
  assert.match(composerSource, /manualCompactBlocked\?:/);
  assert.match(composerSource, /<ConfirmActionPopover[\s\S]*onConfirm=\{\(\) => void onManualCompactConfirm\(\)\}/);
  assert.match(composerSource, /right-12 top-1\/2/);
  assert.match(composerSource, /disabled=\{controlsDisabled \|\| isSending \|\| manualCompactBlocked\}/);
});
