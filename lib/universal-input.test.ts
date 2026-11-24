import { describe, expect, it } from "vitest";
import { InputState } from "@/lib/universal-input";

describe("InputState", () => {
  it("releases every active input when connection focus is lost", () => {
    const inputs = new InputState();
    inputs.set("ACCELERATE", true);
    inputs.set("STEER_LEFT", true);
    inputs.setAxis("STEER", 0.65);
    inputs.releaseAll();
    expect(inputs.pressed("ACCELERATE")).toBe(false);
    expect(inputs.pressed("STEER_LEFT")).toBe(false);
    expect(inputs.axis("STEER")).toBe(0);
  });

  it("clamps analog steering axis values between -1 and 1", () => {
    const inputs = new InputState();
    inputs.setAxis("STEER", 2.4);
    expect(inputs.axis("STEER")).toBe(1);
    inputs.setAxis("STEER", -1.8);
    expect(inputs.axis("STEER")).toBe(-1);
  });
});
