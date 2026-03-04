# Performance Optimizations

Coast is designed to make branch switching fast, but in large monorepos the default behavior can introduce unnecessary latency. This page covers the levers available in your Coastfile to reduce assign and unassign times.

## Why Assign Can Be Slow

`coast assign` does several things when switching a Coast to a new worktree:

```text
coast assign dev-1 --worktree feature/payments

  1. stop affected compose services
  2. create git worktree (if new)
  3. sync gitignored files into worktree (rsync)  ← often the bottleneck
  4. remount /workspace
  5. git ls-files diff  ← can be slow in large repos
  6. restart/rebuild services
```

Two steps dominate the latency: the **gitignored file sync** and the **`git ls-files` diff**. Both scale with repository size and are amplified by macOS VirtioFS overhead.

### Gitignored File Sync

When a worktree is created for the first time, Coast uses `rsync --link-dest` to hardlink gitignored files (build artifacts, caches, generated code) from the project root into the new worktree. Hardlinks are near-instant per file, but rsync must still traverse every directory in the source tree to discover what needs syncing.

If your project root contains large directories that rsync should not touch — other worktrees, vendored dependencies, unrelated apps — rsync wastes time descending into and stat-ing thousands of files it will never copy. On a repo with 400,000+ gitignored files, this traversal alone can take 30–60 seconds.

Coast automatically excludes `node_modules`, `.git`, `dist`, `target`, `.worktrees`, `.coasts`, and other common heavy directories from this sync. Additional directories can be excluded via `exclude_paths` in your Coastfile (see below).

Once a worktree has been synced, a `.coast-synced` marker is written and subsequent assigns to the same worktree skip the sync entirely.

### `git ls-files` Diff

Every assign and unassign also runs `git ls-files` to determine which tracked files changed between branches. On macOS, all file I/O between the host and the Docker VM crosses VirtioFS (or gRPC-FUSE on older setups). The `git ls-files` operation stats every tracked file, and the per-file overhead compounds quickly. A repo with 30,000 tracked files will take noticeably longer than one with 5,000, even if the actual diff is small.

## `exclude_paths` — The Main Lever

The `exclude_paths` option in your Coastfile tells Coast to skip entire directory trees during both the **gitignored file sync** (rsync) and the **`git ls-files` diff**. Files under excluded paths are still present in the worktree — they are just not traversed during assign.

```toml
[assign]
default = "none"
exclude_paths = [
    "docs",
    "scripts",
    "test-fixtures",
    "apps/mobile",
]
```

This is the single most impactful optimization for large monorepos. It reduces both the rsync traversal on first assign and the file diff on every assign. If your project has 30,000 tracked files but only 20,000 are relevant to the services running in the Coast, excluding the other 10,000 cuts a third of the work from every assign.

### Choosing What to Exclude

The goal is to exclude everything your Coast services do not need. Start by profiling what is in your repo:

```bash
git ls-files | cut -d'/' -f1 | sort | uniq -c | sort -rn
```

This shows the file count per top-level directory. From there, identify which directories your compose services actually mount or depend on, and exclude the rest.

**Keep** directories that:
- Contain source code mounted into running services (e.g., your app directories)
- Contain shared libraries imported by those services
- Are referenced in `[assign.rebuild_triggers]`

**Exclude** directories that:
- Belong to apps or services not running in your Coast (other teams' apps, mobile clients, CLI tools)
- Contain documentation, scripts, CI configs, or tooling unrelated to runtime
- Are large dependency caches checked into the repo (e.g., vendored proto definitions, `.yarn` offline cache)

### Example: Monorepo With Multiple Apps

A monorepo with 29,000 files across many apps, but only two are relevant:

```text
  13,000  bookface/         ← active
   7,000  ycinternal/       ← active
     850  shared/           ← used by both
   3,800  .yarn/            ← excludable
   2,500  startupschool/    ← excludable
     500  misc/             ← excludable
     300  ycapp/            ← excludable
     ...  (12 more dirs)    ← excludable
```

```toml
[assign]
default = "none"
exclude_paths = [
    ".yarn",
    "startupschool",
    "misc",
    "ycapp",
    "apply",
    "cli",
    "deploy",
    "lambdas",
    # ... any other directories not needed by active services
]
```

This reduces the diff surface from 29,000 files to ~21,000 — roughly 28% fewer stats on every assign.

## Trim Inactive Services From `[assign.services]`

If your `COMPOSE_PROFILES` only starts a subset of services, remove inactive services from `[assign.services]`. Coast evaluates the assign strategy for every listed service, and restarting or rebuilding a service that is not running is wasted work.

```toml
# Bad — restarts services that aren't running
[assign.services]
web = "restart"
api = "restart"
mobile-api = "restart"   # not in COMPOSE_PROFILES
batch-worker = "restart"  # not in COMPOSE_PROFILES

# Good — only services that are actually running
[assign.services]
web = "restart"
api = "restart"
```

The same applies to `[assign.rebuild_triggers]` — remove entries for services that are not active.

## Use `"hot"` Where Possible

The `"hot"` strategy skips the container restart entirely. The [filesystem remount](FILESYSTEM.md) swaps the code under `/workspace` and the service's file watcher (Vite, webpack, nodemon, air, etc.) picks up changes automatically.

```toml
[assign.services]
web = "hot"        # Vite/webpack dev server with HMR
api = "restart"    # Rails/Go — needs a process restart
```

`"hot"` is faster than `"restart"` because it avoids the container stop/start cycle. Use it for any service that runs a dev server with file watching. Reserve `"restart"` for services that load code at startup and do not watch for changes (most Rails, Go, and Java apps).

## Use `"rebuild"` With Triggers

If a service's default strategy is `"rebuild"`, every branch switch rebuilds the Docker image — even if nothing affecting the image changed. Add `[assign.rebuild_triggers]` to gate the rebuild on specific files:

```toml
[assign.services]
worker = "rebuild"

[assign.rebuild_triggers]
worker = ["Dockerfile", "package.json", "package-lock.json"]
```

If none of the trigger files changed between branches, Coast skips the rebuild and falls back to a restart instead. This avoids expensive image builds on routine code changes.

## Summary

| Optimization | Impact | Affects | When to use |
|---|---|---|---|
| `exclude_paths` | High | rsync + git diff | Always, in any repo with directories your Coast does not need |
| Remove inactive services | Medium | service restart | When `COMPOSE_PROFILES` limits which services run |
| `"hot"` strategy | Medium | service restart | Services with file watchers (Vite, webpack, nodemon, air) |
| `rebuild_triggers` | Medium | image rebuild | Services using `"rebuild"` that only need it for infra changes |

Start with `exclude_paths`. It is the lowest-effort, highest-impact change you can make. It speeds up both the first assign (rsync) and every subsequent assign (git diff).
