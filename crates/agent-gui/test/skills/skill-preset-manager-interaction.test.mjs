import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

// SkillPresetManager was a dedicated drawer used when Skills Hub had a
// "presets" tab. After the shared Hub unify, named presets still exist in
// settings / cron / conversation meta, but there is no standalone manager UI
// component left under agent-gui or agent-ui.

test("SkillPresetManager component is no longer part of the tree", () => {
  const legacyGuiPath = fileURLToPath(
    new URL("../../src/components/skills/SkillPresetManager.tsx", import.meta.url),
  );
  const legacyUiPath = fileURLToPath(
    new URL("../../../agent-ui/src/components/skills/SkillPresetManager.tsx", import.meta.url),
  );
  assert.equal(existsSync(legacyGuiPath), false);
  assert.equal(existsSync(legacyUiPath), false);
});
