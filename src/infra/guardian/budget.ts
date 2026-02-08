import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { GuardianBudgetConfig, GuardianBudgetResult } from "./types.js";

type DailyBudgetEntry = {
  date: string;
  totalCost: number;
  perAgent: Record<string, number>;
};

type BudgetFile = {
  daily: DailyBudgetEntry[];
};

export type BudgetTracker = {
  getSessionCost: (agentId?: string) => number;
  getDailyCost: (agentId?: string) => number;
  recordCost: (toolName: string, cost: number, agentId?: string) => void;
  reset: () => void;
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveToolCost(toolName: string, config?: GuardianBudgetConfig): number {
  if (config?.perToolCosts?.[toolName] !== undefined) {
    return config.perToolCosts[toolName];
  }
  return config?.defaultToolCost ?? 0.01;
}

export function createBudgetTracker(budgetPath?: string): BudgetTracker {
  // In-memory session costs
  const sessionCosts = new Map<string, number>();
  let sessionTotal = 0;

  // Daily costs loaded from disk
  let dailyCache: DailyBudgetEntry | null = null;

  function loadDaily(): DailyBudgetEntry {
    const today = todayKey();
    if (dailyCache?.date === today) {
      return dailyCache;
    }
    if (budgetPath && existsSync(budgetPath)) {
      try {
        const raw = readFileSync(budgetPath, "utf8");
        const data = JSON.parse(raw) as BudgetFile;
        const entry = data.daily?.find((d) => d.date === today);
        if (entry) {
          dailyCache = entry;
          return entry;
        }
      } catch {
        // corrupted file, start fresh
      }
    }
    dailyCache = { date: today, totalCost: 0, perAgent: {} };
    return dailyCache;
  }

  function saveDaily(entry: DailyBudgetEntry): void {
    if (!budgetPath) {
      return;
    }
    let data: BudgetFile = { daily: [] };
    if (existsSync(budgetPath)) {
      try {
        data = JSON.parse(readFileSync(budgetPath, "utf8")) as BudgetFile;
      } catch {
        data = { daily: [] };
      }
    }
    // Keep only last 7 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    data.daily = data.daily.filter((d) => d.date >= cutoffStr && d.date !== entry.date);
    data.daily.push(entry);
    try {
      const dir = dirname(budgetPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(budgetPath, JSON.stringify(data, null, 2), "utf8");
    } catch {
      // best-effort persistence
    }
  }

  return {
    getSessionCost(agentId?: string): number {
      if (agentId) {
        return sessionCosts.get(agentId) ?? 0;
      }
      return sessionTotal;
    },

    getDailyCost(agentId?: string): number {
      const daily = loadDaily();
      if (agentId) {
        return daily.perAgent[agentId] ?? 0;
      }
      return daily.totalCost;
    },

    recordCost(toolName: string, cost: number, agentId?: string): void {
      void toolName; // used by callers for cost lookup
      sessionTotal += cost;
      if (agentId) {
        sessionCosts.set(agentId, (sessionCosts.get(agentId) ?? 0) + cost);
      }
      const daily = loadDaily();
      daily.totalCost += cost;
      if (agentId) {
        daily.perAgent[agentId] = (daily.perAgent[agentId] ?? 0) + cost;
      }
      saveDaily(daily);
    },

    reset(): void {
      sessionCosts.clear();
      sessionTotal = 0;
      dailyCache = null;
    },
  };
}

export function checkBudget(params: {
  toolName: string;
  budgetConfig?: GuardianBudgetConfig;
  tracker: BudgetTracker;
  agentId?: string;
}): GuardianBudgetResult {
  const { toolName, budgetConfig, tracker, agentId } = params;
  if (!budgetConfig?.enabled) {
    return { exceeded: false };
  }

  const cost = resolveToolCost(toolName, budgetConfig);
  const onExceeded = budgetConfig.onExceeded ?? "deny";

  if (budgetConfig.sessionLimit !== undefined) {
    const currentSession = tracker.getSessionCost(agentId);
    if (currentSession + cost > budgetConfig.sessionLimit) {
      return {
        exceeded: true,
        action: onExceeded,
        reason: `Session budget exceeded: $${(currentSession + cost).toFixed(4)} > $${budgetConfig.sessionLimit} limit`,
      };
    }
  }

  if (budgetConfig.dailyLimit !== undefined) {
    const currentDaily = tracker.getDailyCost(agentId);
    if (currentDaily + cost > budgetConfig.dailyLimit) {
      return {
        exceeded: true,
        action: onExceeded,
        reason: `Daily budget exceeded: $${(currentDaily + cost).toFixed(4)} > $${budgetConfig.dailyLimit} limit`,
      };
    }
  }

  // Record the cost optimistically (caller should only record on allow)
  return { exceeded: false };
}

export function recordToolCost(params: {
  toolName: string;
  budgetConfig?: GuardianBudgetConfig;
  tracker: BudgetTracker;
  agentId?: string;
}): void {
  const cost = resolveToolCost(params.toolName, params.budgetConfig);
  params.tracker.recordCost(params.toolName, cost, params.agentId);
}
