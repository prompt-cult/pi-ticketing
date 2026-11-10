// delegate-tool.ts — delegate: hand a ticket to a spawned pi subagent.
//
// Spec from the subagent example: spawn a separate `pi` process per task in
// JSON mode, capped parallelism, per-task output caps, usage stats. The
// ticket-ification: the ticket number IS the contract. The delegatee's
// namespace is injected via TICKET_ROLLOUT_ID in the spawned environment
// (exactly the trick server/index.ts used to read TICKET_SESSION_ID on Vibe):
// because the same globally-installed extension loads inside the subagent,
// session.ts resolves that env var first and the delegatee's writes land in
// the delegated namespace without trusting any caller input.
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateHead } from "@earendil-works/pi-coding-agent";
import type { TicketRow, TicketStore } from "./lib/ticket-store.ts";

// Harness constants from the subagent example — they are wisdom, not boilerplate.
const MAX_PARALLEL_TASKS = 8;
const PER_TASK_OUTPUT_CAP = 50 * 1024;

const TaskItemSchema = Type.Object({
  id: Type.Number({ description: "ticket number — the contract" }),
  task: Type.Optional(Type.String({ description: "task override; defaults to the ticket's md_content" })),
});

const DelegateParams = Type.Object(
  {
    id: Type.Optional(Type.Number({ description: "single mode: the ticket number" })),
    task: Type.Optional(Type.String({ description: "single mode: task override" })),
    tasks: Type.Optional(Type.Array(TaskItemSchema, { description: "parallel mode: up to 8 tickets at once" })),
  },
  { additionalProperties: false },
);

interface DelegateResultEntry {
  ticket: number;
  namespace: string;
  status: "pending" | "running" | "completed" | "failed" | "aborted";
  exitCode: number | null;
  output: string;
  usage: { input: number; output: number; cost: number; turns: number };
}

interface DelegateDetails {
  mode: "single" | "parallel";
  results: DelegateResultEntry[];
  isError: boolean;
}

/** pi invocation, simplified from the subagent example's getPiInvocation(). */
function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript =
    currentScript !== undefined &&
    (currentScript.startsWith("/$bunfs/root/") || /^[A-Za-z]:[\\/]~BUN[\\/]root[\\/]/.test(currentScript));
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  return { command: "pi", args };
}

