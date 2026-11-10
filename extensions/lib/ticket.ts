// ticket.ts — the tool contract. One tool per action; every failure returns
// the { code, message, corrected_call } envelope; corrected_call is the
// COMPLETE call — received values kept, missing ones filled with REAL ids
// wherever they are derivable — so a failing model re-emits it verbatim and
// succeeds.
//
// THE CONTRACT: a ticket is an IMMUTABLE record with an append-only comment
// stream; STATUS is the only field that ever changes; nothing is ever
// deleted. Access is by ticket number.
//
// This module is deliberately pure: no pi, no typebox, no harness imports.
// The harness-facing TypeBox schemas live in ../schemas.ts; the registration
// wrappers live in the extension entry. That keeps the contract unit-testable
// on a bare Node runtime (see ticket.test.ts).
//
// Division of labour with the harness:
//   * Schema violations (wrong types, illegal enum values, unknown keys,
//     over-long comments) are rejected by pi at the harness layer, before
//     execute() runs. The handlers keep semantic checks (empty strings,
//     unknown ids, owner gate) as defense in depth, returning the same
//     stable envelope codes.
//   * ticket_add takes NO session id. pi knows its own session; the owner is
//     stamped from ground truth (session.ts). Only ticket_status (the owner
//     gate) and ticket_list (cross-session adoption) still take ids as input.
//   * The caller's identity arrives as an explicit `callerId` argument —
//     resolved by the extension from session.ts, never from the model.
import type { TicketStore, TicketRow, TicketStatus } from "./ticket-store.ts";

export {
  TicketStore,
  STATUSES,
  ticketDbPath,
} from "./ticket-store.ts";
export type { TicketRow, TicketComment, TicketStatus } from "./ticket-store.ts";

export const STATUS_VALUES: readonly TicketStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
  "superseded",
];

// ─── The error envelope ─────────────────────────────────────────────────────

const HELP_HINT = " — recover with one call: ticket_help";

export interface Failable {
  text: string;
  isError?: boolean;
}

export function fail(code: string, message: string, correctedCall: Record<string, unknown>): Failable {
  return {
    text: JSON.stringify({ code, message: message + HELP_HINT, corrected_call: correctedCall }, null, 2),
    isError: true,
  };
}

export function ok(payload: unknown): Failable {
  return { text: JSON.stringify(payload, null, 2) };
}

/**
 * The ONLY place the contract's { text } shape meets pi's tool-result shape.
 * pi tool results MUST be { content: [{ type: "text", text }], details } —
 * a bare { text } reaches the TUI renderer with content undefined and crashes
 * it (getTextOutput filters content). Every registerTool wrapper passes its
 * handler result through this.
 */
export function toToolResult(r: Failable): {
  content: Array<{ type: "text"; text: string }>;
  details: undefined;
  isError?: boolean;
} {
  return {
    content: [{ type: "text", text: r.text }],
    details: undefined,
    ...(r.isError ? { isError: true } : {}),
  };
}

/** Parsed envelope or null — for tests and self-heal re-emit logic. */
export function parseEnvelope(content: string): { code: string; message: string; corrected_call: Record<string, unknown> } | null {
  try {
    const o = JSON.parse(content);
    if (o && typeof o.code === "string" && typeof o.message === "string" && o.corrected_call && typeof o.corrected_call === "object")
      return o;
    return null;
  } catch {
    return null;
  }
}

// ─── Per-tool descriptions (harness-facing; full text lives here so the
//     schemas file stays mechanical) ─────────────────────────────────────────

export const ADD_DESC = `Create a ticket: an immutable record with an append-only comment stream.
todo = the one-line summary; md_content = the spec, written ONCE here (the
immutable body — there is no rewrite action). Returns the permanent global
ticket number N; number your todo item "N: ..." with it. Your session id is
stamped automatically as the owner — do not pass one.`;

export const GET_DESC = `Read one ticket: the row (id, created, updated, todo, status, owner,
last_actor, md_content) plus its comments, oldest first. Reads are by ticket
number — no session id needed.`;

export const LIST_DESC = `List tickets. Pass rollout_id to query ONE session's tickets (adoption:
query another session's id to adopt its work), all=true for every session's,
or neither to list your own. status filters: pending|in_progress|completed|cancelled|superseded.`;

export const COMMENT_DESC = `Append ONE comment to a ticket: a short go/no-go note — done / not done /
blocked — 1000 chars max. Long reports NEVER go on the ticket; put detail in
your final response (or a gist). Any session may append; the author is
stamped automatically from this session's identity.`;

export const STATUS_DESC = `The ONLY mutation: set a ticket's status (pending|in_progress|completed|
cancelled|superseded). rollout_id = the ticket's OWNING session id (owner
gate). Closing todo item "N: ..." mirrors this automatically; use this tool
for everything else. To supersede, also comment the replacement ticket number.`;

