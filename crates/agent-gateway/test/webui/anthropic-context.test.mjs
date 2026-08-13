import assert from "node:assert/strict";
import test from "node:test";

import { createWebModuleLoader } from "../helpers/load-web-module.mjs";

const loader = createWebModuleLoader();
const sharedAnthropicContext = loader.loadModule("@liveagent/ui/lib/models/anthropicContext.ts");
const settings = loader.loadModule("@/lib/settings/index.ts");

const relay = "https://relay.example.com/v1";
const official = "https://api.anthropic.com/v1";

test("Gateway settings uses shared Anthropic context-window policy", () => {
  assert.equal(
    settings.getProviderModelDefaults("claude_code", "claude-sonnet-4-5", relay).contextWindow,
    sharedAnthropicContext.resolveAnthropicKnownModelLimits("claude-sonnet-4-5", relay)
      ?.contextWindow,
  );
  assert.equal(
    settings.getProviderModelDefaults("claude_code", "claude-sonnet-4-5", official).contextWindow,
    sharedAnthropicContext.resolveAnthropicKnownModelLimits("claude-sonnet-4-5", official)
      ?.contextWindow,
  );
});

test("shared Anthropic context policy distinguishes relay and official endpoints", () => {
  assert.equal(sharedAnthropicContext.shouldSendAnthropicLongContextHeader(relay), true);
  assert.equal(sharedAnthropicContext.shouldSendAnthropicLongContextHeader(official), false);
  assert.equal(
    sharedAnthropicContext.resolveAnthropicContextWindow("claude-sonnet-4-5[1m]", 200_000, relay),
    1_000_000,
  );
  assert.equal(
    sharedAnthropicContext.resolveAnthropicContextWindow("claude-sonnet-4-5[1m]", 200_000, official),
    200_000,
  );
});
