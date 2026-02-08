import { describe, expect, it } from "vitest";
import type { GuardianConfig, GuardianRule } from "./types.js";
import {
  __testing,
  effectiveThreshold,
  evaluateRules,
  maxRisk,
  resolveTrustLevel,
  riskAtLeast,
  trustAtLeast,
} from "./rules.js";

const { getBaseRisk, checkParamEscalations, globMatch, matchRule } = __testing;

// ─── getBaseRisk ─────────────────────────────────────────────────────────────

describe("getBaseRisk", () => {
  it("returns 'low' for read-only tools", () => {
    expect(getBaseRisk("read")).toBe("low");
    expect(getBaseRisk("memory_search")).toBe("low");
    expect(getBaseRisk("memory_get")).toBe("low");
    expect(getBaseRisk("web_search")).toBe("low");
    expect(getBaseRisk("web_fetch")).toBe("low");
    expect(getBaseRisk("sessions_list")).toBe("low");
  });

  it("returns 'medium' for write-type tools", () => {
    expect(getBaseRisk("write")).toBe("medium");
    expect(getBaseRisk("edit")).toBe("medium");
    expect(getBaseRisk("apply_patch")).toBe("medium");
    expect(getBaseRisk("message")).toBe("medium");
    expect(getBaseRisk("browser")).toBe("medium");
  });

  it("returns 'high' for exec-type tools", () => {
    expect(getBaseRisk("exec")).toBe("high");
    expect(getBaseRisk("process")).toBe("high");
    expect(getBaseRisk("sessions_send")).toBe("high");
    expect(getBaseRisk("sessions_spawn")).toBe("high");
  });

  it("returns 'critical' for gateway and whatsapp_login", () => {
    expect(getBaseRisk("gateway")).toBe("critical");
    expect(getBaseRisk("whatsapp_login")).toBe("critical");
  });

  it("returns 'medium' for unknown tools", () => {
    expect(getBaseRisk("totally_unknown_tool")).toBe("medium");
    expect(getBaseRisk("")).toBe("medium");
    expect(getBaseRisk("foo_bar")).toBe("medium");
  });
});

// ─── checkParamEscalations ───────────────────────────────────────────────────