export const RULES_DESC = `The delegatee banner: who you are (DELEGATEE), the immutability law, your
only writes, the standing subagent rules, and the envelope recovery. The
second call a launched subagent makes, right after ticket_get.`;

export const HELP_DESC = `The whole ticket contract in one call: the tools, the identity doctrine,
statuses, delegation, and the error envelope. The recovery for a lost agent.`;

// ─── The contract text ──────────────────────────────────────────────────────

export function helpText(): string {
  return `ticket — the whole contract (one call to recover it)

A ticket is an IMMUTABLE record with an append-only comment stream; STATUS is
the only field that ever changes. Nothing is ever deleted. One tool per
action — there is no action string to spell wrongly:

- ticket_add todo="one-line summary" [md_content=spec] -> creates the ticket
  and returns its permanent global number N. The body (md_content) is written
  ONCE, here — never after. Your session is stamped as the owner; you never
  pass a session id to add.
- ticket_get id=N -> the row plus its comments, chronological.
- ticket_list [rollout_id=<session id>] [status=...] [all=true] -> without
  rollout_id or all, your own tickets; with rollout_id, that session's
  (adoption: query another session's id to adopt its work); all=true lists
  every session's tickets.
- ticket_comment id=N content="..." -> the only write after creation: a SHORT
  go/no-go note — done / not done / blocked — 1000 chars max. Long reports
  NEVER go on the ticket; put detail in your final response (or a gist). Any
  session may append; the author is stamped automatically.
- ticket_status id=N rollout_id=<owner's session id> status=<pending|
  in_progress|completed|cancelled|superseded> -> the ONLY mutation, gated to
  the ticket's owner. Closing the todo item "N: ..." mirrors the status
  automatically; this tool covers the rest. To supersede, also comment the
  replacement ticket number.
- ticket_rules -> the delegatee's banner (a launched subagent's second call).
- ticket_help -> this text.

Identity: rollout_id IS the session id — one id, no other. Every ticket and
comment is stamped with it: the pi session id, or, for a delegated subagent,
the delegated namespace injected into its environment. You never pass your
own id; the harness stamps it. The two deliberate exceptions, where an id IS
an input:
- ticket_status takes the ticket OWNER's rollout_id (the owner gate).
- ticket_list takes a rollout_id to query another session's tickets.
When delegating, NAME the owner's session id in the launch prompt: the
delegatee needs it for ticket_status when the work is done.

WHO DOES WHAT (delegation):
- The DELEGATOR (main agent) creates the ticket — body self-contained before
  launch — then hands the subagent ONLY the ticket number (use the delegate
  tool). It owns the todo list and does the final review.
- The DELEGATEE (subagent) makes two reads first: ticket_get id=N, then
  ticket_rules. It never edits the ticket — there is no rewrite action — and
  needs no write to start work. It reports via short ticket_comment notes and,
  when done, sets ticket_status with the owner's id named in its launch
  prompt. It NEVER flushes the todo list: todo_write is the orchestrator's
  tool.
- The DELEGATOR reviews the diff, runs the tests, and commits.

Errors: every failure returns { code, message, corrected_call }. corrected_call
is the COMPLETE call — your received values kept, the missing ones filled with
real ids wherever they are derivable. Re-emit it verbatim (fill any
"<fill: ...>" placeholder) and the call succeeds.

Mark-complete vs drop: a subagent marks its ticket done; only the orchestrator
removes todo items. There is no delete action for anything. Never read the
SQLite file directly — the tools are the API. Access is by ticket number
everywhere else. Too simple to get wrong.`;
}

