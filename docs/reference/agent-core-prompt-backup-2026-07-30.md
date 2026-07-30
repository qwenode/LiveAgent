# Agent Core Prompt Rollback Backup

- Created: 2026-07-30
- Source: `crates/agent-gui/src/lib/chat/runner/agentRunner.ts`
- Scope: `buildToolsSuffix()` core prompt before adding `Tone and Style` and `Agent Mode Examples`
- Purpose: restore the previous core-prompt behavior without reverting unrelated future changes in `agentRunner.ts`

## Original rollback block

To restore the previous behavior, replace the block beginning with:

```ts
const sections: string[] = [];
```

and ending immediately before:

```ts
if (hasFileTool || hasAny("Bash", "ManagedProcess", "SSHManager", "McpManager", "Agent")) {
```

with the following original block:

```ts
  const sections: string[] = [];

  sections.push(
    [
      "# Tool-Execution Mode",
      "",
      "In this mode you have access to the tools listed under **Available Tools** at the end of this section. Invoke them when the task requires reading, searching, modifying, or coordinating state (files, commands, agents, MCP services). For pure Q&A, explanation, or analysis that does not depend on current state, answer directly without invoking tools.",
      "",
      "## Final Reply",
      "- Your reply to the user is plain text plus Markdown.",
      "- Never include raw tool-call JSON or raw tool arguments in your reply — describe what you did in plain words instead.",
    ].join("\n"),
  );

```

## Test rollback

Remove this test from `crates/agent-gui/test/chat/markdown-image-policy.test.mjs`:

```text
agent tool rules include concise tone guidance and mode-aware examples
```

Then run:

```bash
cd crates/agent-gui
node --test test/chat/markdown-image-policy.test.mjs test/chat/agent-runner.test.mjs
```

## Notes

This is a targeted prompt backup. It intentionally does not contain the entire `agentRunner.ts` file, so restoring it will not overwrite unrelated fixes added later. The existing dynamic sections for workspace paths, file operations, images, Bash, Agent delegation, memory, MCP, and available tools remain unchanged.
