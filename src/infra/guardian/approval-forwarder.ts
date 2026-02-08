import type { OpenClawConfig } from "../../config/config.js";
import type { ExecApprovalForwardTarget } from "../../config/types.approvals.js";
import type { GuardianDecision, GuardianRiskLevel, GuardianTrustLevel } from "./types.js";
import { loadConfig } from "../../config/config.js";
import { loadSessionStore, resolveStorePath } from "../../config/sessions.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import {
  isDeliverableMessageChannel,
  normalizeMessageChannel,
} from "../../utils/message-channel.js";
import { deliverOutboundPayloads } from "../outbound/deliver.js";
import { resolveSessionDeliveryTarget } from "../outbound/targets.js";

const log = createSubsystemLogger("guardian/forwarder");

export type GuardianApprovalForwardRequest = {
  id: string;
  toolName: string;
  params: Record<string, unknown>;
  riskLevel: GuardianRiskLevel;
  trustLevel: GuardianTrustLevel;
  reason?: string | null;
  agentId?: string | null;
  sessionKey?: string | null;
  createdAtMs: number;
  expiresAtMs: number;
};

export type GuardianApprovalForwardResolved = {
  id: string;
  decision: GuardianDecision;
  resolvedBy?: string | null;
  ts: number;
};

type ForwardTarget = ExecApprovalForwardTarget & { source: "session" | "target" };

type PendingApproval = {
  request: GuardianApprovalForwardRequest;
  targets: ForwardTarget[];
  timeoutId: NodeJS.Timeout | null;
};

export type GuardianApprovalForwarder = {
  handleRequested: (request: GuardianApprovalForwardRequest) => Promise<void>;
  handleResolved: (resolved: GuardianApprovalForwardResolved) => Promise<void>;
  stop: () => void;
};

export type GuardianApprovalForwarderDeps = {
  getConfig?: () => OpenClawConfig;
  deliver?: typeof deliverOutboundPayloads;
  nowMs?: () => number;
};

function buildTargetKey(target: ExecApprovalForwardTarget): string {
  const channel = normalizeMessageChannel(target.channel) ?? target.channel;
  const accountId = target.accountId ?? "";
  const threadId = target.threadId ?? "";
  return [channel, target.to, accountId, threadId].join(":");
}

function truncateParams(params: Record<string, unknown>, maxLen = 200): string {
  try {
    const str = JSON.stringify(params);
    return str.length > maxLen ? str.slice(0, maxLen) + "..." : str;
  } catch {
    return "(unable to serialize)";
  }
}

function buildRequestMessage(request: GuardianApprovalForwardRequest, nowMs: number): string {
  const lines: string[] = [
    "\u{1F6E1}\uFE0F Guardian approval required",
    `ID: ${request.id}`,
    `Tool: ${request.toolName}`,
    `Params: ${truncateParams(request.params)}`,
    `Risk: ${request.riskLevel} | Trust: ${request.trustLevel}`,
  ];
  if (request.agentId) {
    lines.push(`Agent: ${request.agentId}`);
  }
  if (request.reason) {
    lines.push(`Reason: ${request.reason}`);
  }
  const expiresIn = Math.max(0, Math.round((request.expiresAtMs - nowMs) / 1000));
  lines.push(`Expires in: ${expiresIn}s`);
  lines.push("Reply with: /approve <id> allow-once|allow-always|deny");
  return lines.join("\n");
}

function decisionLabel(decision: GuardianDecision): string {
  if (decision === "allow-once") {
    return "allowed once";
  }
  if (decision === "allow-session") {
    return "allowed for session";
  }
  if (decision === "allow-always") {
    return "allowed always";
  }
  return "denied";
}

function buildResolvedMessage(resolved: GuardianApprovalForwardResolved): string {
  const base = `\u2705 Guardian approval ${decisionLabel(resolved.decision)}.`;
  const by = resolved.resolvedBy ? ` Resolved by ${resolved.resolvedBy}.` : "";
  return `${base}${by} ID: ${resolved.id}`;
}

function buildExpiredMessage(request: GuardianApprovalForwardRequest): string {
  return `\u23F1\uFE0F Guardian approval expired. Tool: ${request.toolName} ID: ${request.id}`;
}

