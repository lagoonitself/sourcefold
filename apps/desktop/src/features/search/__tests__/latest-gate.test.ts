import { describe, expect, it } from "vitest";
import { createLatestGate } from "../latest-gate";

describe("createLatestGate", () => {
  it("lets only the newest request through", () => {
    const gate = createLatestGate();
    const first = gate.next();
    const second = gate.next();
    expect(gate.isLatest(first)).toBe(false);
    expect(gate.isLatest(second)).toBe(true);
  });

  it("makes everything stale on cancel", () => {
    const gate = createLatestGate();
    const seq = gate.next();
    gate.cancel();
    expect(gate.isLatest(seq)).toBe(false);
  });

  it("accepts a request started after a cancel", () => {
    const gate = createLatestGate();
    gate.cancel();
    expect(gate.isLatest(gate.next())).toBe(true);
  });

  it("keeps gates independent", () => {
    const a = createLatestGate();
    const b = createLatestGate();
    const seq = a.next();
    b.next();
    b.next();
    expect(a.isLatest(seq)).toBe(true);
  });
});