export function rulesText(): string {
  return `WHO YOU ARE: you are the DELEGATEE — a subagent launched by the main agent
(the DELEGATOR), which created the ticket and handed you only its number. The
rules below are for you; the DELEGATOR does not read them. Your first two
calls are reads: ticket_get id=N (your instructions — the body was written
once, before your launch) and this banner, ticket_rules.

THE TICKET IS IMMUTABLE. There is no rewrite action, and
NO write to the ticket is a prerequisite for starting work: read the ticket,
read these rules, then DO THE WORK.

Your writes are exactly two:
- ticket_comment id=N — SHORT go/no-go notes (done / not done / blocked,
  1000 chars max). Long reports NEVER go on the ticket: put detail in your
  final response to the orchestrator (or a gist).
- ticket_status id=N rollout_id=<owner's id> status=... — when the work is
  done. The owner's session id is named in your launch prompt; your own
  writes are stamped with your delegated namespace automatically.

todo_write is the ORCHESTRATOR's tool. You never flush the todo list; report
via comments and your final response instead. The DELEGATOR reviews the diff,
runs the tests, and commits — you do not.

Subagent standing rules — obey all of them:
- Read the repo's AGENTS.md if it exists and obey it.
- No commit, no push, no PR creation, no watch/poll of CI.
- Only run tests and git add.
- No rm/reset/stash; mv into .tmp/ instead; never /tmp.
- No issue numbers in committed files, messages, docs, or comments.
- EN/CN parity for any doc you touch.
- Tee all command output to .tmp/clobber_me_NN.txt (incrementing NN).
- bare-env macOS proof: env -u HOMEBREW_PREFIX -u PKG_CONFIG_PATH ...
- AppVeyor checks are orphaned; ignore them.
- Discover extra work? Record it as a ticket comment. Do not chase it.
- If the same ticket call fails twice with the same error, STOP calling it:
  state the blocker in your final report. Never retry a third time.
- On any error, re-emit corrected_call verbatim — it is the complete call.
  Mark your ticket done (ticket_status with the OWNER's session id) when the
  work is done; never remove todo items — that is the orchestrator's alone.`;
}

// ─── Handlers ───────────────────────────────────────────────────────────────
// Pure: (store, args, identity) -> { text, isError? }. Schema validation
// already happened at the harness layer; these checks cover semantics and
// direct/test invocation. Every failure carries the complete corrected_call.

export function executeAdd(
  store: TicketStore | null,
  args: { todo?: unknown; md_content?: unknown },
  callerRolloutId: string | null,
): Failable {
  const todo = typeof args?.todo === "string" ? args.todo : undefined;
  const md = typeof args?.md_content === "string" ? args.md_content : undefined;
  const corrected: Record<string, unknown> = { todo: todo ?? "<fill: one-line summary>" };
  if (md !== undefined) corrected.md_content = md;

  if (!store)
    return fail("E_STORE_UNAVAILABLE", "the ticket store could not be opened (check TICKET_DB_HOME); nothing was created", corrected);
  if (!callerRolloutId)
    return fail("E_ADD_NO_IDENTITY", "ticket_add could not resolve this session's identity (no session id; not a delegate)", {
      ...corrected,
    });
  if (!todo) return fail("E_ADD_MISSING_TODO", "ticket_add requires 'todo' (the one-line summary)", corrected);
  try {
    const row = store.add({ todo, md_content: md, rollout_id: callerRolloutId });
    return ok({ id: row.id, ticket: row });
  } catch (e) {
    return fail("E_ADD_FAILED", (e as Error).message, corrected);
  }
}

export function executeGet(store: TicketStore | null, args: { id?: unknown }): Failable {
  const corrected: Record<string, unknown> = { id: typeof args?.id === "number" ? args.id : "<fill: ticket number>" };
  if (typeof args?.id !== "number" || !Number.isInteger(args.id) || args.id < 0)
    return fail("E_BAD_ID", "ticket_get requires 'id': the ticket number", corrected);
  if (!store) return fail("E_STORE_UNAVAILABLE", "the ticket store could not be opened (check TICKET_DB_HOME)", corrected);
  const row = store.get(args.id);
  if (!row) return fail("E_NO_TICKET", `no ticket with number ${args.id}`, corrected);
  const comments = store.getComments(args.id);
  const text = comments.length
    ? `${JSON.stringify(row, null, 2)}\n--- comments (chronological) ---\n${comments
        .map((c) => `[${c.created_at}] ${c.content}`)
        .join("\n")}`
    : JSON.stringify(row, null, 2);
  return { text };
}

export function listArgs(
  args: { rollout_id?: unknown; status?: unknown; all?: unknown },
  store: TicketStore | null,
  callerRolloutId: string | null,
): { filter: { rollout_id?: string; status?: TicketStatus; all?: boolean }; error?: Failable } {
  const all = args?.all === true;
  const rollout = typeof args?.rollout_id === "string" && args.rollout_id ? args.rollout_id : undefined;
  const status = typeof args?.status === "string" && STATUS_VALUES.includes(args.status as TicketStatus)
    ? (args.status as TicketStatus)
    : undefined;
  if (args?.status !== undefined && status === undefined)
    return {
      filter: {},
      error: fail(
        "E_BAD_STATUS",
        `ticket_list: 'status' must be one of ${STATUS_VALUES.join("|")}`,
        { rollout_id: rollout ?? callerRollout ?? "<fill: session id>", all: all || undefined, status: "pending" },
      ),
    };
  if (!rollout && !all)
    return {
      filter: {},
      error: fail(
        "E_LIST_SCOPE",
        "ticket_list needs a scope: pass rollout_id (a session id — yours is stamped automatically, so omit it to list your own), or all=true for every session",
        { rollout_id: callerRolloutId ?? "<fill: session id to query>", all: true },
      ),
    };
  if (!store)
    return {
      filter: {},
      error: fail("E_STORE_UNAVAILABLE", "the ticket store could not be opened (check TICKET_DB_HOME)", { rollout_id: rollout, all: all || undefined }),
    };
  return { filter: { rollout_id: rollout, status, all: all || undefined } };
}

