# pi-ticketing

Tickets + todos + delegation for [pi](https://pi.dev) — three capabilities pi
does not ship, as one package:

- **Tickets** — an IMMUTABLE record with an APPEND-ONLY comment stream;
  STATUS is the only field that ever changes. Nothing is ever deleted.
- **Todos** — a hot, ordered, per-session list (state lives in the session
  tree, so it is branch-correct). Closing item `N: …` mirrors ticket N's
  status automatically (fail-open).
- **Delegation** — spawned pi subagents that work a ticket in an isolated
  context, their writes stamped into a delegated namespace.

The contract:

- `rollout_id` IS the session id — one id, no other. It is stamped from
  ground truth (the pi session id, or the namespace injected into a
  subagent's environment) — never taken from model input.
- One tool per action; TypeBox schemas enforce each tool's legal parameters
  at the harness layer; every failure returns
  `{code, message, corrected_call}` (re-emit verbatim → success).
- One SQLite DB outside every repo, shared by all sessions on all projects
  and worktrees: `~/.pi/agent/ticketing/ticket.db`
  (override with `TICKET_DB_HOME`). `node:sqlite` — zero runtime
  dependencies.

## Tools

`ticket_add` / `ticket_get` / `ticket_list` / `ticket_comment` /
`ticket_status` / `ticket_rules` / `ticket_help`, plus `todo_write`,
`delegate`, and the `/tickets` overlay. Full contract: `ticket_help`.

## Install

Two routes: into a target git repo (project-local), or into your global pi
config (every project, this user).

### Project-local — `make install-repo DEST=<path/to/git-repo>`

```sh
make install-repo DEST=~/work/some-repo        # → some-repo/.pi/
make install-repo DEST=~/work/some-repo PRUNE=1  # prune stale files first
make uninstall-repo DEST=~/work/some-repo
```

Produces:

```text
<repo>/
└── .pi/
    ├── extensions/pi-ticketing/   # index.ts + lib/ + tools (one level deep — pi's discovery rule)
    └── skills/ticketing/SKILL.md  # discovered recursively
```

The destination must be a directory containing `.git` (worktrees count — the
check is `test -e`, and a worktree's `.git` is a file). Without it the install
refuses, so a path typo can't spray `.pi/` into an unrelated directory.
Project-local extensions load after you trust the project; run `/reload` if a
session is live. Commit `.pi/` to share the extension with the repo's other
users; `PRUNE=1` is the safe re-install when files were removed in a newer
version (default overwrite is idempotent but never deletes).

### Global — `make install-global`

```sh
make install-global             # → ~/.pi/agent/extensions/pi-ticketing/ + skills/ticketing/
make uninstall-global
```

Loads in every project with no trust prompt. Run `/reload` in a live pi
session to pick it up immediately.

### Other routes

```sh
pi -e ./extensions/index.ts     # try it for one invocation, no install
make test                       # 13 contract tests, no pi needed
```

The payload is only `extensions/` + `skills/ticketing/` — no build step, no
`npm install` at the destination (the extension imports only host-provided
packages plus `node:sqlite`), and the installers never stage or commit
anything in the target repo.

## Test

```sh
node --test --experimental-strip-types extensions/lib/ticket.test.ts
```

13 tests: the split-tool contract, identity stamping, the envelope on every
failure path, the verbatim-re-emit acceptance, the delegatee refusal, and the
todo→ticket mirror.

## Layout

```
Makefile                   install-repo / install-global / uninstall / test / help
package.json               pi-package manifest (peerDependencies, no runtime deps)
extensions/index.ts        entry: store singleton, session lifecycle, 7 ticket tools
extensions/schemas.ts      TypeBox schemas — misuse unrepresentable at the harness layer
extensions/todo-tool.ts    todo_write — hot list, delegatee refusal, fail-open mirror
extensions/delegate-tool.ts  delegate — spawned pi subagents, TICKET_ROLLOUT_ID namespaces
extensions/render.ts       /tickets overlay (grouped by status, Escape closes)
extensions/lib/ticket.ts   the contract: handlers, envelope, help/rules text
extensions/lib/ticket-store.ts  TicketStore (node:sqlite), TABLE ticket + ticket_comment
extensions/lib/session.ts  rollout-id resolution (env > captured session id)
extensions/lib/sync.ts     the todo→ticket mirror, in-process
extensions/lib/ticket.test.ts   the contract tests
skills/ticketing/          SKILL.md — the flow + delegation doctrine
DESIGN.md                  the design (architecture, decisions, why)
```
