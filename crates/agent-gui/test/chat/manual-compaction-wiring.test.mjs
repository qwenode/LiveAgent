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
  assert.match(chatPageSource, /onManualCompactConfirm=\{handleManualCompact\}/);
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


test("Gateway compact terminalizes through the reliable mirror before releasing the inbox request", () => {
  const listenerSource = read("../../src/pages/chat/gateway/useGatewayBridgeListeners.ts");
  const finishStart = listenerSource.indexOf("const finishCompactRun = async");
  const finishEnd = listenerSource.indexOf("const result = await", finishStart);
  const finishSource = listenerSource.slice(finishStart, finishEnd);

  assert.ok(finishStart >= 0 && finishEnd > finishStart);
  assert.match(finishSource, /entriesJson:\s*"\[\]"/);
  assert.match(listenerSource, /finishCompactRun\("cancelled"\)/);
  assert.ok(finishSource.indexOf("await bridge.close()") < finishSource.indexOf("finishGatewayRunMirror"));
  assert.ok(
    finishSource.indexOf("finishGatewayRunMirror") <
      finishSource.indexOf("compactTerminalized = true"),
  );
  assert.ok(
    listenerSource.indexOf('await finishCompactRun("completed")') <
      listenerSource.indexOf('await invoke("gateway_chat_complete"'),
  );
});
