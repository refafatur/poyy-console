import { describe, expect, it } from "vitest";
import { PairingStore } from "@/server/pairing-store";

describe("PairingStore", () => {
  it("validates separate owner and controller credentials", () => {
    const store = new PairingStore();
    const session = store.create();
    expect(store.verifyOwner(session.id, session.ownerToken)).toBe(true);
    expect(store.verifyController(session.id, session.publicToken)).toBe(true);
    expect(store.verifyOwner(session.id, session.publicToken)).toBe(false);
  });

  it("expires temporary sessions", () => {
    let now = 100;
    const store = new PairingStore(() => now);
    const session = store.create(20);
    now = 121;
    expect(store.get(session.id)).toBeUndefined();
  });
});
