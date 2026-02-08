import type { GuardianApprovalForwarder } from "../../infra/guardian/approval-forwarder.js";
import type { GuardianDecision } from "../../infra/guardian/types.js";
import type { GuardianApprovalManager } from "../guardian-approval-manager.js";
import type { GatewayRequestHandlers } from "./types.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateGuardianApprovalRequestParams,
  validateGuardianApprovalResolveParams,
} from "../protocol/index.js";

const VALID_DECISIONS = new Set<string>(["allow-once", "allow-session", "allow-always", "deny"]);

export function createGuardianApprovalHandlers(
  manager: GuardianApprovalManager,
  opts?: { forwarder?: GuardianApprovalForwarder },
): GatewayRequestHandlers {
  return {
    "guardian.approval.request": async ({ params, respond, context }) => {
      if (!validateGuardianApprovalRequestParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid guardian.approval.request params: ${formatValidationErrors(
              validateGuardianApprovalRequestParams.errors,
            )}`,
          ),
        );
        return;
      }
      const p = params as {
        id?: string;
        toolName: string;
        params?: Record<string, unknown>;
        riskLevel?: string;
        trustLevel?: string;
        reason?: string;
        agentId?: string;
        sessionKey?: string;
        timeoutMs?: number;
      };
      const timeoutMs = typeof p.timeoutMs === "number" ? p.timeoutMs : 120_000;
      const explicitId = typeof p.id === "string" && p.id.trim().length > 0 ? p.id.trim() : null;
      if (explicitId && manager.getSnapshot(explicitId)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "approval id already pending"),
        );
        return;
      }
      const request = {
        toolName: p.toolName,
        params: p.params ?? {},
        riskLevel: p.riskLevel ?? null,
        trustLevel: p.trustLevel ?? null,
        reason: p.reason ?? null,
        agentId: p.agentId ?? null,
        sessionKey: p.sessionKey ?? null,
      };
      const record = manager.create(request, timeoutMs, explicitId);
      const decisionPromise = manager.waitForDecision(record, timeoutMs);
      context.broadcast(
        "guardian.approval.requested",
        {
          id: record.id,
          request: record.request,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        { dropIfSlow: true },
      );
      void opts?.forwarder
        ?.handleRequested({
          id: record.id,
          toolName: request.toolName,
          params: request.params,
          riskLevel: (request.riskLevel as "low" | "medium" | "high" | "critical") ?? "high",
          trustLevel:
            (request.trustLevel as "owner" | "allowed" | "unknown" | "subagent") ?? "unknown",
          reason: request.reason,
          agentId: request.agentId,
          sessionKey: request.sessionKey,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        })
        .catch((err) => {
          context.logGateway?.error?.(`guardian approvals: forward request failed: ${String(err)}`);
        });
      const decision = await decisionPromise;
      respond(
        true,
        {
          id: record.id,
          decision,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        undefined,
      );
    },
    "guardian.approval.resolve": async ({ params, respond, client, context }) => {
      if (!validateGuardianApprovalResolveParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid guardian.approval.resolve params: ${formatValidationErrors(
              validateGuardianApprovalResolveParams.errors,
            )}`,
          ),
        );
        return;
      }
      const p = params as { id: string; decision: string };
      if (!VALID_DECISIONS.has(p.decision)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid decision"));
        return;
      }
      const decision = p.decision as GuardianDecision;
      const resolvedBy = client?.connect?.client?.displayName ?? client?.connect?.client?.id;
      const ok = manager.resolve(p.id, decision, resolvedBy ?? null);
      if (!ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown approval id"));
        return;
      }
      context.broadcast(
        "guardian.approval.resolved",
        { id: p.id, decision, resolvedBy, ts: Date.now() },
        { dropIfSlow: true },
      );
      void opts?.forwarder
        ?.handleResolved({ id: p.id, decision, resolvedBy, ts: Date.now() })
        .catch((err) => {
          context.logGateway?.error?.(`guardian approvals: forward resolve failed: ${String(err)}`);
        });
      respond(true, { ok: true }, undefined);
    },
  };
}
