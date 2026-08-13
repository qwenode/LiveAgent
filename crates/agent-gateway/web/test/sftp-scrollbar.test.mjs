import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sftpPanelSource = readFileSync(
  new URL("../../../agent-ui/src/components/workspace-editor/WorkspaceSftpPanel.tsx", import.meta.url),
  "utf8",
);
const gatewayStylesSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("SFTP dual-pane scrolling keeps a stable WebUI scrollbar override", () => {
  assert.match(sftpPanelSource, /sftp-panes-scroll[\s\S]*overflow-x-auto/);
  assert.match(
    gatewayStylesSource,
    /html\[data-liveagent-webui="gateway"\] \.sftp-panes-scroll\s*\{\s*scrollbar-width:\s*auto;\s*scrollbar-color:\s*auto;/,
  );

  const focusRuleEnd = gatewayStylesSource.indexOf("}\n\nhtml[data-liveagent-webui=\"gateway\"]::-webkit-scrollbar");
  const overrideStart = gatewayStylesSource.indexOf(
    'html[data-liveagent-webui="gateway"] .sftp-panes-scroll',
  );
  assert.ok(focusRuleEnd >= 0, "global scrollbar hover/focus rule should exist");
  assert.ok(overrideStart > focusRuleEnd, "SFTP override must follow global scrollbar rules");
});
