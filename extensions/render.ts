// render.ts — the /tickets overlay: a TUI component fed by the store.
//
// The per-tool renderCall/renderResult live inline on each tool (the todo.ts
// pattern). This file holds the one piece of real custom UI: a modal overlay
// listing the current session's tickets, grouped by status, fed by
// store.list() for the current rollout id — with `all` showing every session's.
// Escape closes.
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { currentRolloutId } from "./lib/session.ts";
import type { TicketRow, TicketStore } from "./lib/ticket-store.ts";

const STATUS_ORDER = ["in_progress", "pending", "completed", "cancelled", "superseded"] as const;

class TicketsOverlay {
  private rows: TicketRow[];
  private theme: Theme;
  private onClose: () => void;
  private showAll: boolean;

  constructor(rows: TicketRow[], theme: Theme, onClose: () => void, showAll: boolean) {
    this.rows = rows;
    this.theme = theme;
    this.onClose = onClose;
    this.showAll = showAll;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) this.onClose();
  }

  render(width: number): string[] {
    const th = this.theme;
    const lines: string[] = [];
    const header =
      th.fg("borderMuted", "─".repeat(3)) +
      th.fg("accent", ` tickets ${this.showAll ? "(all sessions)" : "(this session)"} `) +
      th.fg("borderMuted", "─".repeat(Math.max(0, width - 22)));
    lines.push(truncateToWidth(header, width));

    if (this.rows.length === 0) {
      lines.push(truncateToWidth(`  ${th.fg("dim", "No tickets yet. Ask the agent to ticket_add one.")}`, width));
    } else {
      const byStatus = new Map<string, TicketRow[]>();
      for (const row of this.rows) {
        const list = byStatus.get(row.status) ?? [];
        list.push(row);
        byStatus.set(row.status, list);
      }
      for (const status of STATUS_ORDER) {
        const group = byStatus.get(status);
        if (!group?.length) continue;
        lines.push(truncateToWidth(`  ${th.fg("muted", `${status} (${group.length})`)}`, width));
        for (const row of group) {
          const done = row.status === "completed" || row.status === "cancelled";
          const check = done ? th.fg("success", "✓") : status === "in_progress" ? th.fg("warning", "◐") : th.fg("dim", "○");
          const title = row.todo.length > 60 ? `${row.todo.slice(0, 60)}...` : row.todo;
          lines.push(truncateToWidth(`  ${check} ${th.fg("accent", `#${row.id}`)} ${th.fg(done ? "dim" : "text", title)}`, width));
        }
      }
    }

    lines.push("");
    lines.push(truncateToWidth(`  ${th.fg("dim", "Press Escape to close")}`, width));
    return lines;
  }

  invalidate(): void {
    /* static snapshot — nothing cached to drop */
  }
}

export function registerTicketsOverlay(pi: ExtensionAPI, getStore: () => TicketStore | null) {
  pi.registerCommand("tickets", {
    description: "Browse the ticket store (this session's tickets; pass 'all' for every session)",
    getArgumentCompletions: (prefix: string) => {
      const items = [{ value: "all", label: "every session's tickets" }];
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/tickets requires interactive mode", "error");
        return;
      }
      const store = getStore();
      const showAll = args?.trim() === "all";
      const rolloutId = currentRolloutId(ctx);
      const rows = store
        ? showAll
          ? store.list({ all: true })
          : store.list({ rollout_id: rolloutId ?? undefined })
        : [];
      await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
        return new TicketsOverlay(rows, theme, () => done(), showAll);
      });
    },
  });
}
