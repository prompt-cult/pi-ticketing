// ticket.test.ts — the split-tool contract: one tool per action, per-tool
// required schemas, and the {code, message, corrected_call} envelope on every
// failure path. The acceptance: a corrected_call re-emitted verbatim
// succeeds. Exercised with node:test (the pi host runs on Node; node:test
// needs no extra runner) without loading pi. TICKET_DB_HOME points at a
// gitignored scratch dir so the shared ticket DB is never touched.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TicketStore } from "./ticket-store.ts";
import {
  executeAdd,
  executeGet,
  executeList,
  executeComment,
  executeStatus,
  executeRules,
  executeHelp,
  fail,
  parseEnvelope,
  toToolResult,
} from "./ticket.ts";

beforeEach(() => {
  process.env.TICKET_DB_HOME = mkdtempSync(join(tmpdir(), "ticket-test-"));
});

function envelope(content: string) {
  const e = parseEnvelope(content);
  assert.ok(e, "expected a parseable envelope");
  return e;
}

async function add(todo: string, rollout_id: string, md_content?: string) {
  const res = await executeAdd(new TicketStore(), { todo, md_content }, rollout_id);
  return JSON.parse(res.text);
}

// ─── The harness-facing result shape (regression: a bare { text } result
//     crashed pi's TUI renderer with content-undefined) ──────────────────────

test("every handler result passes through toToolResult into pi's tool-result shape", async () => {
  const created = await add("shape test", "sess_shape");
  for (const failable of [
    await executeAdd(new TicketStore(), { todo: "x" }, "sess_shape"),
    await executeGet(new TicketStore(), { id: created.id }),
    await executeList({ all: true }, new TicketStore(), "sess_shape"),
    await executeComment(new TicketStore(), { id: created.id, content: "done" }, "sess_shape"),
    await executeStatus(new TicketStore(), { id: created.id, rollout_id: "sess_shape", status: "completed" }, "sess_shape"),
    await executeRules(),
    await executeHelp(),
    fail("E_TEST", "synthetic failure", {}),
  ]) {
    const r = toToolResult(failable);
    assert.ok(Array.isArray(r.content) && r.content.length === 1, "content is a non-empty array");
    assert.equal(r.content[0].type, "text");
    assert.equal(typeof r.content[0].text, "string");
    assert.equal(r.details, undefined);
    if (failable.isError) assert.equal(r.isError, true);
    else assert.equal("isError" in r, false);
  }
});

// ─── The schemas make misuse unrepresentable (harness layer; here we assert
//     the handlers keep the same guarantees as defense in depth) ─────────────

test("add stamps the caller's identity as the owner and returns the global number", async () => {
  const created = await add("happy path", "sess_A", "# the spec, written once");
  assert.ok(created.id > 0);
  assert.equal(created.ticket.rollout_id, "sess_A");
  assert.equal(created.ticket.status, "pending");
});

test("add without identity is refused — the owner is never taken from input", async () => {
  const e = envelope((await executeAdd(new TicketStore(), { todo: "x" }, null)).text);
  assert.equal(e.code, "E_ADD_NO_IDENTITY");
  assert.ok(e.corrected_call);
});

test("add without a store fails open with a structured envelope", async () => {
  const e = envelope((await executeAdd(null, { todo: "x" }, "sess_A")).text);
  assert.equal(e.code, "E_STORE_UNAVAILABLE");
});

test("a missing todo is E_ADD_MISSING_TODO with a fillable corrected_call", async () => {
  const e = envelope((await executeAdd(new TicketStore(), {}, "sess_A")).text);
  assert.equal(e.code, "E_ADD_MISSING_TODO");
  assert.equal(e.corrected_call.todo, "<fill: one-line summary>");
});

test("get: by number, no session id needed; unknown id is E_NO_TICKET", async () => {
  const created = await add("get me", "sess_G");
  const got = JSON.parse((await executeGet(new TicketStore(), { id: created.id })).text);
  assert.equal(got.todo, "get me");
  assert.equal(got.rollout_id, "sess_G");

  const missing = envelope((await executeGet(new TicketStore(), { id: 424242 })).text);
  assert.equal(missing.code, "E_NO_TICKET");

  const bad = envelope((await executeGet(new TicketStore(), { id: "seven" })).text);
  assert.equal(bad.code, "E_BAD_ID");
});

test("list: one session by id, status filter combines, all=true lists every session", async () => {
  await add("list a", "sess_listA");
  await add("list b", "sess_listB");
  const store = new TicketStore();

  const mine = JSON.parse((await executeList({ rollout_id: "sess_listA" }, store, "sess_listA")).text);
  assert.ok(mine.length > 0);
  assert.ok(mine.every((r: { rollout_id: string }) => r.rollout_id === "sess_listA"));

  const minePending = JSON.parse(
    (await executeList({ rollout_id: "sess_listA", status: "pending" }, store, "sess_listA")).text,
  );
  assert.ok((minePending as { status: string }[]).every((r) => r.status === "pending"));

  const everyone = JSON.parse((await executeList({ all: true }, store, "sess_listA")).text);
  assert.ok((everyone as { rollout_id: string }[]).some((r) => r.rollout_id === "sess_listB"));

  const bare = envelope((await executeList({}, store, "sess_listA")).text);
  assert.equal(bare.code, "E_LIST_SCOPE");
  assert.ok(bare.message.includes("all=true"));

  // self-heal: the corrected_call carries a fillable scope
  assert.ok(bare.corrected_call.rollout_id);
});

