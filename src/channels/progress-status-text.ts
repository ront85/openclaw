/**
 * Channel-agnostic progress status text builder.
 * Formats human-readable status strings from agent lifecycle events
 * for display in draft stream messages (e.g. Discord "progress" mode).
 */

import { CODING_TOOL_TOKENS, WEB_TOOL_TOKENS } from "./status-reactions.js";

export type ProgressPhase = "thinking" | "tool" | "compacting";

export type ProgressTracker = {
  setPhase: (phase: ProgressPhase, toolName?: string) => void;
  format: () => string;
};

/**
 * Resolve a human-readable label for a tool invocation.
 * Reuses the same token classification from status-reactions.ts.
 */
function resolveToolLabel(toolName: string | undefined): string {
  const normalized = toolName?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return "Running tool";
  }
  if (WEB_TOOL_TOKENS.some((token) => normalized.includes(token))) {
    return "Searching the web";
  }
  if (CODING_TOOL_TOKENS.some((token) => normalized.includes(token))) {
    return "Running code";
  }
  return `Running tool: ${toolName}`;
}

function formatElapsed(ms: number): string {
  if (ms < 5000) {
    return "";
  }
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    return ` (${totalSeconds}s)`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return ` (${minutes}m ${seconds}s)`;
}

export function createProgressTracker(params?: { now?: () => number }): ProgressTracker {
  const now = params?.now ?? Date.now;
  let phase: ProgressPhase = "thinking";
  let toolName: string | undefined;
  let phaseStartMs = now();

  function setPhase(newPhase: ProgressPhase, newToolName?: string): void {
    // Reset timer on phase change or tool name change
    if (newPhase !== phase || newToolName !== toolName) {
      phaseStartMs = now();
    }
    phase = newPhase;
    toolName = newToolName;
  }

  function format(): string {
    const elapsed = now() - phaseStartMs;
    const suffix = formatElapsed(elapsed);
    switch (phase) {
      case "thinking":
        return `Thinking...${suffix}`;
      case "tool":
        return `${resolveToolLabel(toolName)}${suffix}`;
      case "compacting":
        return `Compacting context...${suffix}`;
    }
  }

  return { setPhase, format };
}
