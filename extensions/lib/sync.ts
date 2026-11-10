// sync.ts — the todo→ticket mirror.
//
// A pure function, called from the todo_write execute body (pi loads
// extensions in-process — no subprocess, no hooks): same store method
// (syncStatuses), same fail-open law — the ticket store must NEVER break the
// todo flush.
//
// Item shape: { content, status } where content starts "N: " for items that
// back ticket N. The N is the item's permanent id — never renumbered.

import type { TicketStore } from "./ticket-store.ts";

export interface TodoItem {
  content: string;
  status: string;
  priority?: string;
}

const TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;

export interface FlushResult {
  todos: TodoItem[];
  /** Ticket numbers whose status changed via the mirror. */
  changed: number[];
  /** Set when the mirror failed — the flush itself still succeeded (fail-open). */
  mirrorError?: string;
}

export function normalizeTodos(input: unknown): { todos?: TodoItem[]; error?: string } {
  if (!Array.isArray(input)) return { error: "todos must be an array of { content, status } items" };
  const todos: TodoItem[] = [];
  for (const raw of input) {
    const item = raw as { content?: unknown; status?: unknown; priority?: unknown };
    if (typeof item?.content !== "string" || item.content.trim() === "")
      return { error: "every todo item needs a non-empty 'content' string" };
    const status = typeof item.status === "string" ? item.status : "pending";
    if (!(TODO_STATUSES as readonly string[]).includes(status))
      return { error: `todo status must be one of ${TODO_STATUSES.join("|")} (got "${status}")` };
    const todo: TodoItem = { content: item.content, status: status as TodoItem["status"] };
    if (typeof item.priority === "string") todo.priority = item.priority;
    todos.push(todo);
  }
  return { todos };
}

/**
 * Flush: atomically replace the hot list, then mirror statuses onto tickets.
 * The mirror is owner-scoped (only rows owned by `rolloutId` move) and
 * fail-open: a broken or unwritable store still returns the flushed list.
 */
export function flushTodos(
  store: TicketStore | null,
  todos: TodoItem[],
  rolloutId: string | null,
): FlushResult {
  let changed: number[] = [];
  let mirrorError: string | undefined;
  if (store && rolloutId) {
    try {
      changed = store.syncStatuses(todos, rolloutId);
    } catch (e) {
      mirrorError = (e as Error).message;
    }
  } else if (!rolloutId) {
    mirrorError = "no session identity — mirror skipped";
  }
  return { todos, changed, mirrorError };
}
