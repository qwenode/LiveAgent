import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../../agent-ui/src/pages/mcp-hub/McpImportView.tsx", import.meta.url),
  "utf8",
);

test("MCP import view filters visible servers without changing the import selection model", () => {
  assert.match(source, /type=\"search\"/);
  assert.match(source, /mcpHub\.importSearchPlaceholder/);
  assert.match(source, /const \[importQuery, setImportQuery\] = useState\(\"\"\)/);
  assert.match(source, /const visibleServers = useMemo\(\(\) =>/);
  assert.match(source, /server\.id,[\s\S]*server\.transport,[\s\S]*server\.command/);
  assert.match(source, /visibleServers\.filter\(\(server\) => !installedIds\.has/);
  assert.match(source, /visibleServers\.length === 0/);
  assert.match(source, /mcpHub\.importNoMatch/);
  assert.match(source, /visibleServers\.map\(\(server\) =>/);
});
