import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const GuardianApprovalRequestParamsSchema = Type.Object(
  {
    id: Type.Optional(NonEmptyString),
    toolName: NonEmptyString,
    params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    riskLevel: Type.Optional(Type.String()),
    trustLevel: Type.Optional(Type.String()),
    reason: Type.Optional(Type.String()),
    agentId: Type.Optional(Type.String()),
    sessionKey: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const GuardianApprovalResolveParamsSchema = Type.Object(
  {
    id: NonEmptyString,
    decision: NonEmptyString,
  },
  { additionalProperties: false },
);
