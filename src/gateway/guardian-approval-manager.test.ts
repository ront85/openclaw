import { describe, expect, it, vi } from "vitest";
import type { GuardianDecision } from "../infra/guardian/types.js";
import type { GuardianApprovalRequestPayload } from "./guardian-approval-manager.js";
import { GuardianApprovalManager } from "./guardian-approval-manager.js";

const makeRequest = (
  overrides?: Partial<GuardianApprovalRequestPayload>,
): GuardianApprovalRequestPayload => ({
  toolName: "bash",
  params: { command: "echo hi" },
  ...overrides,
});

describe("GuardianApprovalManager", () => {
  describe("create", () => {
    it("returns a record with id, request, createdAtMs, expiresAtMs", () => {
      const manager = new GuardianApprovalManager();
      const request = makeRequest();
      const timeoutMs = 5000;

      const record = manager.create(request, timeoutMs);

      expect(record.id).toBeTypeOf("string");
      expect(record.id.length).toBeGreaterThan(0);
      expect(record.request).toBe(request);
      expect(record.createdAtMs).toBeTypeOf("number");
      expect(record.expiresAtMs).toBe(record.createdAtMs + timeoutMs);
    });

    it("uses explicit id when provided", () => {
      const manager = new GuardianApprovalManager();
      const record = manager.create(makeRequest(), 5000, "my-custom-id");

      expect(record.id).toBe("my-custom-id");
    });

    it("generates UUID when no id provided", () => {
      const manager = new GuardianApprovalManager();
      const recordA = manager.create(makeRequest(), 5000);
      const recordB = manager.create(makeRequest(), 5000);

      // UUIDs are 36 chars (8-4-4-4-12)
      expect(recordA.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/);
      expect(recordA.id).not.toBe(recordB.id);
    });

    it("generates UUID when id is null", () => {
      const manager = new GuardianApprovalManager();
      const record = manager.create(makeRequest(), 5000, null);

      expect(record.id).toMatch(/^[\da-f]{8}-/);
    });

    it("generates UUID when id is empty string", () => {
      const manager = new GuardianApprovalManager();
      const record = manager.create(makeRequest(), 5000, "");

      expect(record.id).toMatch(/^[\da-f]{8}-/);
    });

    it("trims whitespace from explicit id", () => {
      const manager = new GuardianApprovalManager();
      const record = manager.create(makeRequest(), 5000, "  spaced-id  ");

      expect(record.id).toBe("spaced-id");
    });
  });

  describe("waitForDecision", () => {
    it("resolves with decision when resolve is called", async () => {
      const manager = new GuardianApprovalManager();
      const record = manager.create(makeRequest(), 30_000);

      const promise = manager.waitForDecision(record, 30_000);
      manager.resolve(record.id, "allow-once");

      const decision = await promise;
      expect(decision).toBe("allow-once");
    });

    it("resolves with null on timeout", async () => {
      vi.useFakeTimers();
      try {
        const manager = new GuardianApprovalManager();
        const record = manager.create(makeRequest(), 1000);

        const promise = manager.waitForDecision(record, 1000);
        vi.advanceTimersByTime(1000);

        const decision = await promise;
        expect(decision).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("cleans up pending entry after timeout", async () => {
      vi.useFakeTimers();
      try {
        const manager = new GuardianApprovalManager();
        const record = manager.create(makeRequest(), 500);

        const promise = manager.waitForDecision(record, 500);
        vi.advanceTimersByTime(500);
        await promise;

        // After timeout, getSnapshot should return null (entry removed)
        expect(manager.getSnapshot(record.id)).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("resolve", () => {
    it("returns true for pending approvals", async () => {
      const manager = new GuardianApprovalManager();
      const record = manager.create(makeRequest(), 30_000);

      const promise = manager.waitForDecision(record, 30_000);
      const result = manager.resolve(record.id, "allow-once");

      expect(result).toBe(true);
      await promise;
    });

    it("returns false for unknown ids", () => {
      const manager = new GuardianApprovalManager();
      const result = manager.resolve("nonexistent-id", "deny");

      expect(result).toBe(false);
    });

    it("returns false for already-resolved ids", async () => {
      const manager = new GuardianApprovalManager();
      const record = manager.create(makeRequest(), 30_000);

      const promise = manager.waitForDecision(record, 30_000);
      manager.resolve(record.id, "allow-once");
      await promise;

      // Second resolve should return false since entry was removed
      const result = manager.resolve(record.id, "deny");
      expect(result).toBe(false);
    });

    it("sets resolvedAtMs and decision on the record", async () => {
      vi.useFakeTimers();
      try {
        const manager = new GuardianApprovalManager();
        const record = manager.create(makeRequest(), 30_000);

        // Start waiting so the record is registered as pending
        const promise = manager.waitForDecision(record, 30_000);

        vi.advanceTimersByTime(100);
        manager.resolve(record.id, "allow-session", "user-42");

        await promise;

        expect(record.resolvedAtMs).toBeTypeOf("number");
        expect(record.decision).toBe("allow-session");
        expect(record.resolvedBy).toBe("user-42");
      } finally {
        vi.useRealTimers();
      }
    });

    it("sets resolvedBy to null when not provided", async () => {
      const manager = new GuardianApprovalManager();
      const record = manager.create(makeRequest(), 30_000);

      const promise = manager.waitForDecision(record, 30_000);
      manager.resolve(record.id, "deny");
      await promise;

      expect(record.resolvedBy).toBeNull();
    });
  });

  describe("getSnapshot", () => {
    it("returns record for pending approvals", async () => {
      const manager = new GuardianApprovalManager();
      const record = manager.create(makeRequest({ toolName: "file_read" }), 30_000);

      // Must call waitForDecision to register the entry as pending
      const promise = manager.waitForDecision(record, 30_000);

      const snapshot = manager.getSnapshot(record.id);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.id).toBe(record.id);
      expect(snapshot?.request.toolName).toBe("file_read");

      // Clean up
      manager.resolve(record.id, "deny");
      await promise;
    });

    it("returns null for unknown ids", () => {
      const manager = new GuardianApprovalManager();
      const snapshot = manager.getSnapshot("does-not-exist");

      expect(snapshot).toBeNull();
    });

    it("returns null after approval is resolved", async () => {
      const manager = new GuardianApprovalManager();
      const record = manager.create(makeRequest(), 30_000);

      const promise = manager.waitForDecision(record, 30_000);
      manager.resolve(record.id, "allow-always");
      await promise;

      expect(manager.getSnapshot(record.id)).toBeNull();
    });
  });

  describe("GuardianDecision values", () => {
    const decisions: GuardianDecision[] = ["allow-once", "allow-session", "allow-always", "deny"];

    for (const decision of decisions) {
      it(`supports decision: ${decision}`, async () => {
        const manager = new GuardianApprovalManager();
        const record = manager.create(makeRequest(), 30_000);

        const promise = manager.waitForDecision(record, 30_000);
        const resolved = manager.resolve(record.id, decision);

        expect(resolved).toBe(true);

        const result = await promise;
        expect(result).toBe(decision);
        expect(record.decision).toBe(decision);
      });
    }
  });
});
