import { describe, expect, it } from "vitest";
import type { GuardianBudgetConfig } from "./types.js";
import { createBudgetTracker, checkBudget } from "./budget.js";

describe("createBudgetTracker", () => {
  it("initial session/daily cost is 0", () => {
    const tracker = createBudgetTracker();
    expect(tracker.getSessionCost()).toBe(0);
    expect(tracker.getDailyCost()).toBe(0);
  });

  it("recordCost increments session and daily totals", () => {
    const tracker = createBudgetTracker();
    tracker.recordCost("exec", 0.05);
    expect(tracker.getSessionCost()).toBe(0.05);
    expect(tracker.getDailyCost()).toBe(0.05);

    tracker.recordCost("write", 0.1);
    expect(tracker.getSessionCost()).toBeCloseTo(0.15);
    expect(tracker.getDailyCost()).toBeCloseTo(0.15);
  });

  it("agent-specific cost tracking", () => {
    const tracker = createBudgetTracker();
    tracker.recordCost("exec", 0.05, "agent-a");
    tracker.recordCost("exec", 0.1, "agent-b");
    tracker.recordCost("exec", 0.03, "agent-a");

    // Agent-specific session costs
    expect(tracker.getSessionCost("agent-a")).toBeCloseTo(0.08);
    expect(tracker.getSessionCost("agent-b")).toBeCloseTo(0.1);

    // Total session cost (all agents combined)
    expect(tracker.getSessionCost()).toBeCloseTo(0.18);

    // Agent-specific daily costs
    expect(tracker.getDailyCost("agent-a")).toBeCloseTo(0.08);
    expect(tracker.getDailyCost("agent-b")).toBeCloseTo(0.1);
  });

  it("reset clears session costs", () => {
    const tracker = createBudgetTracker();
    tracker.recordCost("exec", 1.0);
    tracker.recordCost("exec", 2.0, "agent-x");
    expect(tracker.getSessionCost()).toBe(3.0);
    expect(tracker.getSessionCost("agent-x")).toBe(2.0);

    tracker.reset();

    expect(tracker.getSessionCost()).toBe(0);
    expect(tracker.getSessionCost("agent-x")).toBe(0);
  });
});

describe("checkBudget", () => {
  it("returns {exceeded: false} when budget not enabled", () => {
    const tracker = createBudgetTracker();
    const budgetConfig: GuardianBudgetConfig = { enabled: false };
    const result = checkBudget({ toolName: "exec", budgetConfig, tracker });
    expect(result).toEqual({ exceeded: false });
  });

  it("returns {exceeded: false} when within limits", () => {
    const tracker = createBudgetTracker();
    const budgetConfig: GuardianBudgetConfig = {
      enabled: true,
      sessionLimit: 10,
      dailyLimit: 100,
      defaultToolCost: 0.01,
    };
    const result = checkBudget({ toolName: "exec", budgetConfig, tracker });
    expect(result).toEqual({ exceeded: false });
  });

  it("returns {exceeded: true, action: deny} when session limit exceeded", () => {
    const tracker = createBudgetTracker();
    // Pre-fill costs to nearly hit the limit
    tracker.recordCost("exec", 9.99);

    const budgetConfig: GuardianBudgetConfig = {
      enabled: true,
      sessionLimit: 10,
      defaultToolCost: 0.02,
      onExceeded: "deny",
    };
    const result = checkBudget({ toolName: "exec", budgetConfig, tracker });
    expect(result.exceeded).toBe(true);
    expect(result.action).toBe("deny");
    expect(result.reason).toContain("Session budget exceeded");
  });

  it("returns {exceeded: true, action: deny} when daily limit exceeded", () => {
    const tracker = createBudgetTracker();
    // Pre-fill daily costs
    tracker.recordCost("exec", 49.99);

    const budgetConfig: GuardianBudgetConfig = {
      enabled: true,
      sessionLimit: 100, // session limit is fine
      dailyLimit: 50,
      defaultToolCost: 0.02,
      onExceeded: "deny",
    };
    const result = checkBudget({ toolName: "exec", budgetConfig, tracker });
    expect(result.exceeded).toBe(true);
    expect(result.action).toBe("deny");
    expect(result.reason).toContain("Daily budget exceeded");
  });

  it("returns {exceeded: true, action: escalate} when onExceeded is escalate", () => {
    const tracker = createBudgetTracker();
    tracker.recordCost("exec", 9.99);

    const budgetConfig: GuardianBudgetConfig = {
      enabled: true,
      sessionLimit: 10,
      defaultToolCost: 0.02,
      onExceeded: "escalate",
    };
    const result = checkBudget({ toolName: "exec", budgetConfig, tracker });
    expect(result.exceeded).toBe(true);
    expect(result.action).toBe("escalate");
  });

  it("uses per-tool costs from config", () => {
    const tracker = createBudgetTracker();
    // Session has $9 already used
    tracker.recordCost("exec", 9);

    const budgetConfig: GuardianBudgetConfig = {
      enabled: true,
      sessionLimit: 10,
      defaultToolCost: 0.01,
      // exec costs $2 per call
      perToolCosts: { exec: 2 },
      onExceeded: "deny",
    };
    // 9 + 2 = 11 > 10 limit
    const result = checkBudget({ toolName: "exec", budgetConfig, tracker });
    expect(result.exceeded).toBe(true);
    expect(result.action).toBe("deny");
  });

  it("uses default tool cost when no per-tool cost specified", () => {
    const tracker = createBudgetTracker();
    tracker.recordCost("read", 9.995);

    const budgetConfig: GuardianBudgetConfig = {
      enabled: true,
      sessionLimit: 10,
      defaultToolCost: 0.01,
      perToolCosts: { exec: 5 }, // only exec has a per-tool cost
      onExceeded: "deny",
    };
    // read uses default cost 0.01, so 9.995 + 0.01 = 10.005 > 10
    const result = checkBudget({ toolName: "read", budgetConfig, tracker });
    expect(result.exceeded).toBe(true);
    expect(result.action).toBe("deny");
  });
});
