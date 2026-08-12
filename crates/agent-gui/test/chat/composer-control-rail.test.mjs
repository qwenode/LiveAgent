import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../../agent-ui/src/pages/chat/ChatComposerBar.tsx", import.meta.url),
  "utf8",
);

test("composer editor row reserves the right control rail for its scrollbar", () => {
  assert.match(source, /"relative flex flex-1 pl-4 pr-12"/);
  assert.doesNotMatch(source, /"relative flex flex-1 px-4"/);
  assert.doesNotMatch(source, /"px-0 py-0 pr-8"/);
});
