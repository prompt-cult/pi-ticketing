---
name: ticketing
description: Use for multi-step or long-lived engineering work — create a ticket to get a ticket number, add a numbered todo item, delegate tickets (with their numbers) to subagents. Tickets survive across sessions and repos.
---

# Ticketing

**A ticket is an immutable record with an append-only comment stream; status is
the only field that ever changes.** The todo list is ephemeral ordering. The
database is ONE SQLite file outside every repo
(`~/.pi/agent/ticketing/ticket.db`), shared by all sessions on all projects
and worktrees; the autoincrement id is the only global ticket number.

## Identity (READ THIS FIRST)

Every ticket and comment is stamped with a rollout id — the pi session id, or,
for a delegated subagent, the delegated namespace injected into its
environment. You never pass your own id on `ticket_add` or `ticket_comment`;
the harness stamps it. The two deliberate exceptions, where an id IS an input:

- `ticket_status` takes the ticket OWNER's `rollout_id` (the owner gate).
- `ticket_list` takes a `rollout_id` to query another session's tickets —
  adopt another session's work by querying its id; `all=true` lists everything.

When delegating, NAME the owner's session id in the launch prompt: the
delegatee needs it for `ticket_status` when the work is done.

## The flow

1. **Create** — `ticket_add todo="one-line summary" md_content=<the full
   spec>`. The body is written ONCE; there is no rewrite action. Returns the
   permanent ticket number **N**. Keep any draft plan in the repo's gitignored
   `.tmp/` scratch only; the database copy is the record.
2. **Todo** — append item **`N: <descriptive name>`** at the END of the todo
   list, where N is the ticket number from step 1 — the N prefix is the
   item's whole id: never renumber, never add any other numbering (no
   "1:", "2:"). The ticket's own summary stays a plain name. Front-jump only
   on an explicit "do it next". Flush
   with `todo_write`: it replaces the list wholesale and mirrors statuses onto
   tickets — closing item `N: ...` sets ticket N's status automatically
   (fail-open: a broken store never breaks the flush).
3. **Work** — everything after creation is a comment:
   `ticket_comment id=N content="..."` — a SHORT go/no-go note (done / not
   done / blocked), 1000 chars max. Long reports NEVER go on the ticket; put
   detail in your final response (or a gist).
4. **Status** — `ticket_status id=N rollout_id=<owner's session id>
   status=...` is the ONLY mutation. To supersede, set the status and name
   the replacement ticket in a comment. Nothing is ever deleted.
5. **Recover** (crashed session) — `ticket_list` (your own tickets), rebuild
   the todo list from your pending/in_progress rows, or `all=true` for every
   session's tickets.

## Delegation — the stack/burndown cycle

1. Orchestrator creates the ticket (body self-contained before launch), pops
   it, and hands the subagent ONLY the ticket number — never a path — via the
   `delegate` tool.
2. Delegatee's first two calls are READS: `ticket_get id=N` (body + comments
   are its full instructions), then `ticket_rules` — obey every rule it
   returns. NO write to the ticket is a prerequisite for starting work: read,
   then work. It never edits the ticket; it reports via short
   `ticket_comment` notes and, when done, sets `ticket_status` with the
   OWNER's session id named in its launch prompt.
3. Orchestrator, on return: marks the todo item done + ticket complete
   (burndown, never delete), then re-runs the gate.
   - **Green** → orchestrator commits (and may push).
   - **Red** → orchestrator raises a follow-on todo + ticket, pushes it onto
     the stack, works it next. Iterate until green.
4. No CI monitoring until all tickets are done. AppVeyor orphans ignored.

**Boilerplate reduction.** Every subagent prompt does NOT re-state the
standing rules — the delegatee's first calls (`ticket_get`, `ticket_rules`)
return them. The tool is the single source of truth.

## Never

- Do not read the SQLite file directly — the tools are the API.
- Do not rewrite or delete a ticket; supersede instead.
- Do not put long reports in comments.
- Do not retry a failing call more than once — re-emit `corrected_call`
  verbatim (fill any `<fill: ...>` placeholder) and the call succeeds.
- A delegatee never flushes the todo list (`todo_write` refuses) — report back
  via `ticket_comment`.

## Errors

Every failure returns `{code, message, corrected_call}`:
- `E_ADD_MISSING_TODO` / `E_ADD_NO_IDENTITY` / `E_ADD_FAILED`
- `E_BAD_ID` / `E_NO_TICKET`
- `E_LIST_SCOPE` (needs `rollout_id` or `all=true`) / `E_BAD_STATUS`
- `E_COMMENT_MISSING_ID` / `E_COMMENT_MISSING_CONTENT` / `E_COMMENT_TOO_LONG`
- `E_STATUS_MISSING_ROLLOUT_ID` (the owner gate) / `E_STATUS_REFUSED` /
  `E_STATUS_BAD_STATUS`
- `E_STORE_UNAVAILABLE` (check `TICKET_DB_HOME`)

The legal parameter set of each tool is enforced at the harness layer
(TypeBox schemas): unknown parameters, wrong types, illegal enum values and
over-long comments are rejected before the tool runs.
