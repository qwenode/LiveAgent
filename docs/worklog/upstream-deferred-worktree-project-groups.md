# Upstream Worktree/project-group series defer

Date: 2026-08-13
Repository: `C:/data/www/LiveAgent`

## Scope

The upstream dependency chain `57fcd1ee` through `62cfc2f2` adds product Git worktrees, workspace project groups, GUI/Gateway contracts, sidebar/group UI, and the later delete-worktree API redesign. `b9b9406ee` restores shared contracts within that same chain.

## Current local baseline

At local `main@d9e6af0e`, the product baseline is absent:

- no `workspaceProjectTypes.ts` or `WorkspaceProjectGroup` model;
- settings still expose flat `WorkspaceProject[]` without group normalization;
- `GitClient` has no product `createWorktree`/`removeWorktree` methods;
- Rust product `workspace/git.rs` has no create/list/remove worktree commands or `SYSTEM_WORKSPACE_PROJECT_GROUPS` settings path;
- Gateway has no corresponding worktree write gate/client/handlers;
- GUI and Gateway group/worktree sidebar consumers and create/delete modals are absent.

Existing subagent worktree support is a separate internal mechanism and is not product parity. Existing group/delete-worktree translation fragments and local pin dividers are not sufficient producers for the upstream contracts.

## Decision

**Defer the whole chain; do not land contract-only fragments or raw upstream commits.** A types-only or optional `GitClient` API would create orphan symbols with no producers or consumers, while `62cfc2f2` changes signatures again and must follow the complete baseline. The safe port order, when product work begins, is:

1. shared types/settings normalization;
2. Rust product Git worktree commands and persistence;
3. GUI/Gateway GitClient and write-gate contracts;
4. pure project/group helpers and tests;
5. dual-host i18n;
6. GUI/Gateway sidebar and modal UI hunks;
7. `62cfc2f2` delete-worktree API redesign last.

This defer is intentional and preserves the local sidebar/layout until a complete compatible baseline can be implemented and validated.
