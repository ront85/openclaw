import type {
  GuardianBudgetConfig,
  GuardianConfig,
  GuardianRiskLevel,
  GuardianRule,
  GuardianRuleAction,
  GuardianRuleResult,
  GuardianTrustLevel,
} from "./types.js";
import { normalizeToolName } from "../../agents/tool-policy.js";

// ─── Built-in risk defaults ────────────────────────────────────────────────────

const TOOL_RISK_DEFAULTS: Record<string, GuardianRiskLevel> = {
  read: "low",
  memory_search: "low",
  memory_get: "low",
  web_search: "low",
  web_fetch: "low",
  session_status: "low",
  sessions_list: "low",
  sessions_history: "low",
  agents_list: "low",
  image: "low",

  write: "medium",
  edit: "medium",
  apply_patch: "medium",
  message: "medium",
  browser: "medium",
  canvas: "medium",
  cron: "medium",
  nodes: "medium",

  exec: "high",
  process: "high",
  sessions_send: "high",
  sessions_spawn: "high",

  gateway: "critical",
  whatsapp_login: "critical",
};

// ─── Parameter-based escalation patterns ────────────────────────────────────────

type ParamEscalation = {
  tool: string | RegExp;
  paramKey: string;
  pattern: RegExp;
  escalateTo: GuardianRiskLevel;
  label: string;
};

const PARAM_ESCALATIONS: ParamEscalation[] = [
  {
    tool: "write",
    paramKey: "path",
    pattern: /(?:config|\.env|secret|credential|\.ssh|\.gnupg)/i,
    escalateTo: "critical",
    label: "write to sensitive path",
  },
  {
    tool: "edit",
    paramKey: "path",
    pattern: /(?:config|\.env|secret|credential|\.ssh|\.gnupg)/i,
    escalateTo: "critical",
    label: "edit sensitive path",
  },
  {
    tool: "exec",
    paramKey: "command",
    pattern:
      /(?:rm\s+-rf|DROP\s+TABLE|DELETE\s+FROM|TRUNCATE\s+TABLE|mkfs|dd\s+if=|format\s+[a-z]:|shutdown|reboot)/i,
    escalateTo: "critical",
    label: "destructive command",
  },
  {
    tool: "message",
    paramKey: "action",
    pattern: /broadcast/i,
    escalateTo: "critical",
    label: "broadcast message",
  },
];

// ─── Risk level ordering ────────────────────────────────────────────────────────

const RISK_ORDER: Record<GuardianRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const TRUST_ORDER: Record<GuardianTrustLevel, number> = {
  owner: 3,
  allowed: 2,
  unknown: 1,
  subagent: 0,
};

export function riskAtLeast(level: GuardianRiskLevel, threshold: GuardianRiskLevel): boolean {
  return RISK_ORDER[level] >= RISK_ORDER[threshold];
}

export function maxRisk(a: GuardianRiskLevel, b: GuardianRiskLevel): GuardianRiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

export function trustAtLeast(level: GuardianTrustLevel, min: GuardianTrustLevel): boolean {
  return TRUST_ORDER[level] >= TRUST_ORDER[min];
}

// ─── Trust resolution ───────────────────────────────────────────────────────────

export function resolveTrustLevel(params: {
  senderIsOwner?: boolean;
  isSubagent?: boolean;
  isAllowed?: boolean;
}): GuardianTrustLevel {
  if (params.senderIsOwner) {
    return "owner";
  }
  if (params.isSubagent) {
    return "subagent";
  }
  if (params.isAllowed) {
    return "allowed";
  }
  return "unknown";
}

// ─── Tool risk resolution ───────────────────────────────────────────────────────

function getBaseRisk(toolName: string): GuardianRiskLevel {
  return TOOL_RISK_DEFAULTS[toolName] ?? "medium";
}

function checkParamEscalations(
  toolName: string,
  toolParams: Record<string, unknown>,
): { risk: GuardianRiskLevel; label?: string } | null {
  for (const esc of PARAM_ESCALATIONS) {
    const toolMatch =
      typeof esc.tool === "string" ? esc.tool === toolName : esc.tool.test(toolName);
    if (!toolMatch) {
      continue;
    }

    const paramValue = toolParams[esc.paramKey];
    if (paramValue === undefined || paramValue === null) {
      continue;
    }
    const str = typeof paramValue === "string" ? paramValue : JSON.stringify(paramValue);
    if (esc.pattern.test(str)) {
      return { risk: esc.escalateTo, label: esc.label };
    }
  }
  return null;
}

// ─── Glob matching ──────────────────────────────────────────────────────────────

function globMatch(pattern: string, value: string): boolean {
  if (pattern === "*") {
    return true;
  }
  if (!pattern.includes("*") && !pattern.includes("?")) {
    return pattern === value;
  }
  // Simple glob: convert * to .*, ? to .
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$",
  );
  return re.test(value);
}

