// session.ts — ground-truth rollout-id resolution.
//
// The doctrine: owners and comment authors are NEVER taken from model input —
// they are stamped from ground truth. pi knows its own session, so identity
// collapses to a resolution order:
//
//   1. TICKET_ROLLOUT_ID env — injected by the delegate tool when it spawns a
//      subagent (pi --mode json). A delegatee's writes therefore land in its
//      delegated namespace without trusting any caller input.
//   2. The pi session id, captured once at session_start / session_tree.
//   3. A ctx passed directly (fallback for handlers invoked before capture).
//
// Only this module may answer "who am I". Tool schemas never take an owner id
// for add/comment; ticket_status keeps its owner-gate param and ticket_list
// keeps its adoption param by design.

let captured: string | null = null;

export function captureSession(ctx: any): string | null {
  captured = ctx?.sessionManager?.getSessionId?.() ?? null;
  return captured;
}

export function capturedSession(): string | null {
  return captured;
}

export function currentRolloutId(ctx?: any): string | null {
  return process.env.TICKET_ROLLOUT_ID || captured || ctx?.sessionManager?.getSessionId?.() || null;
}

/** True when this process is a delegatee spawned by the delegate tool. */
export function isDelegatee(): boolean {
  return !!process.env.TICKET_ROLLOUT_ID;
}
