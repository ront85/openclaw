import { describe, expect, it } from "vitest";
import { createProgressTracker } from "./progress-status-text.js";

describe("createProgressTracker", () => {
  function createClock(startMs = 0) {
    let time = startMs;
    return {
      now: () => time,
      advance: (ms: number) => {
        time += ms;
      },
    };
  }

  describe("thinking phase", () => {
    it("shows no elapsed time under 5s", () => {
      const clock = createClock();
      const tracker = createProgressTracker({ now: clock.now });
      tracker.setPhase("thinking");
      expect(tracker.format()).toBe("Thinking...");
    });

    it("shows seconds after 5s", () => {
      const clock = createClock();
      const tracker = createProgressTracker({ now: clock.now });
      tracker.setPhase("thinking");
      clock.advance(8000);
      expect(tracker.format()).toBe("Thinking... (8s)");
    });

    it("shows minutes and seconds over 60s", () => {
      const clock = createClock();
      const tracker = createProgressTracker({ now: clock.now });
      tracker.setPhase("thinking");
      clock.advance(90_000);
      expect(tracker.format()).toBe("Thinking... (1m 30s)");
    });
  });

  describe("tool phase", () => {
    it("shows generic label for unknown tool", () => {
      const clock = createClock();
      const tracker = createProgressTracker({ now: clock.now });
      tracker.setPhase("tool", "my_custom_tool");
      expect(tracker.format()).toBe("Running tool: my_custom_tool");
    });

    it("shows 'Searching the web' for web_search", () => {
      const clock = createClock();
      const tracker = createProgressTracker({ now: clock.now });
      tracker.setPhase("tool", "web_search");
      expect(tracker.format()).toBe("Searching the web");
    });

    it("shows 'Running code' for bash", () => {
      const clock = createClock();
      const tracker = createProgressTracker({ now: clock.now });
      tracker.setPhase("tool", "bash");
      expect(tracker.format()).toBe("Running code");
    });

    it("shows elapsed time after 5s", () => {
      const clock = createClock();
      const tracker = createProgressTracker({ now: clock.now });
      tracker.setPhase("tool", "web_search");
      clock.advance(12_000);
      expect(tracker.format()).toBe("Searching the web (12s)");
    });

    it("shows generic label for undefined tool name", () => {
      const clock = createClock();
      const tracker = createProgressTracker({ now: clock.now });
      tracker.setPhase("tool");
      expect(tracker.format()).toBe("Running tool");
    });
  });

  describe("compacting phase", () => {
    it("formats compacting status", () => {
      const clock = createClock();
      const tracker = createProgressTracker({ now: clock.now });
      tracker.setPhase("compacting");
      clock.advance(3000);
      expect(tracker.format()).toBe("Compacting context...");
    });

    it("shows elapsed time after 5s", () => {
      const clock = createClock();
      const tracker = createProgressTracker({ now: clock.now });
      tracker.setPhase("compacting");
      clock.advance(7000);
      expect(tracker.format()).toBe("Compacting context... (7s)");
    });
  });

  describe("phase transitions", () => {
    it("resets timer on phase change", () => {
      const clock = createClock();
      const tracker = createProgressTracker({ now: clock.now });
      tracker.setPhase("thinking");
      clock.advance(10_000);
      expect(tracker.format()).toBe("Thinking... (10s)");

      tracker.setPhase("tool", "bash");
      expect(tracker.format()).toBe("Running code");
    });

    it("resets timer on tool name change", () => {
      const clock = createClock();
      const tracker = createProgressTracker({ now: clock.now });
      tracker.setPhase("tool", "bash");
      clock.advance(8000);
      expect(tracker.format()).toBe("Running code (8s)");

      tracker.setPhase("tool", "web_search");
      expect(tracker.format()).toBe("Searching the web");
    });

    it("does not reset timer for same phase and tool", () => {
      const clock = createClock();
      const tracker = createProgressTracker({ now: clock.now });
      tracker.setPhase("thinking");
      clock.advance(6000);
      tracker.setPhase("thinking");
      expect(tracker.format()).toBe("Thinking... (6s)");
    });
  });

  describe("default phase", () => {
    it("starts in thinking phase", () => {
      const clock = createClock();
      const tracker = createProgressTracker({ now: clock.now });
      expect(tracker.format()).toBe("Thinking...");
    });
  });
});
