# pi-ticketing

Tickets + todos + delegation for [pi](https://pi.dev), ported from
[opencode-ticketing](https://github.com/prompt-cult/opencode-ticketing)
(v2.2.1) via the Mistral Vibe plugin. Same contract, native pi surface:

- A ticket is an IMMUTABLE record with an APPEND-ONLY comment stream; STATUS
  is the only field that ever changes. Nothing is ever deleted.
- `rollout_id` IS the session id — one id, no other. It is stamped from ground
  truth (the pi session id, or the delegated namespace injected into a
  subagent's environment) — never taken from model input.
- One tool per action; TypeBox schemas enforce each tool's legal parameters at
  the harness layer; every failure returns
  `{code, message, corrected_call}` (re-emit verbatim → success).
- The todo list is hot ordering (`todo_write`, state in tool-result details —
  branch-correct); the ticket store is cold storage. Closing todo item
  `N: …` mirrors ticket N's status automatically (fail-open).
- One SQLite DB outside every repo, shared by all sessions on all projects
  and worktrees: `~/.pi/agent/ticketing/ticket.db`
  (override with `TICKET_DB_HOME`). `node:sqlite` — no runtime dependencies.

## Tools

`ticket_add` / `ticket_get` / `ticket_list` / `ticket_comment` /
`ticket_status` / `ticket_rules` / `ticket_help`, plus `todo_write`,
`delegate`, and the `/tickets` overlay. Full contract: `ticket_help`.

## Install

```sh
pi install ./pi-ticketing          # local package
pi install git:github.com/prompt-cult/pi-ticketing@pi-extension
pi -e ./extensions/index.ts        # or try it for one invocation
```

## Test

```sh
node --test --experimental-strip-types extensions/lib/ticket.test.ts
```

13 tests: the split-tool contract, identity stamping, the envelope on every
failure path, the verbatim-re-emit acceptance, the delegatee refusal, and the
todo→ticket mirror.

## Layout

```
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
DESIGN.md                  the port design (file-by-file mapping from the Vibe plugin)
```
