import { describe, expect, it, vi } from "vitest";
import { DEFAULT_GUARDIAN_CONSTITUTION } from "./default-constitution.js";
import {
  evaluateWithLLM,
  resolveConstitution,
  __testing,
  type GuardianLLMCaller,
} from "./llm-evaluator.js";

const { parseDecision, buildSystemPrompt, buildUserMessage } = __testing;

// ---------------------------------------------------------------------------
// evaluateWithLLM
// ---------------------------------------------------------------------------
describe("evaluateWithLLM", () => {
  const base = {
    toolName: "exec",
    toolParams: { command: "ls -la" },
    riskLevel: "medium" as const,
    trustLevel: "owner" as const,
  };

  it("returns allow when LLM responds with allow JSON", async () => {
    const callLLM = vi
      .fn<GuardianLLMCaller>()
      .mockResolvedValue(JSON.stringify({ decision: "allow", reason: "safe" }));
    const result = await evaluateWithLLM({ ...base, callLLM });
    expect(result.decision).toBe("allow");
  });

  it("returns deny when LLM responds with deny JSON", async () => {
    const callLLM = vi
      .fn<GuardianLLMCaller>()
      .mockResolvedValue(JSON.stringify({ decision: "deny", reason: "dangerous" }));
    const result = await evaluateWithLLM({ ...base, callLLM });
    expect(result.decision).toBe("deny");
  });

  it("returns escalate when LLM responds with escalate JSON", async () => {
    const callLLM = vi
      .fn<GuardianLLMCaller>()
      .mockResolvedValue(JSON.stringify({ decision: "escalate", reason: "uncertain" }));
    const result = await evaluateWithLLM({ ...base, callLLM });
    expect(result.decision).toBe("escalate");
  });

  it("handles LLM response with markdown fences", async () => {
    const callLLM = vi
      .fn<GuardianLLMCaller>()
      .mockResolvedValue('```json\n{"decision":"allow","reason":"looks fine"}\n```');
    const result = await evaluateWithLLM({ ...base, callLLM });
    // The markdown-fenced response contains a JSON object with "decision" key,
    // so the extraction regex should find it even though outer JSON.parse fails.
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("looks fine");
  });

  it("returns escalate when LLM returns invalid JSON", async () => {
    const callLLM = vi
      .fn<GuardianLLMCaller>()
      .mockResolvedValue("I think this should be allowed but I'm not sure.");
    const result = await evaluateWithLLM({ ...base, callLLM });
    expect(result.decision).toBe("escalate");
    expect(result.reason).toContain("Could not parse");
  });

  it("returns escalate on timeout", async () => {
    const callLLM = vi
      .fn<GuardianLLMCaller>()
      .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve("{}"), 10_000)));
    const result = await evaluateWithLLM({ ...base, callLLM, timeoutMs: 50 });
    expect(result.decision).toBe("escalate");
    expect(result.reason).toContain("timed out");
  });

  it("returns escalate on callLLM error", async () => {
    const callLLM = vi.fn<GuardianLLMCaller>().mockRejectedValue(new Error("network failure"));
    const result = await evaluateWithLLM({ ...base, callLLM });
    expect(result.decision).toBe("escalate");
    expect(result.reason).toContain("network failure");
  });

  it("preserves reason from LLM response", async () => {
    const callLLM = vi
      .fn<GuardianLLMCaller>()
      .mockResolvedValue(JSON.stringify({ decision: "deny", reason: "modifies production DB" }));
    const result = await evaluateWithLLM({ ...base, callLLM });
    expect(result.reason).toBe("modifies production DB");
  });

  it("passes system and user messages to callLLM", async () => {
    const callLLM = vi
      .fn<GuardianLLMCaller>()
      .mockResolvedValue(JSON.stringify({ decision: "allow", reason: "ok" }));
    await evaluateWithLLM({ ...base, callLLM, constitution: "Be strict." });
    expect(callLLM).toHaveBeenCalledOnce();
    const args = callLLM.mock.calls[0][0];
    expect(args.system).toContain("Be strict.");
    expect(args.user).toContain("exec");
    expect(args.maxTokens).toBe(256);
  });
});

