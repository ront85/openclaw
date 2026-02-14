import type {
  PluginHookBeforeToolCallEvent,
  PluginHookBeforeToolCallResult,
  PluginHookToolContext,
} from "../../plugins/types.js";
import type { GuardianConfig, GuardianDecision } from "./types.js";
import { normalizeToolName } from "../../agents/tool-policy.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { checkBudget, recordToolCost, type BudgetTracker } from "./budget.js";
import { evaluateWithLLM, resolveConstitution, type GuardianLLMCaller } from "./llm-evaluator.js";
import { effectiveBudget, effectiveThreshold, evaluateRules, resolveTrustLevel } from "./rules.js";

const log = createSubsystemLogger("guardian/hook");

/**
 * Minimal function to request human approval via the gateway.
 * Returns the decision or null on timeout.
 */
export type GuardianHumanApprovalFn = (params: {
  toolName: string;
  toolParams: Record<string, unknown>;
  riskLevel: string;
  trustLevel: string;
  reason?: string;
  agentId?: string;
  sessionKey?: string;
  timeoutMs: number;
}) => Promise<GuardianDecision | null>;

export type GuardianHookParams = {
  config: GuardianConfig;
  agentId?: string;
  sessionKey?: string;
  senderIsOwner?: boolean;
  isSubagent?: boolean;
  isAllowed?: boolean;
  callLLM?: GuardianLLMCaller;
  requestHumanApproval?: GuardianHumanApprovalFn;
  budgetTracker?: BudgetTracker;
};

function cacheKey(toolName: string, toolParams: Record<string, unknown>): string {
  // Include both param keys and values so that approving exec({command:"ls"})
  // does NOT also approve exec({command:"rm -rf /"})
  const sorted = Object.entries(toolParams)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => {
      let vs: string;
      try {
        vs = JSON.stringify(v);
      } catch {
        vs = String(v);
      }
      return `${k}=${vs}`;
    })
    .join("&");
  return `${toolName}:${sorted}`;
}

/**
 * Creates a guardian hook handler that evaluates tool calls through the tiered system.
 * Register this as a before_tool_call plugin hook.
 */