test("comment: appended one at a time, author stamped, 1000-char cap enforced", async () => {
  const created = await add("comment me", "sess_C");
  const store = new TicketStore();

  const ok1 = JSON.parse((await executeComment(store, { id: created.id, content: "done" }, "sess_commenter")).text);
  assert.equal(ok1.ticket_id, created.id);
  assert.equal(ok1.author_rollout_id, "sess_commenter");

  const tooLong = envelope((await executeComment(store, { id: created.id, content: "x".repeat(1001) }, "sess_commenter")).text);
  assert.equal(tooLong.code, "E_COMMENT_TOO_LONG");
  assert.ok(tooLong.message.includes("gist"));

  const noContent = envelope((await executeComment(store, { id: created.id }, "sess_commenter")).text);
  assert.equal(noContent.code, "E_COMMENT_MISSING_CONTENT");

  const missing = envelope((await executeComment(store, { id: 424242, content: "x" }, "sess_commenter")).text);
  assert.equal(missing.code, "E_NO_TICKET");
});

test("status: the owner gate — non-owner refused, envelope names the owner; verbatim re-emit succeeds", async () => {
  const created = await add("status me", "sess_ownerS");
  const store = new TicketStore();

  const refused = envelope(
    (await executeStatus(store, { id: created.id, rollout_id: "sess_wrong", status: "completed" }, "sess_delegatee")).text,
  );
  assert.equal(refused.code, "E_STATUS_REFUSED");
  assert.ok(refused.message.includes("sess_ownerS"));
  assert.equal(refused.corrected_call.rollout_id, "sess_ownerS");

  // ACCEPTANCE: re-emit corrected_call verbatim — the call succeeds.
  const retry = JSON.parse((await executeStatus(store, refused.corrected_call, "sess_delegatee")).text);
  assert.equal(retry.status, "completed");
  assert.equal(retry.last_actor, "sess_delegatee");
});

test("status: a bogus status is E_BAD_STATUS with the legal values named", async () => {
  const created = await add("enum gate", "sess_enum");
  const e = envelope(
    (await executeStatus(new TicketStore(), { id: created.id, rollout_id: "sess_enum", status: "bogus" }, "sess_enum")).text,
  );
  assert.equal(e.code, "E_BAD_STATUS");
  assert.ok(e.message.includes("pending|in_progress|completed|cancelled|superseded"));
});

test("status: a missing rollout_id is E_STATUS_MISSING_ROLLOUT_ID naming the real owner", async () => {
  const created = await add("owner name", "sess_ownerM");
  const e = envelope((await executeStatus(new TicketStore(), { id: created.id, status: "pending" }, "sess_x")).text);
  assert.equal(e.code, "E_STATUS_MISSING_ROLLOUT_ID");
  assert.ok(e.message.includes("sess_ownerM"));
});

// ─── The contract text ──────────────────────────────────────────────────────

test("help states the whole contract: tools, doctrine, envelope; no action strings", async () => {
  const content = (await executeHelp()).text;
  for (const tool of [
    "ticket_add",
    "ticket_get",
    "ticket_list",
    "ticket_comment",
    "ticket_status",
    "ticket_rules",
    "ticket_help",
  ]) {
    assert.ok(content.includes(tool), `help mentions ${tool}`);
  }
  assert.ok(content.includes("rollout_id IS the session id"));
  assert.ok(content.includes("Too simple to get wrong"));
  assert.ok(content.includes("corrected_call"));
  assert.ok(content.includes("IMMUTABLE record"));
});

test("rules banner: the delegatee doctrine, immutability, no-prereq, envelope recovery", async () => {
  const content = (await executeRules()).text;
  assert.ok(content.includes("you are the DELEGATEE"));
  assert.ok(content.includes("THE TICKET IS IMMUTABLE"));
  assert.ok(content.includes("NO write to the ticket"));
  assert.ok(content.includes("No commit, no push"));
  assert.ok(content.includes("ticket_get id=N"));
  assert.ok(content.includes("ticket_status with the OWNER's session id"));
  assert.ok(content.includes("re-emit corrected_call verbatim"));
  assert.ok(content.includes("STOP calling it"));
});

// ─── The todo→ticket mirror (syncStatuses) ──────────────────────────────────

test("the todowrite mirror is unchanged: flushing 'N: …' closes ticket N for the flushing session only", async () => {
  const created = await add("mirror me", "sess_mirror");
  const store = new TicketStore();

  const changed = store.syncStatuses([{ content: `${created.id}: mirror`, status: "completed" }], "sess_mirror");
  assert.deepEqual(changed, [created.id]);
  const row = JSON.parse((await executeGet(store, { id: created.id })).text);
  assert.equal(row.status, "completed");

  // scoped: another session's flush never touches it
  store.setStatus(created.id, { rollout_id: "sess_mirror", status: "pending", last_actor: null });
  const changed2 = store.syncStatuses([{ content: `${created.id}: mirror`, status: "in_progress" }], "sess_other");
  assert.deepEqual(changed2, []);

  // non-"N: " items are ignored
  const changed3 = store.syncStatuses([{ content: "no ticket here", status: "completed" }], "sess_mirror");
  assert.deepEqual(changed3, []);

  store.close();
});