async function deliverToTargets(params: {
  cfg: OpenClawConfig;
  targets: ForwardTarget[];
  text: string;
  deliver: typeof deliverOutboundPayloads;
  shouldSend?: () => boolean;
}): Promise<void> {
  const deliveries = params.targets.map(async (target) => {
    if (params.shouldSend && !params.shouldSend()) {
      return;
    }
    const channel = normalizeMessageChannel(target.channel) ?? target.channel;
    if (!isDeliverableMessageChannel(channel)) {
      return;
    }
    try {
      await params.deliver({
        cfg: params.cfg,
        channel,
        to: target.to,
        accountId: target.accountId,
        threadId: target.threadId,
        payloads: [{ text: params.text }],
      });
    } catch (err) {
      log.error(`guardian: failed to deliver to ${channel}:${target.to}: ${String(err)}`);
    }
  });
  await Promise.allSettled(deliveries);
}

export function createGuardianApprovalForwarder(
  deps: GuardianApprovalForwarderDeps = {},
): GuardianApprovalForwarder {
  const getConfig = deps.getConfig ?? loadConfig;
  const deliver = deps.deliver ?? deliverOutboundPayloads;
  const nowMs = deps.nowMs ?? Date.now;
  const pending = new Map<string, PendingApproval>();

  function resolveTargets(
    cfg: OpenClawConfig,
    request: GuardianApprovalForwardRequest,
  ): ForwardTarget[] {
    const guardianCfg = cfg.approvals?.guardian?.forwarding;
    if (!guardianCfg?.enabled) {
      return [];
    }

    const mode = guardianCfg.mode ?? "session";
    const targets: ForwardTarget[] = [];
    const seen = new Set<string>();

    if (mode === "session" || mode === "both") {
      const sessionKey = request.sessionKey?.trim();
      if (sessionKey) {
        const parsed = parseAgentSessionKey(sessionKey);
        const agentId = parsed?.agentId ?? request.agentId ?? "main";
        const storePath = resolveStorePath(cfg.session?.store, { agentId });
        const store = loadSessionStore(storePath);
        const entry = store[sessionKey];
        if (entry) {
          const target = resolveSessionDeliveryTarget({ entry, requestedChannel: "last" });
          if (target.channel && target.to && isDeliverableMessageChannel(target.channel)) {
            const key = buildTargetKey({
              channel: target.channel,
              to: target.to,
              accountId: target.accountId,
              threadId: target.threadId,
            });
            if (!seen.has(key)) {
              seen.add(key);
              targets.push({
                channel: target.channel,
                to: target.to,
                accountId: target.accountId,
                threadId: target.threadId,
                source: "session",
              });
            }
          }
        }
      }
    }

    if (mode === "targets" || mode === "both") {
      for (const target of guardianCfg.targets ?? []) {
        const key = buildTargetKey(target);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        targets.push({ ...target, source: "target" });
      }
    }

    return targets;
  }

  const handleRequested = async (request: GuardianApprovalForwardRequest): Promise<void> => {
    const cfg = getConfig();
    const targets = resolveTargets(cfg, request);
    if (targets.length === 0) {
      return;
    }

    const expiresInMs = Math.max(0, request.expiresAtMs - nowMs());
    const timeoutId = setTimeout(() => {
      void (async () => {
        const entry = pending.get(request.id);
        if (!entry) {
          return;
        }
        pending.delete(request.id);
        const expiredText = buildExpiredMessage(request);
        await deliverToTargets({ cfg, targets: entry.targets, text: expiredText, deliver });
      })();
    }, expiresInMs);
    timeoutId.unref?.();

    const pendingEntry: PendingApproval = { request, targets, timeoutId };
    pending.set(request.id, pendingEntry);

    if (pending.get(request.id) !== pendingEntry) {
      return;
    }

    const text = buildRequestMessage(request, nowMs());
    await deliverToTargets({
      cfg,
      targets,
      text,
      deliver,
      shouldSend: () => pending.get(request.id) === pendingEntry,
    });
  };

  const handleResolved = async (resolved: GuardianApprovalForwardResolved): Promise<void> => {
    const entry = pending.get(resolved.id);
    if (!entry) {
      return;
    }
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
    }
    pending.delete(resolved.id);

    const cfg = getConfig();
    const text = buildResolvedMessage(resolved);
    await deliverToTargets({ cfg, targets: entry.targets, text, deliver });
  };

  const stop = (): void => {
    for (const entry of pending.values()) {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
    }
    pending.clear();
  };

  return { handleRequested, handleResolved, stop };
}