describe("checkParamEscalations", () => {
  it("escalates write to sensitive paths", () => {
    const result = checkParamEscalations("write", { path: "/home/user/.env" });
    expect(result).not.toBeNull();
    expect(result!.risk).toBe("critical");
    expect(result!.label).toBe("write to sensitive path");
  });

  it("escalates write to config paths", () => {
    const result = checkParamEscalations("write", { path: "/etc/config/app.yml" });
    expect(result).not.toBeNull();
    expect(result!.risk).toBe("critical");
  });

  it("escalates write to .ssh paths", () => {
    const result = checkParamEscalations("write", { path: "/home/user/.ssh/authorized_keys" });
    expect(result).not.toBeNull();
    expect(result!.risk).toBe("critical");
  });

  it("escalates write to credential paths", () => {
    const result = checkParamEscalations("write", { path: "/app/credentials.json" });
    expect(result).not.toBeNull();
    expect(result!.risk).toBe("critical");
  });

  it("escalates edit to sensitive paths", () => {
    const result = checkParamEscalations("edit", { path: "/home/user/.env.local" });
    expect(result).not.toBeNull();
    expect(result!.risk).toBe("critical");
    expect(result!.label).toBe("edit sensitive path");
  });

  it("escalates exec with rm -rf", () => {
    const result = checkParamEscalations("exec", { command: "rm -rf /tmp/data" });
    expect(result).not.toBeNull();
    expect(result!.risk).toBe("critical");
    expect(result!.label).toBe("destructive command");
  });

  it("escalates exec with DROP TABLE", () => {
    const result = checkParamEscalations("exec", { command: "psql -c 'DROP TABLE users'" });
    expect(result).not.toBeNull();
    expect(result!.risk).toBe("critical");
  });

  it("escalates exec with DELETE FROM", () => {
    const result = checkParamEscalations("exec", { command: "DELETE FROM users WHERE id = 1" });
    expect(result).not.toBeNull();
    expect(result!.risk).toBe("critical");
  });

  it("escalates exec with shutdown", () => {
    const result = checkParamEscalations("exec", { command: "shutdown -h now" });
    expect(result).not.toBeNull();
    expect(result!.risk).toBe("critical");
  });

  it("escalates exec with reboot", () => {
    const result = checkParamEscalations("exec", { command: "sudo reboot" });
    expect(result).not.toBeNull();
    expect(result!.risk).toBe("critical");
  });

  it("escalates message with broadcast action", () => {
    const result = checkParamEscalations("message", { action: "broadcast" });
    expect(result).not.toBeNull();
    expect(result!.risk).toBe("critical");
    expect(result!.label).toBe("broadcast message");
  });

  it("returns null for non-matching tool", () => {
    const result = checkParamEscalations("read", { path: "/home/user/.env" });
    expect(result).toBeNull();
  });

  it("returns null for non-sensitive params", () => {
    const result = checkParamEscalations("write", { path: "/tmp/output.txt" });
    expect(result).toBeNull();
  });

  it("returns null when param key is missing", () => {
    const result = checkParamEscalations("exec", { somethingElse: "rm -rf /" });
    expect(result).toBeNull();
  });

  it("returns null when param value is undefined", () => {
    const result = checkParamEscalations("exec", { command: undefined });
    expect(result).toBeNull();
  });

  it("handles non-string param values via JSON.stringify", () => {
    const result = checkParamEscalations("exec", { command: { nested: "rm -rf /foo" } });
    expect(result).not.toBeNull();
    expect(result!.risk).toBe("critical");
  });

  it("is case-insensitive for patterns", () => {
    const result = checkParamEscalations("exec", { command: "DROP table users" });
    expect(result).not.toBeNull();
    expect(result!.risk).toBe("critical");
  });
});

// ─── globMatch ───────────────────────────────────────────────────────────────

describe("globMatch", () => {
  it("matches exact strings", () => {
    expect(globMatch("exec", "exec")).toBe(true);
    expect(globMatch("exec", "read")).toBe(false);
  });

  it("wildcard * matches everything", () => {
    expect(globMatch("*", "anything")).toBe(true);
    expect(globMatch("*", "")).toBe(true);
  });

  it("glob * matches prefix", () => {
    expect(globMatch("exec*", "exec")).toBe(true);
    expect(globMatch("exec*", "exec_run")).toBe(true);
    expect(globMatch("exec*", "read")).toBe(false);
  });

  it("glob * matches suffix", () => {
    expect(globMatch("*_search", "memory_search")).toBe(true);
    expect(globMatch("*_search", "web_search")).toBe(true);
    expect(globMatch("*_search", "web_fetch")).toBe(false);
  });

  it("glob * matches infix", () => {
    expect(globMatch("session*list", "sessions_list")).toBe(true);
    expect(globMatch("session*list", "sessionlist")).toBe(true);
    expect(globMatch("session*list", "sessionfoo")).toBe(false);
  });

  it("? matches single character", () => {
    expect(globMatch("rea?", "read")).toBe(true);
    expect(globMatch("rea?", "real")).toBe(true);
    expect(globMatch("rea?", "rea")).toBe(false);
    expect(globMatch("rea?", "reads")).toBe(false);
  });

  it("escapes special regex characters in pattern", () => {
    expect(globMatch("foo.bar", "foo.bar")).toBe(true);
    expect(globMatch("foo.bar", "fooXbar")).toBe(false);
  });
});

// ─── matchRule ───────────────────────────────────────────────────────────────