// ---------------------------------------------------------------------------
// parseDecision
// ---------------------------------------------------------------------------
describe("parseDecision", () => {
  it("parses clean JSON", () => {
    const result = parseDecision('{"decision":"allow","reason":"safe operation"}');
    expect(result).toEqual({ decision: "allow", reason: "safe operation" });
  });

  it("parses JSON with extra text before/after", () => {
    const result = parseDecision(
      'Sure, here is my analysis:\n{"decision":"deny","reason":"risky"}\nHope this helps!',
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toBe("risky");
  });

  it("returns escalate for invalid JSON", () => {
    const result = parseDecision("this is not json at all");
    expect(result.decision).toBe("escalate");
    expect(result.reason).toContain("Could not parse");
  });

  it("returns escalate when decision field is missing", () => {
    const result = parseDecision('{"reason":"no decision here"}');
    expect(result.decision).toBe("escalate");
  });

  it("returns escalate for invalid decision value", () => {
    const result = parseDecision('{"decision":"maybe","reason":"not sure"}');
    expect(result.decision).toBe("escalate");
  });

  it("normalizes decision case", () => {
    const result = parseDecision('{"decision":"ALLOW","reason":"ok"}');
    expect(result.decision).toBe("allow");
  });

  it("handles decision with whitespace", () => {
    const result = parseDecision('{"decision":" deny ","reason":"bad"}');
    expect(result.decision).toBe("deny");
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------
describe("buildSystemPrompt", () => {
  it("uses default constitution when none provided", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain(DEFAULT_GUARDIAN_CONSTITUTION);
  });

  it("uses default constitution when empty string provided", () => {
    const prompt = buildSystemPrompt("   ");
    expect(prompt).toContain(DEFAULT_GUARDIAN_CONSTITUTION);
  });

  it("uses custom constitution when provided", () => {
    const custom = "Only allow read operations.";
    const prompt = buildSystemPrompt(custom);
    expect(prompt).toContain(custom);
    expect(prompt).not.toContain(DEFAULT_GUARDIAN_CONSTITUTION);
  });

  it("appends JSON format instructions", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("valid JSON only");
    expect(prompt).toContain('"decision"');
  });
});

// ---------------------------------------------------------------------------
// buildUserMessage
// ---------------------------------------------------------------------------
describe("buildUserMessage", () => {
  it("includes tool name, params, risk, and trust", () => {
    const msg = buildUserMessage({
      toolName: "exec",
      toolParams: { command: "rm -rf /" },
      riskLevel: "critical",
      trustLevel: "unknown",
    });
    expect(msg).toContain("Tool: exec");
    expect(msg).toContain("rm -rf /");
    expect(msg).toContain("Risk Level: critical");
    expect(msg).toContain("Trust Level: unknown");
  });

  it("includes agent ID when provided", () => {
    const msg = buildUserMessage({
      toolName: "exec",
      toolParams: {},
      riskLevel: "low",
      trustLevel: "owner",
      agentId: "agent-007",
    });
    expect(msg).toContain("Agent: agent-007");
  });

  it("does not include agent line when agentId is omitted", () => {
    const msg = buildUserMessage({
      toolName: "exec",
      toolParams: {},
      riskLevel: "low",
      trustLevel: "owner",
    });
    expect(msg).not.toContain("Agent:");
  });

  it("truncates long params", () => {
    const longValue = "x".repeat(3000);
    const msg = buildUserMessage({
      toolName: "exec",
      toolParams: { data: longValue },
      riskLevel: "medium",
      trustLevel: "allowed",
    });
    expect(msg).toContain("(truncated)");
    // The params section should be shorter than the full serialized value
    expect(msg.length).toBeLessThan(longValue.length);
  });

  it("handles non-serializable params gracefully", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const msg = buildUserMessage({
      toolName: "exec",
      toolParams: circular,
      riskLevel: "low",
      trustLevel: "owner",
    });
    expect(msg).toContain("unable to serialize");
  });
});

// ---------------------------------------------------------------------------
// resolveConstitution
// ---------------------------------------------------------------------------
describe("resolveConstitution", () => {
  it("agent-specific constitution takes priority", () => {
    const result = resolveConstitution({ constitution: "inline policy" }, "agent-1", {
      constitution: "agent-specific policy",
    });
    expect(result).toBe("agent-specific policy");
  });

  it("falls back to inline constitution when no agent config", () => {
    const result = resolveConstitution({ constitution: "inline policy" }, "agent-1", undefined);
    expect(result).toBe("inline policy");
  });

  it("falls back to inline constitution when agent has no constitution", () => {
    const result = resolveConstitution({ constitution: "inline policy" }, "agent-1", {});
    expect(result).toBe("inline policy");
  });

  it("falls back to default when nothing is configured", () => {
    const result = resolveConstitution({});
    expect(result).toBe(DEFAULT_GUARDIAN_CONSTITUTION);
  });

  it("falls back to default when no agentId or agentConfig", () => {
    const result = resolveConstitution({}, undefined, undefined);
    expect(result).toBe(DEFAULT_GUARDIAN_CONSTITUTION);
  });
});