export function registerDelegateTool(pi: ExtensionAPI, getStore: () => TicketStore | null) {
  pi.registerTool({
    name: "delegate",
    label: "Delegate",
    description: [
      "Delegate ticket work to spawned pi subagents with isolated context.",
      "Modes: single ({ id, task? }), parallel ({ tasks: [{ id, task? }] }, max 8), chain (not exposed here — run sequential singles).",
      "The ticket number is the contract: the subagent reads ticket_get, obeys ticket_rules, reports via ticket_comment.",
      "Its namespace is injected as TICKET_ROLLOUT_ID — its writes are stamped into the delegated namespace.",
    ].join(" "),
    parameters: DelegateParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const store = getStore();
      const single = params.id !== undefined;
      const tasks = single
        ? [{ id: params.id!, task: params.task }]
        : (params.tasks ?? []).map((t) => ({ id: t.id, task: t.task }));

      if (!single && tasks.length === 0) {
        return {
          content: [{ type: "text", text: "delegate needs { id, task? } (single) or { tasks: [...] } (parallel)" }],
          details: { mode: single ? "single" : "parallel", results: [], isError: true } satisfies DelegateDetails,
        };
      }
      if (tasks.length > MAX_PARALLEL_TASKS) {
        return {
          content: [{ type: "text", text: `Too many parallel tasks (${tasks.length}). Max is ${MAX_PARALLEL_TASKS}.` }],
          details: { mode: "parallel", results: [], isError: true } satisfies DelegateDetails,
        };
      }

      // Resolve each ticket; the ticket number is the contract.
      const resolved: Array<{ row: TicketRow; task: string; namespace: string }> = [];
      for (const t of tasks) {
        const row = store?.get(t.id);
        if (!row) {
          return {
            content: [{ type: "text", text: `No ticket with number ${t.id} — the ticket number is the contract.` }],
            details: { mode: single ? "single" : "parallel", results: [], isError: true } satisfies DelegateDetails,
          };
        }
        const namespace = `${t.id}-${randomUUID().slice(0, 8)}`;
        const task = t.task || row.md_content || row.todo;
        resolved.push({ row, task, namespace });
      }

      const results: DelegateResultEntry[] = [];
      const emitUpdate = () => {
        onUpdate?.({
          content: [{ type: "text", text: `Delegating: ${results.filter((r) => r.status === "completed").length}/${results.length} done...` }],
          details: { mode: single ? "single" : "parallel", results: [...results], isError: false } satisfies DelegateDetails,
        });
      };

      const runOne = async (entry: { row: TicketRow; task: string; namespace: string }): Promise<DelegateResultEntry> => {
        const result: DelegateResultEntry = {
          ticket: entry.row.id,
          namespace: entry.namespace,
          status: "running",
          exitCode: null,
          output: "",
          usage: { input: 0, output: 0, cost: 0, turns: 0 },
        };
        const prompt = [
          `You are a delegatee subagent. Your ticket namespace is "${entry.namespace}" (already injected as TICKET_ROLLOUT_ID — your writes are stamped with it automatically).`,
          `Your first two calls are reads: ticket_get { id: ${entry.row.id} }, then ticket_rules {} — obey the rules it returns.`,
          `THE TICKET IS IMMUTABLE: never edit it. Report via ticket_comment { id: ${entry.row.id}, content: "..." } (short go/no-go notes, 1000 chars max).`,
          `When the work is done, set ticket_status { id: ${entry.row.id}, rollout_id: "${entry.row.rollout_id}", status: "completed" }.`,
          "",
          "Task:",
          entry.task,
        ].join("\n");

        const invocation = getPiInvocation(["--mode", "json", "-p", "--no-session", prompt]);
        const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; spawnError?: Error }>(
          (resolve) => {
            let proc: ReturnType<typeof spawn>;
            try {
              proc = spawn(invocation.command, invocation.args, {
                cwd: ctx.cwd,
                shell: false,
                stdio: ["ignore", "pipe", "pipe"],
                env: { ...process.env, TICKET_ROLLOUT_ID: entry.namespace },
              });
            } catch (error) {
              resolve({ code: null, signal: null, stdout: "", stderr: "", spawnError: error as Error });
              return;
            }
            let stdout = "";
            let stderr = "";
            let settled = false;
            const killTimer = setTimeout(() => {
              if (!settled) proc.kill("SIGTERM");
            }, 10 * 60_000);
            proc.stdout?.on("data", (d) => {
              stdout += d.toString();
              if (stdout.length > PER_TASK_OUTPUT_CAP) proc.kill("SIGTERM");
            });
            proc.stderr?.on("data", (d) => {
              stderr += d.toString();
            });
            proc.on("error", (error) => {
              settled = true;
              clearTimeout(killTimer);
              resolve({ code: null, signal: null, stdout, stderr, spawnError: error });
            });
            proc.on("close", (code, terminationSignal) => {
              settled = true;
              clearTimeout(killTimer);
              resolve({ code, signal: terminationSignal, stdout, stderr });
            });
            if (signal) {
              if (signal.aborted) proc.kill("SIGTERM");
              else signal.addEventListener("abort", () => proc.kill("SIGTERM"), { once: true });
            }
          },
        );

        // Collect JSON-mode events for usage + final output.
        for (const line of outcome.stdout.split("\n")) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as {
              type?: string;
              message?: { role?: string; usage?: { input?: number; output?: number; cost?: { total?: number }; totalTokens?: number } };
              stopReason?: string;
              errorMessage?: string;
            };
            if (event.type !== "message_end") continue;
            const msg = event.message;
            if (msg?.role !== "assistant") continue;
            result.usage.turns++;
            result.usage.input += msg.usage?.input ?? 0;
            result.usage.output += msg.usage?.output ?? 0;
            result.usage.cost += msg.usage?.cost?.total ?? 0;
            if (event.stopReason) result.status = event.stopReason === "error" ? "failed" : event.stopReason === "aborted" ? "aborted" : "completed";
            if (event.errorMessage) result.output = event.errorMessage;
          } catch {
            /* not JSON — ignore */
          }
        }
        if (outcome.spawnError) {
          result.status = "failed";
          result.output = `Failed to spawn subagent: ${outcome.spawnError.message}`;
        } else if (outcome.code !== 0) {
          result.status = "failed";
          result.output ||= `Subagent exited with code ${outcome.code}`;
          if (outcome.stderr.trim()) result.output += `\nstderr: ${outcome.stderr.trim().slice(0, 2000)}`;
        } else if (result.status === "running") {
          result.status = "completed";
        }
        return result;
      };

      // Parallel with a concurrency cap (mapWithConcurrencyLimit from the example).
      const limit = Math.max(1, Math.min(4, resolved.length));
      let next = 0;
      const workers = Array.from({ length: limit }, async () => {
        while (next < resolved.length) {
          const entry = resolved[next++];
          const r = await runOne(entry);
          results.push(r);
          emitUpdate();
        }
      });
      await Promise.all(workers);

      const failed = results.filter((r) => r.status === "failed" || r.status === "aborted").length;
      const icon = failed === 0 ? "✓" : failed === results.length ? "✗" : "◐";
      let text = `${icon} delegate ${single ? "single" : `parallel ${results.filter((r) => r.status === "completed").length}/${results.length}`}`;
      for (const r of results) {
        const mark = r.status === "completed" ? "✓" : r.status === "failed" || r.status === "aborted" ? "✗" : "⏳";
        text += `\n  ${mark} ticket #${r.ticket} → ${r.status}`;
      }
      const usage = results.reduce(
        (acc, r) => ({ input: acc.input + r.usage.input, output: acc.output + r.usage.output, cost: acc.cost + r.usage.cost, turns: acc.turns + r.usage.turns }),
        { input: 0, output: 0, cost: 0, turns: 0 },
      );
      text += `\n  ${usage.turns} turns, ↑${usage.input} ↓${usage.output} tokens, $${usage.cost.toFixed(4)}`;

      return {
        content: [{ type: "text", text: truncateHead(text) }],
        details: { mode: single ? "single" : "parallel", results, isError: failed > 0 } satisfies DelegateDetails,
      };
    },

    renderCall(args, theme) {
      const label = args.id !== undefined ? `single #${args.id}` : `parallel (${args.tasks?.length ?? 0})`;
      return new Text(theme.fg("toolTitle", theme.bold("delegate ")) + theme.fg("accent", label), 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details as DelegateDetails | undefined;
      if (!details || details.results.length === 0) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? theme.fg("error", text.text) : "(no output)", 0, 0);
      }
      let text = "";
      for (const r of details.results) {
        const mark = r.status === "completed" ? theme.fg("success", "✓") : r.status === "failed" || r.status === "aborted" ? theme.fg("error", "✗") : theme.fg("warning", "⏳");
        text += `\n${mark} ${theme.fg("accent", `#${r.ticket}`)} ${theme.fg("muted", r.namespace)} ${r.status}`;
        if (expanded && r.output) text += `\n  ${theme.fg("dim", r.output.slice(0, 200))}`;
      }
      return new Text(text, 0, 0);
    },
  });
}
