// index.ts — the pi-ticketing extension entry.
//
// Registers, in order: the ticket tools (Step 3 of the design — add/get/list/
// comment/status/rules/help), todo_write (the hot list, with the fail-open
// ticket mirror), delegate (spawned pi subagents with injected namespaces),
// the /tickets overlay, and the session-id capture + store lifecycle.
//
// The store is a lazy singleton: opened on first use, closed on
// session_shutdown. It lives outside every repo — one SQLite file (WAL) shared
// by all sessions and projects; the autoincrement id is the only global ticket
// number.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { captureSession, currentRolloutId } from "./lib/session.ts";
import { TicketStore, ticketDbPath } from "./lib/ticket-store.ts";
import {
  executeAdd,
  executeComment,
  executeGet,
  executeHelp,
  executeList,
  executeRules,
  executeStatus,
  ADD_DESC,
  COMMENT_DESC,
  GET_DESC,
  HELP_DESC,
  LIST_DESC,
  RULES_DESC,
  STATUS_DESC,
} from "./lib/ticket.ts";
import { ADD_PARAMS, COMMENT_PARAMS, GET_PARAMS, LIST_PARAMS, NONE_PARAMS, STATUS_PARAMS } from "./schemas.ts";
import { registerTodoTool } from "./todo-tool.ts";
import { registerDelegateTool } from "./delegate-tool.ts";
import { registerTicketsOverlay } from "./render.ts";

export default function (pi: ExtensionAPI) {
  // ─── Store singleton (session-scoped lifecycle) ──────────────────────────
  let store: TicketStore | null = null;
  const getStore = (): TicketStore | null => {
    if (!store) {
      try {
        store = new TicketStore(ticketDbPath());
      } catch {
        return null; // fail-open: unwritable home → tools report, todo still flushes
      }
    }
    return store;
  };

  pi.on("session_start", async (_event, ctx) => {
    captureSession(ctx); // stamp ground truth once per session
    getStore(); // warm the store so the first tool call is fast
  });
  pi.on("session_shutdown", async () => {
    store?.close();
    store = null;
  });

  // ─── The ticket tools (pure handlers + schemas + renderers) ─────────────

  pi.registerTool({
    name: "ticket_add",
    label: "Ticket Add",
    description: ADD_DESC,
    parameters: ADD_PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      return executeAdd(getStore(), params, currentRolloutId(ctx));
    },
  });

  pi.registerTool({
    name: "ticket_get",
    label: "Ticket Get",
    description: GET_DESC,
    parameters: GET_PARAMS,
    async execute(_id, params) {
      return executeGet(getStore(), params);
    },
  });

  pi.registerTool({
    name: "ticket_list",
    label: "Ticket List",
    description: LIST_DESC,
    parameters: LIST_PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      return executeList(params, getStore(), currentRolloutId(ctx));
    },
  });

  pi.registerTool({
    name: "ticket_comment",
    label: "Ticket Comment",
    description: COMMENT_DESC,
    parameters: COMMENT_PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      return executeComment(getStore(), params, currentRolloutId(ctx));
    },
  });

  pi.registerTool({
    name: "ticket_status",
    label: "Ticket Status",
    description: STATUS_DESC,
    parameters: STATUS_PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      return executeStatus(getStore(), params, currentRolloutId(ctx));
    },
  });

  pi.registerTool({
    name: "ticket_rules",
    label: "Ticket Rules",
    description: RULES_DESC,
    parameters: NONE_PARAMS,
    async execute() {
      return executeRules();
    },
  });

  pi.registerTool({
    name: "ticket_help",
    label: "Ticket Help",
    description: HELP_DESC,
    parameters: NONE_PARAMS,
    async execute() {
      return executeHelp();
    },
  });

  // ─── todo_write, delegate, /tickets ─────────────────────────────────────
  registerTodoTool(pi, getStore);
  registerDelegateTool(pi, getStore);
  registerTicketsOverlay(pi, getStore);
}
