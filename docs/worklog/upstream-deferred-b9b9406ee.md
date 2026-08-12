# Deferred upstream adaptation: `b9b9406ee`

- **Upstream commit:** `b9b9406ee14b14d4f53a849966807a7b11ede377`
- **Subject:** `fix(ci): restore shared worktree contracts`
- **Status:** deferred; no safe standalone adaptation on the current local architecture.

## Affected upstream files

- `crates/agent-ui/src/lib/workspaceProjectTypes.ts` (new shared `WorkspaceProjectGroup` type)
- `crates/agent-gui/src/lib/settings/index.ts` (remove inline group type and re-export shared type)
- `crates/agent-ui/src/components/chat/ChatHistorySidebar.tsx` (import shared group type)
- `crates/agent-ui/src/lib/git/types.ts` (make worktree methods optional)
- `crates/agent-ui/src/components/git/GitBranchSelector.tsx` (guard worktree actions and modal wiring)

## Why it cannot be safely applied now

The local tree does not yet contain the feature baseline that this contract-fix commit repairs:

- `WorkspaceProjectGroup` and `workspaceProjectGroups` are absent.
- `WorkspaceProjectGroup` has no local inline definition to extract or re-export.
- `GitClient` has no `createWorktree` or `removeWorktree` methods to make optional.
- `GitBranchSelector` has no `WorktreeCreateModal` or corresponding worktree action path.
- The local sidebar and settings types use a different project model and preserve local workspace-feed, collapse, and pin-divider behavior.

Applying the upstream patch would therefore either be empty or introduce types and call sites without their required producers and consumers. It would not restore a valid contract in isolation.

## Follow-up plan

1. Establish the compatible worktree/group feature baseline using file-level adaptations, preserving the local dual-frontend sidebar layout.
2. Define the shared `WorkspaceProjectGroup` contract in the local `agent-ui` type module and thread it through both settings trees.
3. Add optional worktree methods to both GitClient implementations only after the local worktree API exists.
4. Revisit this commit and port its guard/import changes as a separate adaptation commit.

The prerequisite feature work is intentionally tracked separately so this deferred commit can be resumed without rewriting local history.
