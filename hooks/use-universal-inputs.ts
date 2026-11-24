"use client";

import { useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";
import { InputState, isInputAction, isInputAxis, keyboardInputMap } from "@/lib/universal-input";

export function useUniversalInputs(socket?: Socket) {
  const inputs = useRef(new InputState());

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = keyboardInputMap[event.code];
      if (!action) return;
      event.preventDefault();
      inputs.current.set(action, true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const action = keyboardInputMap[event.code];
      if (action) inputs.current.set(action, false);
    };
    const releaseAll = () => inputs.current.releaseAll();
    const onControllerInput = (payload: { action?: unknown; pressed?: unknown }) => {
      if (isInputAction(payload.action) && typeof payload.pressed === "boolean") {
        inputs.current.set(payload.action, payload.pressed);
      }
    };
    const onControllerAxis = (payload: { axis?: unknown; value?: unknown }) => {
      if (isInputAxis(payload.axis) && typeof payload.value === "number") {
        inputs.current.setAxis(payload.axis, payload.value);
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) releaseAll();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", onVisibilityChange);
    socket?.on("input:event", onControllerInput);
    socket?.on("input:axis", onControllerAxis);
    socket?.on("input:release-all", releaseAll);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseAll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      socket?.off("input:event", onControllerInput);
      socket?.off("input:axis", onControllerAxis);
      socket?.off("input:release-all", releaseAll);
      releaseAll();
    };
  }, [socket]);

  return inputs;
}
