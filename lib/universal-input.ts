export const INPUT_ACTIONS = [
  "STEER_LEFT",
  "STEER_RIGHT",
  "ACCELERATE",
  "BRAKE",
  "NITRO",
  "HANDBRAKE",
  "PAUSE",
  "CONFIRM",
  "BACK",
] as const;

export type InputAction = (typeof INPUT_ACTIONS)[number];
export type InputAxis = "STEER";

export function isInputAction(value: unknown): value is InputAction {
  return typeof value === "string" && (INPUT_ACTIONS as readonly string[]).includes(value);
}

export function isInputAxis(value: unknown): value is InputAxis {
  return value === "STEER";
}

export class InputState {
  private readonly pressedActions = new Set<InputAction>();
  private steerAxis = 0;

  set(action: InputAction, pressed: boolean) {
    if (pressed) this.pressedActions.add(action);
    else this.pressedActions.delete(action);
  }

  pressed(action: InputAction) {
    return this.pressedActions.has(action);
  }

  setAxis(axisName: InputAxis, value: number) {
    if (axisName === "STEER" && Number.isFinite(value)) {
      this.steerAxis = Math.max(-1, Math.min(1, value));
    }
  }

  axis(axisName: InputAxis) {
    return axisName === "STEER" ? this.steerAxis : 0;
  }

  releaseAll() {
    this.pressedActions.clear();
    this.steerAxis = 0;
  }
}

export const keyboardInputMap: Record<string, InputAction> = {
  ArrowLeft: "STEER_LEFT",
  KeyA: "STEER_LEFT",
  ArrowRight: "STEER_RIGHT",
  KeyD: "STEER_RIGHT",
  ArrowUp: "ACCELERATE",
  KeyW: "ACCELERATE",
  ArrowDown: "BRAKE",
  KeyS: "BRAKE",
  ShiftLeft: "NITRO",
  ShiftRight: "NITRO",
  Space: "HANDBRAKE",
  Escape: "PAUSE",
  Enter: "CONFIRM",
};
