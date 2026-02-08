import { readFileSync } from "node:fs";
import type { GuardianLLMResult, GuardianRiskLevel, GuardianTrustLevel } from "./types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { DEFAULT_GUARDIAN_CONSTITUTION } from "./default-constitution.js";

const log = createSubsystemLogger("guardian/llm");

const LLM_TIMEOUT_MS = 5_000;

/**
 * Minimal function signature for making a non-streaming LLM completion call.
 * Implementations should return the text content of the response.
 */
export type GuardianLLMCaller = (params: {
  system: string;
  user: string;
  maxTokens?: number;
}) => Promise<string>;

function buildSystemPrompt(constitution?: string): string {
  const base = constitution?.trim() || DEFAULT_GUARDIAN_CONSTITUTION;
  return `${base}

## Important
- You MUST respond with valid JSON only: { "decision": "allow" | "deny" | "escalate", "reason": "brief explanation" }
- No markdown fences, no extra text, just the JSON object.`;
}

function buildUserMessage(params: {
  toolName: string;
  toolParams: Record<string, unknown>;
  riskLevel: GuardianRiskLevel;
  trustLevel: GuardianTrustLevel;
  agentId?: string;
}): string {
  // Truncate params to avoid overwhelming the evaluator
  let paramsStr: string;
  try {
    paramsStr = JSON.stringify(params.toolParams, null, 2);
    if (paramsStr.length > 2000) {
      paramsStr = paramsStr.slice(0, 2000) + "\n... (truncated)";
    }
  } catch {
    paramsStr = "(unable to serialize params)";
  }

  const lines = [
    "An agent wants to execute the following tool call:",
    `Tool: ${params.toolName}`,
    `Parameters: ${paramsStr}`,
    `Risk Level: ${params.riskLevel}`,
    `Trust Level: ${params.trustLevel}`,
  ];
  if (params.agentId) {
    lines.push(`Agent: ${params.agentId}`);
  }
  lines.push("", "Based on the policies, should this be allowed?");
  return lines.join("\n");
}

function parseDecision(text: string): GuardianLLMResult {
  // Try to extract JSON from the response
  const cleaned = text.trim();
  // Try parsing the whole response as JSON first
  try {
    const parsed = JSON.parse(cleaned) as { decision?: string; reason?: string };
    if (parsed.decision) {
      const decision = parsed.decision.toLowerCase().trim();
      if (decision === "allow" || decision === "deny" || decision === "escalate") {
        return { decision, reason: parsed.reason };
      }
    }
  } catch {
    // Try extracting JSON from within the text
    const jsonMatch = cleaned.match(/\{[^}]*"decision"\s*:\s*"[^"]+"/);
    if (jsonMatch) {
      // Find the closing brace
      const start = cleaned.indexOf(jsonMatch[0]);
      let depth = 0;
      for (let i = start; i < cleaned.length; i++) {
        if (cleaned[i] === "{") {
          depth++;
        }
        if (cleaned[i] === "}") {
          depth--;
          if (depth === 0) {
            try {
              const obj = JSON.parse(cleaned.slice(start, i + 1)) as {
                decision?: string;
                reason?: string;
              };
              const d = obj.decision?.toLowerCase().trim();
              if (d === "allow" || d === "deny" || d === "escalate") {
                return { decision: d, reason: obj.reason };
              }
            } catch {
              // fall through
            }
            break;
          }
        }
      }
    }
  }

  // Could not parse; escalate to be safe
  return { decision: "escalate", reason: "Could not parse LLM response" };
}

export async function evaluateWithLLM(params: {
  toolName: string;
  toolParams: Record<string, unknown>;
  riskLevel: GuardianRiskLevel;
  trustLevel: GuardianTrustLevel;
  constitution?: string;
  agentId?: string;
  callLLM: GuardianLLMCaller;
  timeoutMs?: number;
}): Promise<GuardianLLMResult> {
  const { toolName, toolParams, riskLevel, trustLevel, constitution, agentId, callLLM } = params;
  const timeoutMs = params.timeoutMs ?? LLM_TIMEOUT_MS;

  const system = buildSystemPrompt(constitution);
  const user = buildUserMessage({ toolName, toolParams, riskLevel, trustLevel, agentId });

  try {
    const responsePromise = callLLM({ system, user, maxTokens: 256 });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("LLM evaluation timed out")), timeoutMs),
    );

    const text = await Promise.race([responsePromise, timeoutPromise]);
    return parseDecision(text);
  } catch (err) {
    log.warn(`Guardian LLM evaluation failed: ${String(err)}`);
    // On timeout or error, escalate to be safe
    return { decision: "escalate", reason: `LLM evaluation failed: ${String(err)}` };
  }
}

export function resolveConstitution(
  config: { constitution?: string; constitutionPath?: string },
  agentId?: string,
  agentConfig?: { constitution?: string },
): string {
  // Agent-specific constitution takes priority
  if (agentConfig?.constitution) {
    return agentConfig.constitution;
  }

  // Try loading from file path
  if (config.constitutionPath) {
    try {
      return readFileSync(config.constitutionPath, "utf8");
    } catch (err) {
      log.warn(`Failed to load constitution from ${config.constitutionPath}: ${String(err)}`);
    }
  }

  // Inline constitution
  if (config.constitution) {
    return config.constitution;
  }

  return DEFAULT_GUARDIAN_CONSTITUTION;
}

export const __testing = {
  buildSystemPrompt,
  buildUserMessage,
  parseDecision,
};