describe("matchRule", () => {
  it("matches when rule has no constraints (empty rule)", () => {
    const rule: GuardianRule = {};
    expect(matchRule(rule, "exec", {}, "owner")).toBe(true);
  });

  it("matches by tool name", () => {
    const rule: GuardianRule = { tool: "exec" };
    expect(matchRule(rule, "exec", {}, "owner")).toBe(true);
    expect(matchRule(rule, "read", {}, "owner")).toBe(false);
  });

  it("matches tool name with glob", () => {
    const rule: GuardianRule = { tool: "session*" };
    expect(matchRule(rule, "sessions_list", {}, "owner")).toBe(true);
    expect(matchRule(rule, "sessions_send", {}, "owner")).toBe(true);
    expect(matchRule(rule, "exec", {}, "owner")).toBe(false);
  });

  it("matches by minTrust", () => {
    const rule: GuardianRule = { tool: "exec", minTrust: "allowed" };
    expect(matchRule(rule, "exec", {}, "owner")).toBe(true);
    expect(matchRule(rule, "exec", {}, "allowed")).toBe(true);
    expect(matchRule(rule, "exec", {}, "unknown")).toBe(false);
    expect(matchRule(rule, "exec", {}, "subagent")).toBe(false);
  });

  it("matches by paramMatches regex", () => {
    const rule: GuardianRule = {
      tool: "write",
      paramMatches: { path: "\\.env" },
    };
    expect(matchRule(rule, "write", { path: "/home/.env" }, "owner")).toBe(true);
    expect(matchRule(rule, "write", { path: "/home/readme.md" }, "owner")).toBe(false);
  });

  it("returns false when param key is missing", () => {
    const rule: GuardianRule = {
      tool: "write",
      paramMatches: { path: "sensitive" },
    };
    expect(matchRule(rule, "write", {}, "owner")).toBe(false);
  });

  it("handles invalid regex in paramMatches as substring match", () => {
    const rule: GuardianRule = {
      tool: "exec",
      paramMatches: { command: "[invalid(regex" },
    };
    // Falls back to substring match
    expect(matchRule(rule, "exec", { command: "run [invalid(regex here" }, "owner")).toBe(true);
    expect(matchRule(rule, "exec", { command: "something else" }, "owner")).toBe(false);
  });

  it("handles non-string param values via JSON.stringify", () => {
    const rule: GuardianRule = {
      tool: "exec",
      paramMatches: { options: "verbose" },
    };
    expect(matchRule(rule, "exec", { options: { verbose: true } }, "owner")).toBe(true);
  });

  it("paramMatches is case-insensitive", () => {
    const rule: GuardianRule = {
      tool: "exec",
      paramMatches: { command: "DROP" },
    };
    expect(matchRule(rule, "exec", { command: "drop table" }, "owner")).toBe(true);
  });
});

// ─── riskAtLeast ─────────────────────────────────────────────────────────────

describe("riskAtLeast", () => {
  it("returns true when level equals threshold", () => {
    expect(riskAtLeast("low", "low")).toBe(true);
    expect(riskAtLeast("medium", "medium")).toBe(true);
    expect(riskAtLeast("high", "high")).toBe(true);
    expect(riskAtLeast("critical", "critical")).toBe(true);
  });

  it("returns true when level exceeds threshold", () => {
    expect(riskAtLeast("critical", "low")).toBe(true);
    expect(riskAtLeast("high", "medium")).toBe(true);
    expect(riskAtLeast("medium", "low")).toBe(true);
  });

  it("returns false when level is below threshold", () => {
    expect(riskAtLeast("low", "medium")).toBe(false);
    expect(riskAtLeast("low", "high")).toBe(false);
    expect(riskAtLeast("medium", "critical")).toBe(false);
    expect(riskAtLeast("high", "critical")).toBe(false);
  });
});

// ─── maxRisk ─────────────────────────────────────────────────────────────────

