// schemas.ts — the harness-facing tool parameter schemas (TypeBox).
//
// pi validates tool arguments against these before execute() runs, so misuse
// is unrepresentable at the harness layer: wrong types, illegal enum values,
// unknown keys, and over-long comments are all rejected before the handler.
// These schemas ARE the contract — keep them strict.
//
// StringEnum (not Type.Union/Type.Literal) for the status: it produces a plain
// JSON `enum`, which every provider accepts.
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const ADD_DESC_SUMMARY = "one-line summary";

// The same five statuses the store enforces — as a literal tuple for StringEnum.
const STATUS_ENUM = ["pending", "in_progress", "completed", "cancelled", "superseded"] as const;

export const ADD_PARAMS = Type.Object(
  {
    todo: Type.String({ description: ADD_DESC_SUMMARY }),
    md_content: Type.Optional(Type.String({ description: "the spec, written ONCE at creation — the immutable body" })),
  },
  { additionalProperties: false },
);

export const GET_PARAMS = Type.Object(
  {
    id: Type.Number({ description: "ticket number" }),
  },
  { additionalProperties: false },
);

export const LIST_PARAMS = Type.Object(
  {
    rollout_id: Type.Optional(
      Type.String({ description: "the session id to query — omit for your own tickets; all=true instead for every session" }),
    ),
    status: Type.Optional(StringEnum(STATUS_ENUM, { description: "filter: pending | in_progress | completed | cancelled | superseded" })),
    all: Type.Optional(Type.Boolean({ description: "list every session's tickets (instead of one session's)" })),
  },
  { additionalProperties: false },
);

export const COMMENT_PARAMS = Type.Object(
  {
    id: Type.Number({ description: "ticket number" }),
    content: Type.String({
      description: "short go/no-go note: done / not done / blocked — 1000 chars max",
      maxLength: 1000,
    }),
  },
  { additionalProperties: false },
);

export const STATUS_PARAMS = Type.Object(
  {
    id: Type.Number({ description: "ticket number" }),
    rollout_id: Type.String({ description: "the ticket's OWNING session id (owner gate)" }),
    status: StringEnum(STATUS_ENUM, { description: "pending | in_progress | completed | cancelled | superseded" }),
  },
  { additionalProperties: false },
);

export const NONE_PARAMS = Type.Object({}, { additionalProperties: false });