export function createGuardianHook(params: GuardianHookParams): {
  handler: (
    event: PluginHookBeforeToolCallEvent,
    ctx: PluginHookToolContext,
  ) => Promise<PluginHookBeforeToolCallResult | void>;
  taskAllowCache: Set<string>;
  alwaysAllowCache: Set<string>;
} {
  const taskAllowCache = new Set<string>();
  const alwaysAllowCache = new Set<string>();

  const handler = async (
    event: PluginHookBeforeToolCallEvent,
    ctx: PluginHookToolContext,
  ): Promise<PluginHookBeforeToolCallResult | void> => {
    if (!params.config.enabled) {
      return;
    }

    const toolName = normalizeToolName(event.toolName);
    const toolParams = event.params;
    const agentId = ctx.agentId ?? params.agentId;

    // Check caches first (fast path)
    const key = cacheKey(toolName, toolParams);
    if (alwaysAllowCache.has(key) || taskAllowCache.has(key)) {
      // Record cost even for cached decisions
      if (params.budgetTracker) {
        recordToolCost({
          toolName,
          budgetConfig: effectiveBudget(params.config, agentId),
          tracker: params.budgetTracker,
          agentId,
        });
      }
      return;
    }

    // Budget check (pre-Tier 1)
    if (params.budgetTracker) {
      const budgetResult = checkBudget({
        toolName,
        budgetConfig: effectiveBudget(params.config, agentId),
        tracker: params.budgetTracker,
        agentId,
      });
      if (budgetResult.exceeded) {
        if (budgetResult.action === "deny") {
          return { block: true, blockReason: budgetResult.reason ?? "Budget exceeded" };
        }
        // action === "escalate" -> fall through to Tier 3
        if (params.requestHumanApproval) {
          const decision = await params.requestHumanApproval({
            toolName,
            toolParams,
            riskLevel: "critical",
            trustLevel: resolveTrustLevel({
              senderIsOwner: ctx.senderIsOwner ?? params.senderIsOwner,
              isSubagent: params.isSubagent,
              isAllowed: params.isAllowed,
            }),
            reason: budgetResult.reason ?? "Budget exceeded",
            agentId,
            sessionKey: params.sessionKey,
            timeoutMs: params.config.timeoutMs ?? 120_000,
          });
          return resolveDecision(decision, key);
        }
        // No human approval configured, deny
        return { block: true, blockReason: budgetResult.reason ?? "Budget exceeded" };
      }
    }

    // Tier 1: Rules
    const trustLevel = resolveTrustLevel({
      senderIsOwner: ctx.senderIsOwner ?? params.senderIsOwner,
      isSubagent: params.isSubagent,
      isAllowed: params.isAllowed,
    });

    const ruleResult = evaluateRules({
      toolName,
      toolParams,
      globalRules: params.config.rules,
      agentRules: params.config.agents?.[agentId ?? ""]?.rules,
      threshold: effectiveThreshold(params.config, agentId),
      trustLevel,
    });

    if (ruleResult.decision === "allow") {
      recordCostIfEnabled(toolName, agentId);
      return;
    }
    if (ruleResult.decision === "deny") {
      return { block: true, blockReason: ruleResult.reason ?? "Denied by guardian rule" };
    }

    // Tier 2: Guardian LLM
    if (params.callLLM) {
      const constitution = resolveConstitution(
        params.config,
        agentId,
        agentId ? params.config.agents?.[agentId] : undefined,
      );

      const llmResult = await evaluateWithLLM({
        toolName,
        toolParams,
        riskLevel: ruleResult.riskLevel,
        trustLevel: ruleResult.trustLevel,
        constitution,
        agentId,
        callLLM: params.callLLM,
        timeoutMs: params.config.timeoutMs ? Math.min(params.config.timeoutMs, 5_000) : 5_000,
      });

      if (llmResult.decision === "allow") {
        recordCostIfEnabled(toolName, agentId);
        return;
      }
      if (llmResult.decision === "deny") {
        return { block: true, blockReason: llmResult.reason ?? "Denied by guardian LLM" };
      }
      // escalate -> Tier 3
    }

    // Tier 3: Human escalation
    if (params.requestHumanApproval) {
      const decision = await params.requestHumanApproval({
        toolName,
        toolParams,
        riskLevel: ruleResult.riskLevel,
        trustLevel: ruleResult.trustLevel,
        reason: ruleResult.reason,
        agentId,
        sessionKey: params.sessionKey,
        timeoutMs: params.config.timeoutMs ?? 120_000,
      });
      return resolveDecision(decision, key);
    }

    // No human approval configured and we reached Tier 3 — block
    log.warn(
      `Guardian: no human approval handler configured, blocking escalated tool call: ${toolName}`,
    );
    return {
      block: true,
      blockReason: ruleResult.reason ?? "Escalated but no human approval handler configured",
    };
  };

  function resolveDecision(
    decision: GuardianDecision | null,
    key: string,
  ): PluginHookBeforeToolCallResult | void {
    if (!decision || decision === "deny") {
      return { block: true, blockReason: "Denied by operator" };
    }
    if (decision === "allow-session") {
      taskAllowCache.add(key);
    }
    if (decision === "allow-always") {
      alwaysAllowCache.add(key);
    }
    // allow-once, allow-session, allow-always all proceed
    return;
  }

  function recordCostIfEnabled(toolName: string, agentId?: string): void {
    if (params.budgetTracker) {
      recordToolCost({
        toolName,
        budgetConfig: effectiveBudget(params.config, agentId),
        tracker: params.budgetTracker,
        agentId,
      });
    }
  }

  return { handler, taskAllowCache, alwaysAllowCache };
}