describe("maxRisk", () => {
  it("returns the higher risk level", () => {
    expect(maxRisk("low", "high")).toBe("high");
    expect(maxRisk("high", "low")).toBe("high");
    expect(maxRisk("medium", "critical")).toBe("critical");
    expect(maxRisk("critical", "medium")).toBe("critical");
  });

  it("returns the same level when both are equal", () => {
    expect(maxRisk("low", "low")).toBe("low");
    expect(maxRisk("critical", "critical")).toBe("critical");
  });
});

// ─── trustAtLeast ────────────────────────────────────────────────────────────

describe("trustAtLeast", () => {
  it("returns true when level equals minimum", () => {
    expect(trustAtLeast("owner", "owner")).toBe(true);
    expect(trustAtLeast("allowed", "allowed")).toBe(true);
    expect(trustAtLeast("subagent", "subagent")).toBe(true);
  });

  it("returns true when level exceeds minimum", () => {
    expect(trustAtLeast("owner", "allowed")).toBe(true);
    expect(trustAtLeast("owner", "unknown")).toBe(true);
    expect(trustAtLeast("owner", "subagent")).toBe(true);
    expect(trustAtLeast("allowed", "unknown")).toBe(true);
    expect(trustAtLeast("allowed", "subagent")).toBe(true);
  });

  it("returns false when level is below minimum", () => {
    expect(trustAtLeast("subagent", "owner")).toBe(false);
    expect(trustAtLeast("subagent", "allowed")).toBe(false);
    expect(trustAtLeast("unknown", "owner")).toBe(false);
    expect(trustAtLeast("unknown", "allowed")).toBe(false);
  });

  it("orders trust levels correctly: owner > allowed > unknown > subagent", () => {
    expect(trustAtLeast("owner", "subagent")).toBe(true);
    expect(trustAtLeast("allowed", "subagent")).toBe(true);
    expect(trustAtLeast("unknown", "subagent")).toBe(true);
    expect(trustAtLeast("subagent", "unknown")).toBe(false);
  });
});

// ─── resolveTrustLevel ──────────────────────────────────────────────────────

describe("resolveTrustLevel", () => {
  it("returns 'owner' when senderIsOwner is true", () => {
    expect(resolveTrustLevel({ senderIsOwner: true })).toBe("owner");
  });

  it("owner takes precedence over other flags", () => {
    expect(resolveTrustLevel({ senderIsOwner: true, isSubagent: true, isAllowed: true })).toBe(
      "owner",
    );
  });

  it("returns 'subagent' when isSubagent is true (and not owner)", () => {
    expect(resolveTrustLevel({ isSubagent: true })).toBe("subagent");
  });

  it("subagent takes precedence over allowed", () => {
    expect(resolveTrustLevel({ isSubagent: true, isAllowed: true })).toBe("subagent");
  });

  it("returns 'allowed' when isAllowed is true", () => {
    expect(resolveTrustLevel({ isAllowed: true })).toBe("allowed");
  });

  it("returns 'unknown' when no flags are set", () => {
    expect(resolveTrustLevel({})).toBe("unknown");
  });

  it("returns 'unknown' when all flags are false", () => {
    expect(resolveTrustLevel({ senderIsOwner: false, isSubagent: false, isAllowed: false })).toBe(
      "unknown",
    );
  });
});

// ─── effectiveThreshold ─────────────────────────────────────────────────────

