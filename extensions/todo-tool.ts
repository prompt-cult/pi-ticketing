// todo-tool.ts — todo_write: the hot, ordered, per-session todo list.
//
// Ported from the opencode/Vibe todo example. The state lives in tool-result
// details (the todo.ts pattern), so it is automatically correct when you
// branch or fork a session; reconstructState replays the branch on
// session_start / session_tree.
//
// The one pi-specific graft: every flush mirrors statuses onto the ticket
// store (lib/sync.ts, fail-open). The doctrine is enforced here, not in the
// system prompt: a delegatee that calls todo_write is refused — todo_write is
// the ORCHESTRATOR's tool; report back via ticket_comment.
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { currentRolloutId, isDelegatee } from "./lib/session.ts";
import { flushTodos, normalizeTodos, type TodoItem } from "./lib/sync.ts";
import type { TicketStore } from "./lib/ticket-store.ts";

interface TodoDetails {
  action: "flush";
  todos: TodoItem[];
  changed: number[];
  mirrorError?: string;
}

const TodoItemSchema = Type.Object({
  content: Type.String({ description: 'the item text, starting with its ticket number ("N: ...") where a ticket backs it' }),
  status: StringEnum(["pending", "in_progress", "completed", "cancelled"], {
    description: "pending | in_progress | completed | cancelled",
  }),
  priority: Type.Optional(StringEnum(["high", "medium", "low"], { description: "optional ordering hint" })),
});

const TodoWriteParams = Type.Object(
  {
    todos: Type.Array(TodoItemSchema, { description: "the COMPLETE new list — flush semantics: replaces the list wholesale, in order" }),
  },
  { additionalProperties: false },
);

export function registerTodoTool(pi: ExtensionAPI, getStore: () => TicketStore | null) {
  // In-memory hot state, reconstructed from the session branch.
  let todos: TodoItem[] = [];

  const reconstructState = (ctx: ExtensionContext) => {
    todos = [];
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message as { role?: string; toolName?: string; details?: unknown };
      if (msg.role !== "toolResult" || msg.toolName !== "todo_write") continue;
      const details = msg.details as TodoDetails | undefined;
      if (details?.todos) todos = details.todos;
    }
  };

  pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
  pi.on("session_tree", async (_event, ctx) => reconstructState(ctx)); // /tree changes the branch

  pi.registerTool({
    name: "todo_write",
    label: "Todo",
    description: [
      "Flush the ordered todo list: replaces it wholesale with the given items.",
      'Each item that a ticket backs starts with its ticket number ("N: ..."); the number is the item\'s permanent id — never renumber.',
      "Closing an item (status completed/cancelled) mirrors the status onto its ticket automatically.",
      "State survives branching and forking (it lives in the session tree).",
    ].join(" "),
    parameters: TodoWriteParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Single-writer, enforced: a delegatee never flushes the orchestrator's list.
      if (isDelegatee()) {
        return {
          content: [{ type: "text", text: "todo_write is the ORCHESTRATOR's tool — report back via ticket_comment" }],
          details: { action: "flush", todos, changed: [], mirrorError: "delegatee refused" } satisfies TodoDetails,
        };
      }

      const { todos: fresh, error } = normalizeTodos(params.todos);
      if (error || !fresh) {
        return {
          content: [{ type: "text", text: `Error: ${error}` }],
          details: { action: "flush", todos, changed: [], mirrorError: error } satisfies TodoDetails,
        };
      }

      todos = fresh;
      const rolloutId = currentRolloutId(ctx);
      // Fail-open, always: the mirror must never break the todo flush.
      const result = flushTodos(getStore(), todos, rolloutId);
      todos = result.todos;

      const summary = todos.length
        ? todos.map((t) => (t.status === "completed" ? `[x] ${t.content}` : `[ ] ${t.content}`)).join("\n")
        : "(empty list)";
      const mirror = result.mirrorError ? ` (mirror skipped: ${result.mirrorError})` : result.changed.length ? ` (tickets ${result.changed.join(", ")} updated)` : "";
      return {
        content: [{ type: "text", text: `Flushed ${todos.length} item(s)${mirror}\n${summary}` }],
        details: {
          action: "flush",
          todos,
          changed: result.changed,
          ...(result.mirrorError ? { mirrorError: result.mirrorError } : {}),
        } satisfies TodoDetails,
      };
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("todo_write ")) + theme.fg("muted", `${args.todos?.length ?? 0} item(s)`);
      for (const t of (args.todos ?? []).slice(0, 5)) {
        const done = t.status === "completed" || t.status === "cancelled";
        text += `\n  ${done ? theme.fg("success", "✓") : theme.fg("dim", "○")} ${theme.fg(done ? "dim" : "text", t.content)}`;
      }
      if ((args.todos?.length ?? 0) > 5) text += `\n  ${theme.fg("muted", `... ${(args.todos!.length - 5)} more`)}`;
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as TodoDetails | undefined;
      if (details?.mirrorError) return new Text(theme.fg("warning", `mirror skipped: ${details.mirrorError}`), 0, 0);
      if (details?.changed?.length)
        return new Text(theme.fg("muted", `tickets updated: ${details.changed.join(", ")}`), 0, 0);
      return new Text("", 0, 0);
    },
  });
}
