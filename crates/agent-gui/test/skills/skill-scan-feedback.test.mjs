import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../../agent-ui/src/pages/skills-hub/SkillsHubPage.tsx", import.meta.url),
  "utf8",
);

test("manual Skill scans announce a persistent, dismissible result", () => {
  assert.match(source, /announce\?: boolean/);
  assert.match(source, /refresh\(\{ announce: true \}\)/);
  assert.match(source, /SCAN_FEEDBACK_DURATION_MS = 6500/);
  assert.match(source, /summarizeSkillScan\(previousSkills, discovery\.skills\)/);
  assert.match(source, /role=\{scanFeedback\.status === "error" \? "alert" : "status"\}/);
  assert.match(source, /aria-live=\{scanFeedback\.status === "error" \? "assertive" : "polite"\}/);
  assert.match(source, /onClick=\{dismissScanFeedback\}/);
  assert.match(source, /settings\.skillsScanFound/);
  assert.match(source, /settings\.skillsScanChanged/);
  assert.match(source, /settings\.skillsScanNoChanges/);
});