describe("effectiveThreshold", () => {
  it("returns global approvalThreshold when no agentId is provided", () => {
    const config: GuardianConfig = { approvalThreshold: "medium" };
    expect(effectiveThreshold(config)).toBe("medium");
  });

  it("defaults to 'high' when no approvalThreshold is set", () => {
    const config: GuardianConfig = {};
    expect(effectiveThreshold(config)).toBe("high");
  });

  it("returns agent-specific threshold when agentId has override", () => {
    const config: GuardianConfig = {
      approvalThreshold: "high",
      agents: {
        "my-agent": { approvalThreshold: "low" },
      },
    };
    expect(effectiveThreshold(config, "my-agent")).toBe("low");
  });

  it("falls back to global threshold when agentId has no override", () => {
    const config: GuardianConfig = {
      approvalThreshold: "medium",
      agents: {
        "my-agent": {},
      },
    };
    expect(effectiveThreshold(config, "my-agent")).toBe("medium");
  });

  it("falls back to global threshold when agentId is not in agents map", () => {
    const config: GuardianConfig = {
      approvalThreshold: "medium",
      agents: {
        "other-agent": { approvalThreshold: "low" },
      },
    };
    expect(effectiveThreshold(config, "my-agent")).toBe("medium");
  });

  it("falls back to default 'high' when agents map is missing", () => {
    const config: GuardianConfig = {};
    expect(effectiveThreshold(config, "my-agent")).toBe("high");
  });
});

// ─── evaluateRules ──────────────────────────────────────────────────────────

