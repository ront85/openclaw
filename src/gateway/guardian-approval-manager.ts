import { randomUUID } from "node:crypto";
import type { GuardianDecision } from "../infra/guardian/types.js";

export type GuardianApprovalRequestPayload = {
  toolName: string;
  params: Record<string, unknown>;
  riskLevel?: string | null;
  trustLevel?: string | null;
  reason?: string | null;
  agentId?: string | null;
  sessionKey?: string | null;
};

export type GuardianApprovalRecord = {
  id: string;
  request: GuardianApprovalRequestPayload;
  createdAtMs: number;
  expiresAtMs: number;
  resolvedAtMs?: number;
  decision?: GuardianDecision;
  resolvedBy?: string | null;
};

type PendingEntry = {
  record: GuardianApprovalRecord;
  resolve: (decision: GuardianDecision | null) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class GuardianApprovalManager {
  private pending = new Map<string, PendingEntry>();

  create(
    request: GuardianApprovalRequestPayload,
    timeoutMs: number,
    id?: string | null,
  ): GuardianApprovalRecord {
    const now = Date.now();
    const resolvedId = id && id.trim().length > 0 ? id.trim() : randomUUID();
    const record: GuardianApprovalRecord = {
      id: resolvedId,
      request,
      createdAtMs: now,
      expiresAtMs: now + timeoutMs,
    };
    return record;
  }

  async waitForDecision(
    record: GuardianApprovalRecord,
    timeoutMs: number,
  ): Promise<GuardianDecision | null> {
    return await new Promise<GuardianDecision | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(record.id);
        resolve(null);
      }, timeoutMs);
      this.pending.set(record.id, { record, resolve, reject, timer });
    });
  }

  resolve(recordId: string, decision: GuardianDecision, resolvedBy?: string | null): boolean {
    const pending = this.pending.get(recordId);
    if (!pending) {
      return false;
    }
    clearTimeout(pending.timer);
    pending.record.resolvedAtMs = Date.now();
    pending.record.decision = decision;
    pending.record.resolvedBy = resolvedBy ?? null;
    this.pending.delete(recordId);
    pending.resolve(decision);
    return true;
  }

  getSnapshot(recordId: string): GuardianApprovalRecord | null {
    const entry = this.pending.get(recordId);
    return entry?.record ?? null;
  }
}
