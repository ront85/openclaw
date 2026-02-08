import type { ExecApprovalForwardingConfig } from "../../config/types.approvals.js";

export type GuardianRiskLevel = "low" | "medium" | "high" | "critical";
export type GuardianTrustLevel = "owner" | "allowed" | "unknown" | "subagent";
export type GuardianTier = "rules" | "llm" | "human";
export type GuardianRuleAction = "allow" | "deny" | "escalate";
export type GuardianDecision = "allow-once" | "allow-session" | "allow-always" | "deny";

export type GuardianRule = {
  id?: string;
  /** Glob pattern matching tool names: "exec", "message*", "*" */
  tool?: string;
  /** Key => regex pattern matched against stringified param values */
  paramMatches?: Record<string, string>;
  /** Minimum trust level required for this rule to apply */
  minTrust?: GuardianTrustLevel;
  /** Risk level override when this rule matches */
  riskLevel?: GuardianRiskLevel;
  /** Action to take when this rule matches */
  action?: GuardianRuleAction;
  /** Human-readable label for this rule */
  label?: string;
};

export type GuardianBudgetConfig = {
  enabled?: boolean;
  /** Max cost per session (USD) */
  sessionLimit?: number;
  /** Max cost per day (USD) */
  dailyLimit?: number;
  /** Override cost estimates per tool */
  perToolCosts?: Record<string, number>;
  /** Default cost per tool call (USD), default: 0.01 */
  defaultToolCost?: number;
  /** What to do when budget exceeded */
  onExceeded?: "deny" | "escalate";
};

export type GuardianConfig = {
  enabled?: boolean;
  /** Minimum risk level that triggers approval. Default: "high" */
  approvalThreshold?: GuardianRiskLevel;
  /** Timeout for human approval in ms. Default: 120000 */
  timeoutMs?: number;
  /** Rules evaluated top-to-bottom, first match wins */
  rules?: GuardianRule[];
  /** Inline constitution text */
  constitution?: string;
  /** Path to .md file with policies */
  constitutionPath?: string;
  /** Cost tracking and limits */
  budget?: GuardianBudgetConfig;
  /** LLM configuration for Tier 2 */
  llm?: {
    provider?: string;
    model?: string;
  };
  /** Forwarding config for Tier 3 human escalation */
  forwarding?: ExecApprovalForwardingConfig;
  /** Per-agent overrides */
  agents?: Record<
    string,
    {
      approvalThreshold?: GuardianRiskLevel;
      rules?: GuardianRule[];
      constitution?: string;
      budget?: GuardianBudgetConfig;
    }
  >;
};

export type GuardianApprovalRequest = {
  id: string;
  toolName: string;
  params: Record<string, unknown>;
  riskLevel: GuardianRiskLevel;
  trustLevel: GuardianTrustLevel;
  tier: GuardianTier;
  agentId?: string | null;
  sessionKey?: string | null;
  reason?: string | null;
  ruleLabel?: string | null;
  createdAtMs: number;
  expiresAtMs: number;
};

export type GuardianApprovalResolved = {
  id: string;
  decision: GuardianDecision;
  resolvedBy?: string | null;
  ts: number;
};

// Result types used internally by tiers

export type GuardianRuleResult = {
  decision: GuardianRuleAction;
  riskLevel: GuardianRiskLevel;
  trustLevel: GuardianTrustLevel;
  reason?: string;
  ruleLabel?: string;
};

export type GuardianLLMResult = {
  decision: "allow" | "deny" | "escalate";
  reason?: string;
};

export type GuardianBudgetResult = {
  exceeded: boolean;
  action?: "deny" | "escalate";
  reason?: string;
};
