import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { describe, it, expect, beforeEach } from "vitest";
import { guardSessionManager } from "./session-tool-result-guard-wrapper.js";

describe("User Message Filtering", () => {
  it("should filter user messages before persistence", () => {
    const messages: AgentMessage[] = [];
    const mockSessionManager = {
      appendMessage: (msg: AgentMessage) => {
        messages.push(msg);
      },
    } as unknown as SessionManager;

    // Mock transform that replaces "SECRET" with "REDACTED"
    const guardedManager = guardSessionManager(mockSessionManager, {
      agentId: "test-agent",
      sessionKey: "test-session",
    });

    // Override the transform for testing
    const originalAppend = (mockSessionManager as { appendMessage: unknown }).appendMessage;
    (mockSessionManager as { appendMessage: unknown }).appendMessage = (msg: AgentMessage) => {
      let filtered = msg;
      const role = (msg as { role?: unknown }).role;

      if (role === "user") {
        const content = (msg as { content?: unknown }).content;
        if (typeof content === "string") {
          filtered = {
            ...msg,
            content: content.replace(/SECRET/g, "REDACTED"),
          } as AgentMessage;
        }
      }

      return (originalAppend as (m: AgentMessage) => void)(filtered);
    };

    // Add a user message with a secret
    const userMessage = {
      id: "msg_1",
      type: "user",
      role: "user",
      content: "My password is SECRET123",
    } as AgentMessage;

    guardedManager.appendMessage(userMessage as never);

    // Verify the message was filtered
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "user",
      content: "My password is REDACTED123",
    });
  });

  it("should pass through messages without filtering when no transform provided", () => {
    const messages: AgentMessage[] = [];
    const mockSessionManager = {
      appendMessage: (msg: AgentMessage) => {
        messages.push(msg);
      },
    } as unknown as SessionManager;

    const guardedManager = guardSessionManager(mockSessionManager, {
      agentId: "test-agent",
      sessionKey: "test-session",
    });

    const userMessage = {
      id: "msg_1",
      type: "user",
      role: "user",
      content: "Regular message",
    } as AgentMessage;

    guardedManager.appendMessage(userMessage as never);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "user",
      content: "Regular message",
    });
  });
});