export function executeList(
  args: { rollout_id?: unknown; status?: unknown; all?: unknown },
  store: TicketStore | null,
  callerRolloutId: string | null,
): Failable {
  const { filter, error } = listArgs(args, store, callerRolloutId);
  if (error) return error;
  try {
    return ok(store!.list(filter));
  } catch (e) {
    return fail("E_LIST_FAILED", (e as Error).message, { rollout_id: filter.rollout_id, all: filter.all });
  }
}

export function executeComment(
  store: TicketStore | null,
  args: { id?: unknown; content?: unknown },
  authorRolloutId: string | null,
): Failable {
  const id = typeof args?.id === "number" ? args.id : undefined;
  const content = typeof args?.content === "string" ? args.content : undefined;
  const corrected: Record<string, unknown> = {
    id: id ?? "<fill: ticket number>",
    content: content ?? "<fill: done / not done / blocked>",
  };
  if (id === undefined) return fail("E_MISSING_ID", "ticket_comment requires 'id': the ticket number", corrected);
  if (!store) return fail("E_STORE_UNAVAILABLE", "the ticket store could not be opened (check TICKET_DB_HOME)", corrected);
  if (!content) return fail("E_COMMENT_MISSING_CONTENT", "ticket_comment requires 'content': a short go/no-go note", corrected);
  if (content.length > 1000)
    return fail(
      "E_COMMENT_TOO_LONG",
      "a comment is a short go/no-go note — done / not done / blocked — 1000 chars max. Long reports NEVER go on the ticket: put the detail in your final response (or a gist)",
      { id, content: "<fill: short note>" },
    );
  try {
    return ok(store.appendComment(id, content, authorRolloutId));
  } catch (e) {
    return fail("E_NO_TICKET", (e as Error).message.replace("appendComment", "ticket_comment"), corrected);
  }
}

export function executeStatus(
  store: TicketStore | null,
  args: { id?: unknown; rollout_id?: unknown; status?: unknown },
  callerRolloutId: string | null,
): Failable {
  const id = typeof args?.id === "number" ? args.id : undefined;
  const row = typeof id === "number" ? (store?.get(id) ?? undefined) : undefined;
  const statusLegal = typeof args?.status === "string" && STATUS_VALUES.includes(args.status as TicketStatus);
  // corrected_call self-heals: when the ticket is known, the REAL owner id is
  // filled in, and the status is legal — verbatim re-emit succeeds.
  const corrected: Record<string, unknown> = row
    ? { id: row.id, rollout_id: row.rollout_id, status: statusLegal ? args.status : "pending" }
    : {
        id: id ?? "<fill: ticket number>",
        rollout_id: typeof args?.rollout_id === "string" && args.rollout_id ? args.rollout_id : "<fill: the ticket owner's session id>",
        status: statusLegal ? args.status : "pending",
      };

  if (id === undefined) return fail("E_MISSING_ID", "ticket_status requires 'id': the ticket number", corrected);
  if (!row) return fail("E_NO_TICKET", `no ticket with number ${id}`, { id });
  if (!statusLegal)
    return fail(
      "E_BAD_STATUS",
      `ticket_status: 'status' must be one of ${STATUS_VALUES.join("|")}`,
      corrected,
    );
  if (!store)
    return fail("E_STORE_UNAVAILABLE", "the ticket store could not be opened (check TICKET_DB_HOME)", corrected);
  if (typeof args.rollout_id !== "string" || !args.rollout_id)
    return fail("E_STATUS_MISSING_ROLLOUT_ID", `ticket_status requires 'rollout_id': the OWNING session id ("${row.rollout_id}")`, corrected);
  try {
    const updated = store.setStatus(id, {
      rollout_id: args.rollout_id,
      status: args.status as TicketStatus,
      last_actor: callerRolloutId,
    });
    if (!updated) return fail("E_NO_TICKET", `no ticket with number ${id}`, corrected);
    return ok(updated);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("refused")) return fail("E_STATUS_REFUSED", `${msg} — the owner's session id is "${row.rollout_id}"`, corrected);
    return fail("E_STATUS_FAILED", msg, corrected);
  }
}

export function executeRules(): Failable {
  return { text: rulesText() };
}

export function executeHelp(): Failable {
  return { text: helpText() };
}