describe("evaluateRules", () => {
  // --- Low-risk tools with default threshold -> ALLOW ---

  describe("low-risk tools with default threshold", () => {
    it("allows read tool with high threshold", () => {
      const result = evaluateRules({
        toolName: "read",
        toolParams: {},
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.decision).toBe("allow");
      expect(result.riskLevel).toBe("low");
    });

    it("allows memory_search tool with high threshold", () => {
      const result = evaluateRules({
        toolName: "memory_search",
        toolParams: {},
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.decision).toBe("allow");
      expect(result.riskLevel).toBe("low");
    });

    it("allows web_search tool with medium threshold", () => {
      const result = evaluateRules({
        toolName: "web_search",
        toolParams: {},
        threshold: "medium",
        trustLevel: "allowed",
      });
      expect(result.decision).toBe("allow");
      expect(result.riskLevel).toBe("low");
    });
  });

  // --- Critical tools -> ESCALATE ---

  describe("critical tools", () => {
    it("escalates gateway tool", () => {
      const result = evaluateRules({
        toolName: "gateway",
        toolParams: {},
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.decision).toBe("escalate");
      expect(result.riskLevel).toBe("critical");
    });

    it("escalates whatsapp_login tool", () => {
      const result = evaluateRules({
        toolName: "whatsapp_login",
        toolParams: {},
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.decision).toBe("escalate");
      expect(result.riskLevel).toBe("critical");
    });
  });

  // --- Exec with destructive params -> ESCALATE ---

  describe("exec with destructive param patterns", () => {
    it("escalates exec with rm -rf", () => {
      const result = evaluateRules({
        toolName: "exec",
        toolParams: { command: "rm -rf /var/data" },
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.decision).toBe("escalate");
      expect(result.riskLevel).toBe("critical");
      expect(result.reason).toContain("destructive command");
    });

    it("escalates exec with DROP TABLE", () => {
      const result = evaluateRules({
        toolName: "exec",
        toolParams: { command: "psql -c 'DROP TABLE users'" },
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.decision).toBe("escalate");
      expect(result.riskLevel).toBe("critical");
    });

    it("escalates exec with TRUNCATE TABLE", () => {
      const result = evaluateRules({
        toolName: "exec",
        toolParams: { command: "TRUNCATE TABLE logs" },
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.decision).toBe("escalate");
      expect(result.riskLevel).toBe("critical");
    });
  });

  // --- Write to sensitive paths -> ESCALATE ---

  describe("write to sensitive paths", () => {
    it("escalates write to .env file", () => {
      const result = evaluateRules({
        toolName: "write",
        toolParams: { path: "/app/.env" },
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.decision).toBe("escalate");
      expect(result.riskLevel).toBe("critical");
    });

    it("escalates write to config directory", () => {
      const result = evaluateRules({
        toolName: "write",
        toolParams: { path: "/etc/config/db.yml" },
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.decision).toBe("escalate");
      expect(result.riskLevel).toBe("critical");
    });

    it("escalates edit to secret file", () => {
      const result = evaluateRules({
        toolName: "edit",
        toolParams: { path: "/app/secret.json" },
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.decision).toBe("escalate");
      expect(result.riskLevel).toBe("critical");
    });

    it("does not escalate write to normal paths", () => {
      const result = evaluateRules({
        toolName: "write",
        toolParams: { path: "/tmp/output.txt" },
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.decision).toBe("allow");
      expect(result.riskLevel).toBe("medium");
    });
  });

  // --- Owner bypass ---

  describe("owner bypass", () => {
    it("allows high-risk tools for owner when risk is below critical", () => {
      const result = evaluateRules({
        toolName: "exec",
        toolParams: {},
        threshold: "high",
        trustLevel: "owner",
      });
      expect(result.decision).toBe("allow");
      expect(result.riskLevel).toBe("high");
      expect(result.reason).toContain("owner bypass");
    });

    it("allows medium-risk tools for owner", () => {
      const result = evaluateRules({
        toolName: "write",
        toolParams: { path: "/tmp/file.txt" },
        threshold: "medium",
        trustLevel: "owner",
      });
      expect(result.decision).toBe("allow");
      expect(result.reason).toContain("owner bypass");
    });

    it("does NOT bypass critical risk even for owner", () => {
      const result = evaluateRules({
        toolName: "gateway",
        toolParams: {},
        threshold: "high",
        trustLevel: "owner",
      });
      expect(result.decision).toBe("escalate");
      expect(result.riskLevel).toBe("critical");
    });

    it("does NOT bypass critical param escalation for owner", () => {
      const result = evaluateRules({
        toolName: "exec",
        toolParams: { command: "rm -rf /everything" },
        threshold: "high",
        trustLevel: "owner",
      });
      expect(result.decision).toBe("escalate");
      expect(result.riskLevel).toBe("critical");
    });
  });

  // --- Subagent stricter threshold ---

  describe("subagent stricter threshold", () => {
    it("lowers threshold by one level for subagents", () => {
      // With threshold "high", subagent gets "medium"
      // So a "medium" risk tool (write) would escalate for subagent
      const result = evaluateRules({
        toolName: "write",
        toolParams: { path: "/tmp/output.txt" },
        threshold: "high",
        trustLevel: "subagent",
      });
      expect(result.decision).toBe("escalate");
      expect(result.riskLevel).toBe("medium");
    });

    it("allows low-risk tools even with lowered threshold", () => {
      // threshold "high" -> subagent gets "medium", low < medium -> allow
      const result = evaluateRules({
        toolName: "read",
        toolParams: {},
        threshold: "high",
        trustLevel: "subagent",
      });
      expect(result.decision).toBe("allow");
      expect(result.riskLevel).toBe("low");
    });

    it("escalates high-risk tools for subagent with high threshold", () => {
      // threshold "high" -> subagent gets "medium", high >= medium -> escalate
      const result = evaluateRules({
        toolName: "exec",
        toolParams: {},
        threshold: "high",
        trustLevel: "subagent",
      });
      expect(result.decision).toBe("escalate");
      expect(result.riskLevel).toBe("high");
    });

    it("does not lower threshold below 'low'", () => {
      // threshold "low" has RISK_ORDER 0, so it stays at "low" (no negative index)
      // But low >= low is true, so even read (low) escalates for subagent
      const result = evaluateRules({
        toolName: "read",
        toolParams: {},
        threshold: "low",
        trustLevel: "subagent",
      });
      expect(result.decision).toBe("escalate");
      expect(result.riskLevel).toBe("low");
    });
  });

  // --- Custom rules matching ---

  describe("custom rules matching", () => {
    it("matches a global rule by tool name and returns its action", () => {
      const rule: GuardianRule = {
        id: "allow-read",
        tool: "read",
        action: "allow",
        label: "always allow read",
      };
      const result = evaluateRules({
        toolName: "read",
        toolParams: {},
        globalRules: [rule],
        threshold: "low",
        trustLevel: "subagent",
      });
      expect(result.decision).toBe("allow");
      expect(result.ruleLabel).toBe("always allow read");
    });

    it("matches a rule with tool glob pattern", () => {
      const rule: GuardianRule = {
        tool: "session*",
        action: "deny",
        label: "deny all session tools",
      };
      const result = evaluateRules({
        toolName: "sessions_list",
        toolParams: {},
        globalRules: [rule],
        threshold: "high",
        trustLevel: "owner",
      });
      expect(result.decision).toBe("deny");
    });

    it("matches a rule with param regex", () => {
      const rule: GuardianRule = {
        tool: "exec",
        paramMatches: { command: "npm\\s+publish" },
        action: "escalate",
        label: "escalate npm publish",
      };
      const result = evaluateRules({
        toolName: "exec",
        toolParams: { command: "npm publish --access public" },
        globalRules: [rule],
        threshold: "high",
        trustLevel: "owner",
      });
      expect(result.decision).toBe("escalate");
      expect(result.ruleLabel).toBe("escalate npm publish");
    });

    it("matches a rule with trust level check", () => {
      const rule: GuardianRule = {
        tool: "exec",
        minTrust: "owner",
        action: "allow",
        label: "allow exec for owner",
      };
      const result = evaluateRules({
        toolName: "exec",
        toolParams: {},
        globalRules: [rule],
        threshold: "high",
        trustLevel: "owner",
      });
      expect(result.decision).toBe("allow");

      // Same rule but with 'allowed' trust - rule does not match
      const result2 = evaluateRules({
        toolName: "exec",
        toolParams: {},
        globalRules: [rule],
        threshold: "high",
        trustLevel: "allowed",
      });
      // Rule doesn't match, falls through to default logic
      expect(result2.decision).toBe("escalate");
    });

    it("defaults rule action to 'escalate' when not specified", () => {
      const rule: GuardianRule = {
        tool: "exec",
      };
      const result = evaluateRules({
        toolName: "exec",
        toolParams: {},
        globalRules: [rule],
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.decision).toBe("escalate");
    });

    it("applies riskLevel override from the rule", () => {
      const rule: GuardianRule = {
        tool: "read",
        action: "escalate",
        riskLevel: "critical",
        label: "force critical for read",
      };
      const result = evaluateRules({
        toolName: "read",
        toolParams: {},
        globalRules: [rule],
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.decision).toBe("escalate");
      expect(result.riskLevel).toBe("critical");
    });

    it("first matching rule wins", () => {
      const rules: GuardianRule[] = [
        { tool: "exec", action: "allow", label: "first" },
        { tool: "exec", action: "deny", label: "second" },
      ];
      const result = evaluateRules({
        toolName: "exec",
        toolParams: {},
        globalRules: rules,
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.decision).toBe("allow");
      expect(result.ruleLabel).toBe("first");
    });
  });

  // --- Agent-specific rules evaluated before global rules ---

  describe("agent-specific rules before global rules", () => {
    it("agent rules take precedence over global rules", () => {
      const globalRule: GuardianRule = {
        tool: "exec",
        action: "deny",
        label: "global deny exec",
      };
      const agentRule: GuardianRule = {
        tool: "exec",
        action: "allow",
        label: "agent allow exec",
      };
      const result = evaluateRules({
        toolName: "exec",
        toolParams: {},
        globalRules: [globalRule],
        agentRules: [agentRule],
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.decision).toBe("allow");
      expect(result.ruleLabel).toBe("agent allow exec");
    });

    it("falls through to global rules when agent rules do not match", () => {
      const globalRule: GuardianRule = {
        tool: "exec",
        action: "deny",
        label: "global deny exec",
      };
      const agentRule: GuardianRule = {
        tool: "read",
        action: "allow",
        label: "agent allow read",
      };
      const result = evaluateRules({
        toolName: "exec",
        toolParams: {},
        globalRules: [globalRule],
        agentRules: [agentRule],
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.decision).toBe("deny");
      expect(result.ruleLabel).toBe("global deny exec");
    });
  });

  // --- Tool name normalization ---

  describe("tool name normalization", () => {
    it("normalizes tool names (lowercased/trimmed)", () => {
      const result = evaluateRules({
        toolName: "  READ  ",
        toolParams: {},
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.riskLevel).toBe("low");
      expect(result.decision).toBe("allow");
    });
  });

  // --- Reason / label propagation ---

  describe("reason and label propagation", () => {
    it("includes escalation label in reason when param escalation triggers", () => {
      const result = evaluateRules({
        toolName: "exec",
        toolParams: { command: "rm -rf /data" },
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.reason).toContain("destructive command");
    });

    it("includes risk vs threshold in reason when no escalation or rule match", () => {
      const result = evaluateRules({
        toolName: "exec",
        toolParams: {},
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.reason).toContain("risk high >= threshold high");
    });

    it("includes risk vs threshold in allow reason", () => {
      const result = evaluateRules({
        toolName: "read",
        toolParams: {},
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.reason).toContain("risk low < threshold high");
    });

    it("uses rule label when a rule matches", () => {
      const rule: GuardianRule = {
        tool: "read",
        action: "deny",
        label: "no reading allowed",
      };
      const result = evaluateRules({
        toolName: "read",
        toolParams: {},
        globalRules: [rule],
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.reason).toBe("no reading allowed");
      expect(result.ruleLabel).toBe("no reading allowed");
    });

    it("uses escalation label over rule label when param escalation applies", () => {
      const rule: GuardianRule = {
        tool: "exec",
        label: "generic exec rule",
      };
      const result = evaluateRules({
        toolName: "exec",
        toolParams: { command: "rm -rf /data" },
        globalRules: [rule],
        threshold: "high",
        trustLevel: "allowed",
      });
      // Escalation label ("destructive command") takes precedence
      expect(result.reason).toBe("destructive command");
    });

    it("generates fallback reason from rule id/tool when label is absent", () => {
      const rule: GuardianRule = {
        id: "rule-123",
        tool: "exec",
        action: "deny",
      };
      const result = evaluateRules({
        toolName: "exec",
        toolParams: {},
        globalRules: [rule],
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.reason).toContain("matched rule: rule-123");
    });
  });

  // --- Edge cases ---

  describe("edge cases", () => {
    it("handles empty params object", () => {
      const result = evaluateRules({
        toolName: "exec",
        toolParams: {},
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.decision).toBe("escalate");
    });

    it("handles no rules provided", () => {
      const result = evaluateRules({
        toolName: "read",
        toolParams: {},
        threshold: "high",
        trustLevel: "allowed",
      });
      expect(result.decision).toBe("allow");
    });

    it("handles unknown tool with medium threshold -> escalate", () => {
      const result = evaluateRules({
        toolName: "some_unknown_tool",
        toolParams: {},
        threshold: "medium",
        trustLevel: "allowed",
      });
      // Unknown tool = "medium", threshold = "medium", medium >= medium -> escalate
      expect(result.decision).toBe("escalate");
      expect(result.riskLevel).toBe("medium");
    });

    it("handles unknown tool with high threshold -> allow", () => {
      const result = evaluateRules({
        toolName: "some_unknown_tool",
        toolParams: {},
        threshold: "high",
        trustLevel: "allowed",
      });
      // Unknown tool = "medium", threshold = "high", medium < high -> allow
      expect(result.decision).toBe("allow");
      expect(result.riskLevel).toBe("medium");
    });

    it("trustLevel is propagated to the result", () => {
      const result = evaluateRules({
        toolName: "read",
        toolParams: {},
        threshold: "high",
        trustLevel: "subagent",
      });
      expect(result.trustLevel).toBe("subagent");
    });
  });
});