// ─── Rule matching ──────────────────────────────────────────────────────────────

function matchRule(
  rule: GuardianRule,
  toolName: string,
  toolParams: Record<string, unknown>,
  trustLevel: GuardianTrustLevel,
): boolean {
  // Tool name match
  if (rule.tool && !globMatch(rule.tool, toolName)) {
    return false;
  }

  // Trust level match
  if (rule.minTrust && !trustAtLeast(trustLevel, rule.minTrust)) {
    return false;
  }

  // Parameter matches
  if (rule.paramMatches) {
    for (const [key, pattern] of Object.entries(rule.paramMatches)) {
      const paramValue = toolParams[key];
      if (paramValue === undefined || paramValue === null) {
        return false;
      }
      const str = typeof paramValue === "string" ? paramValue : JSON.stringify(paramValue);
      try {
        if (!new RegExp(pattern, "i").test(str)) {
          return false;
        }
      } catch {
        // Invalid regex, treat as literal substring match
        if (!str.includes(pattern)) {
          return false;
        }
      }
    }
  }

  return true;
}

// ─── Effective threshold ────────────────────────────────────────────────────────

export function effectiveThreshold(config: GuardianConfig, agentId?: string): GuardianRiskLevel {
  if (agentId && config.agents?.[agentId]?.approvalThreshold) {
    return config.agents[agentId].approvalThreshold;
  }
  return config.approvalThreshold ?? "high";
}

export function effectiveBudget(
  config: GuardianConfig,
  agentId?: string,
): GuardianBudgetConfig | undefined {
  if (agentId && config.agents?.[agentId]?.budget) {
    return { ...config.budget, ...config.agents[agentId].budget };
  }
  return config.budget;
}

// ─── Main evaluation ────────────────────────────────────────────────────────────

export function evaluateRules(params: {
  toolName: string;
  toolParams: Record<string, unknown>;
  globalRules?: GuardianRule[];
  agentRules?: GuardianRule[];
  threshold: GuardianRiskLevel;
  trustLevel: GuardianTrustLevel;
}): GuardianRuleResult {
  const {
    toolName: rawToolName,
    toolParams,
    globalRules,
    agentRules,
    threshold,
    trustLevel,
  } = params;
  const toolName = normalizeToolName(rawToolName);

  // Compute risk level
  let riskLevel = getBaseRisk(toolName);
  let escalationLabel: string | undefined;

  const paramEscalation = checkParamEscalations(toolName, toolParams);
  if (paramEscalation) {
    riskLevel = maxRisk(riskLevel, paramEscalation.risk);
    escalationLabel = paramEscalation.label;
  }

  // Evaluate rules: agent-specific first, then global
  const allRules = [...(agentRules ?? []), ...(globalRules ?? [])];
  for (const rule of allRules) {
    if (matchRule(rule, toolName, toolParams, trustLevel)) {
      const action: GuardianRuleAction = rule.action ?? "escalate";
      const ruleRisk = rule.riskLevel ? maxRisk(riskLevel, rule.riskLevel) : riskLevel;
      return {
        decision: action,
        riskLevel: ruleRisk,
        trustLevel,
        reason: escalationLabel ?? rule.label ?? `matched rule: ${rule.id ?? rule.tool ?? "*"}`,
        ruleLabel: rule.label ?? rule.id,
      };
    }
  }

  // No rule matched: compare risk vs threshold, adjusted by trust
  // Owner bypasses anything below critical
  if (trustLevel === "owner" && !riskAtLeast(riskLevel, "critical")) {
    return {
      decision: "allow",
      riskLevel,
      trustLevel,
      reason: "owner bypass (risk below critical)",
    };
  }

  // Subagents get a stricter threshold (one level lower)
  let adjustedThreshold = threshold;
  if (trustLevel === "subagent" && RISK_ORDER[threshold] > 0) {
    const levels: GuardianRiskLevel[] = ["low", "medium", "high", "critical"];
    adjustedThreshold = levels[RISK_ORDER[threshold] - 1];
  }

  if (riskAtLeast(riskLevel, adjustedThreshold)) {
    return {
      decision: "escalate",
      riskLevel,
      trustLevel,
      reason: escalationLabel ?? `risk ${riskLevel} >= threshold ${adjustedThreshold}`,
    };
  }

  return {
    decision: "allow",
    riskLevel,
    trustLevel,
    reason: `risk ${riskLevel} < threshold ${adjustedThreshold}`,
  };
}

export const __testing = {
  getBaseRisk,
  checkParamEscalations,
  globMatch,
  matchRule,
  TOOL_RISK_DEFAULTS,
  PARAM_ESCALATIONS,
};
