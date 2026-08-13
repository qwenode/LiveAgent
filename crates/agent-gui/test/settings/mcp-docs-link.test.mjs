import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const formSource = readFileSync(
  new URL("../../../agent-ui/src/pages/mcp-hub/McpServersForm.tsx", import.meta.url),
  "utf8",
);

test("MCP docs links use the platform opener without nesting a browser anchor", () => {
  assert.match(formSource, /@liveagent\/app\/shims\/tauriOpener/);
  assert.match(formSource, /onClick=\{\(\) => void openUrl\(docsLink\)\}/);
  assert.match(formSource, /aria-label=\{t\("mcpHub\.storeOpenExternal"\)\}/);
  assert.match(formSource, /<ExternalLink aria-hidden="true"/);
  assert.doesNotMatch(formSource, /href=\{docsLink\}/);
});
