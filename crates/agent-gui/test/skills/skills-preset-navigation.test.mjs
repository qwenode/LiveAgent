import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Skills Hub lives under @liveagent/ui after the #399 UI unify. Preset *data*
// still exists (settings.skills.presets, cron skillPresetId, chat meta), but
// the Hub no longer exposes a dedicated "presets" tab — Default membership is
// the installed selection, and named presets are chosen at send/cron time.

const skillsHubSource = readFileSync(
  new URL("../../../agent-ui/src/pages/skills-hub/SkillsHubPage.tsx", import.meta.url),
  "utf8",
);
const sendSource = readFileSync(
  new URL("../../src/pages/chat/runtime/useSendChatTurn.ts", import.meta.url),
  "utf8",
);
const cronRunnerSource = readFileSync(
  new URL("../../src/components/cron/CronPromptRunner.tsx", import.meta.url),
  "utf8",
);
const guiI18n = readFileSync(new URL("../../src/i18n/config.ts", import.meta.url), "utf8");
const webI18n = readFileSync(
  new URL("../../../agent-gateway/web/src/i18n/config.ts", import.meta.url),
  "utf8",
);

test("shared Skills Hub views are installed/store/import (no presets tab)", () => {
  assert.match(skillsHubSource, /type SkillsHubView = "installed" \| "store" \| "import"/);
  assert.doesNotMatch(skillsHubSource, /"presets"/);
});

test("installing store Skills enables and selects them on the Default membership", () => {
  const start = skillsHubSource.indexOf("  const enableInstalledSkillsFromJob = useCallback(");
  const end = skillsHubSource.indexOf("\n  useEffect(() => {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const installUpdate = skillsHubSource.slice(start, end);
  assert.match(installUpdate, /updateSkills\(prev, \{/);
  assert.match(installUpdate, /enabled: true/);
  assert.match(installUpdate, /selected: Array\.from\(next\)/);
  assert.doesNotMatch(installUpdate, /activePreset\.id/);
});

test("GUI send path still resolves skill presets on inherit workspaces", () => {
  assert.match(sendSource, /resolveSkillPreset/);
  assert.match(sendSource, /resolveWorkspaceResources/);
});

test("cron auto-prompt still resolves skill presets under inherit workspace mode", () => {
  assert.match(cronRunnerSource, /resolveEffectiveSkillNames/);
  assert.match(cronRunnerSource, /presetId: request\.skillPresetId/);
  assert.match(cronRunnerSource, /resources\.mode === "inherit"/);
});

test("both hosts keep skills preset editing copy", () => {
  for (const translations of [guiI18n, webI18n]) {
    assert.equal(translations.match(/"settings\.skillsPresetEditingHint":/g)?.length, 2);
  }
});
