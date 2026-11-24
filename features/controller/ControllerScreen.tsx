"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Compass,
  Gauge,
  Maximize2,
  Power,
  RotateCw,
  Smartphone,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import type { InputAction } from "@/lib/universal-input";
import { ControllerAudio } from "@/features/controller/controllerAudio";

type ConnectionState = "connecting" | "connected" | "error" | "invalid";

function ControllerButton({
  children,
  action,
  accent,
  active,
  onInput,
}: {
  children: React.ReactNode;
  action: InputAction;
  accent?: string;
  active?: boolean;
  onInput: (action: InputAction, pressed: boolean) => void;
}) {
  const release = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    onInput(action, false);
  };
  return (
    <button
      type="button"
      className={`controller-button ${accent ?? ""} ${active ? "is-active" : ""}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onInput(action, true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) release(event);
      }}
    >
      {children}
    </button>
  );
}

function getOrientationTiltAngle(event: DeviceOrientationEvent): number | null {
  const screenAngle =
    typeof window !== "undefined"
      ? window.screen?.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0
      : 0;
  const normalized = ((screenAngle % 360) + 360) % 360;

  if (normalized === 90 && typeof event.beta === "number") {
    return event.beta;
  }
  if (normalized === 270 && typeof event.beta === "number") {
    return -event.beta;
  }
  if (normalized === 180 && typeof event.gamma === "number") {
    return -event.gamma;
  }
  if (typeof event.gamma === "number") {
    return event.gamma;
  }
  return null;
}

export function ControllerScreen() {
  const [state, setState] = useState<ConnectionState>("connecting");
  const [message, setMessage] = useState("Opening your controller");
  const [autoGas, setAutoGas] = useState(false);
  const [braking, setBraking] = useState(false);
  const [tiltEnabled, setTiltEnabled] = useState(false);
  const [tiltValue, setTiltValue] = useState(0);
  const [tiltStatus, setTiltStatus] = useState("");
  const [muted, setMuted] = useState(false);

  const socketRef = useRef<Socket | undefined>(undefined);
  const activeInputs = useRef(new Set<InputAction>());
  const connectionState = useRef<ConnectionState>("connecting");
  const audioRef = useRef<ControllerAudio | null>(null);
  const zeroAngleRef = useRef<number | null>(null);
  const lastRawAngleRef = useRef<number | null>(null);
  const lastEmitAtRef = useRef(0);
  const lastEmittedTiltRef = useRef(0);
  const autoGasRef = useRef(false);

  connectionState.current = state;
  autoGasRef.current = autoGas;

  useEffect(() => {
    const audio = new ControllerAudio();
    audioRef.current = audio;
    return () => {
      audio.dispose();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    audioRef.current?.setMuted(muted);
  }, [muted]);

  const emitSteerAxis = useCallback((value: number) => {
    const clamped = Math.max(-1, Math.min(1, value));
    setTiltValue(clamped);
    socketRef.current?.emit("controller:axis", { axis: "STEER", value: clamped });
  }, []);

  const releaseAll = useCallback(() => {
    for (const action of activeInputs.current) {
      socketRef.current?.emit("controller:input", { action, pressed: false });
    }
    activeInputs.current.clear();
    emitSteerAxis(0);
    setAutoGas(false);
    setBraking(false);
  }, [emitSteerAxis]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const sessionId = query.get("session");
    const token = query.get("token");
    if (!sessionId || !token) {
      setState("invalid");
      setMessage("This POYY LINK address is incomplete.");
      return;
    }

    const socket = io(window.location.origin, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit(
        "pair:controller",
        {
          sessionId,
          token,
          device: {
            name: navigator.userAgent.includes("iPhone")
              ? "iPhone"
              : navigator.userAgent.includes("Android")
                ? "Android Phone"
                : "POYY LINK Device",
            platform: navigator.platform || "mobile",
          },
        },
        (response: { ok: boolean; reason?: string }) => {
          if (response.ok) {
            setState("connected");
            setMessage("Connected to POYY Console");
            navigator.vibrate?.(35);
            audioRef.current?.playConnected();
          } else {
            setState("invalid");
            setMessage(response.reason ?? "This pairing link has expired.");
          }
        },
      );
    });

    socket.on("disconnect", () => {
      releaseAll();
      if (connectionState.current === "connected") {
        setState("connecting");
        setMessage("Reconnecting controller");
      }
    });

    socket.on("connect_error", () => {
      setState("error");
      setMessage("Unable to reach the console. Check network connection.");
    });

    const handleBlur = () => releaseAll();
    const handleVisibility = () => {
      if (document.hidden) releaseAll();
    };
    window.addEventListener("blur", handleBlur);
    window.addEventListener("pagehide", handleBlur);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      releaseAll();
      socket.disconnect();
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("pagehide", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [releaseAll]);

  // DeviceOrientation listener for tilt steering
  useEffect(() => {
    if (!tiltEnabled || state !== "connected") {
      emitSteerAxis(0);
      return;
    }

    let receivedSensor = false;
    const noSensorTimer = window.setTimeout(() => {
      if (!receivedSensor) {
        setTiltStatus("No tilt sensor data detected — tap buttons or open on a phone");
      }
    }, 1200);

    const handleOrientation = (event: DeviceOrientationEvent) => {
      const raw = getOrientationTiltAngle(event);
      if (raw === null) return;
      receivedSensor = true;
      setTiltStatus("");
      lastRawAngleRef.current = raw;

      if (zeroAngleRef.current === null) {
        zeroAngleRef.current = raw;
      }

      const delta = raw - zeroAngleRef.current;
      const deadzone = 3.5;
      const maxRange = 28;
      let steer = 0;
      if (Math.abs(delta) > deadzone) {
        const effective = (Math.abs(delta) - deadzone) / (maxRange - deadzone);
        steer = Math.sign(delta) * Math.min(1, effective);
      }

      const now = performance.now();
      if (now - lastEmitAtRef.current >= 28 || (steer === 0 && lastEmittedTiltRef.current !== 0)) {
        lastEmitAtRef.current = now;
        lastEmittedTiltRef.current = steer;
        emitSteerAxis(steer);
      }
    };

    window.addEventListener("deviceorientation", handleOrientation);
    return () => {
      window.clearTimeout(noSensorTimer);
      window.removeEventListener("deviceorientation", handleOrientation);
      emitSteerAxis(0);
    };
  }, [emitSteerAxis, state, tiltEnabled]);

  const sendInput = useCallback(
    (action: InputAction, pressed: boolean) => {
      if (connectionState.current !== "connected") return;

      if (action === "BRAKE") {
        setBraking(pressed);
        // Pause auto-gas while actively braking, resume upon release
        if (autoGasRef.current) {
          socketRef.current?.emit("controller:input", { action: "ACCELERATE", pressed: !pressed });
          if (pressed) activeInputs.current.delete("ACCELERATE");
          else activeInputs.current.add("ACCELERATE");
        }
      }

      if (pressed) {
        activeInputs.current.add(action);
        navigator.vibrate?.(12);
        if (action === "NITRO") audioRef.current?.playNitro();
        else if (action === "ACCELERATE") audioRef.current?.playClick(520, 0.05);
        else if (action === "BRAKE") audioRef.current?.playClick(260, 0.06);
        else audioRef.current?.playClick(380, 0.04);
      } else {
        // Keep ACCELERATE alive on GO release if autoGas is engaged
        if (action === "ACCELERATE" && autoGasRef.current) return;
        activeInputs.current.delete(action);
      }

      socketRef.current?.emit("controller:input", { action, pressed });
    },
    [],
  );

  const toggleAutoGas = () => {
    if (state !== "connected") return;
    const next = !autoGas;
    setAutoGas(next);
    audioRef.current?.playToggle(next);
    navigator.vibrate?.(next ? [16, 30, 16] : 14);
    if (next) {
      if (!braking) {
        activeInputs.current.add("ACCELERATE");
        socketRef.current?.emit("controller:input", { action: "ACCELERATE", pressed: true });
      }
    } else {
      activeInputs.current.delete("ACCELERATE");
      socketRef.current?.emit("controller:input", { action: "ACCELERATE", pressed: false });
    }
  };

  const toggleTiltSteer = async () => {
    if (state !== "connected") return;
    if (tiltEnabled) {
      setTiltEnabled(false);
      setTiltStatus("");
      zeroAngleRef.current = null;
      audioRef.current?.playToggle(false);
      return;
    }

    // Request iOS 13+ DeviceOrientation permission inside user gesture
    const DeviceOrient = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (typeof DeviceOrient?.requestPermission === "function") {
      try {
        const result = await DeviceOrient.requestPermission();
        if (result !== "granted") {
          setTiltStatus("Motion sensor permission was denied.");
          return;
        }
      } catch {
        setTiltStatus("Unable to request motion sensor permission.");
        return;
      }
    }

    zeroAngleRef.current = null;
    setTiltEnabled(true);
    audioRef.current?.playToggle(true);
    navigator.vibrate?.(20);
  };

  const recenterTilt = () => {
    if (lastRawAngleRef.current !== null) {
      zeroAngleRef.current = lastRawAngleRef.current;
      emitSteerAxis(0);
      audioRef.current?.playClick(640, 0.06);
      navigator.vibrate?.(15);
    }
  };

  return (
    <main className="controller-shell">
      <header className="controller-header">
        <div className="controller-wordmark">
          POYY <span>LINK</span>
        </div>

        <div className="controller-header-actions">
          <button
            type="button"
            className="controller-icon-btn"
            onClick={() => setMuted((prev) => !prev)}
            aria-label={muted ? "Unmute controller sounds" : "Mute controller sounds"}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <div className={`controller-connection ${state}`}>
            <Smartphone size={14} />
            <span>{state === "connected" ? "Connected" : state === "connecting" ? "Connecting" : "Offline"}</span>
          </div>
        </div>
      </header>

      {state === "invalid" || state === "error" ? (
        <section className="controller-message">
          <div className="controller-message-mark">
            <AlertCircle size={26} />
          </div>
          <h1>{state === "invalid" ? "Link unavailable" : "Connection interrupted"}</h1>
          <p>{message}</p>
        </section>
      ) : (
        <>
          <div className="controller-assist-bar">
            <button
              type="button"
              className={`assist-toggle ${tiltEnabled ? "active" : ""}`}
              onClick={() => void toggleTiltSteer()}
            >
              <Compass size={16} />
              <span>Tilt Steer {tiltEnabled ? "On" : "Off"}</span>
            </button>

            {tiltEnabled && (
              <button type="button" className="assist-toggle secondary" onClick={recenterTilt}>
                <RotateCw size={15} />
                <span>Recenter</span>
              </button>
            )}

            <button
              type="button"
              className={`assist-toggle ${autoGas ? "active-amber" : ""}`}
              onClick={toggleAutoGas}
            >
              <Gauge size={16} />
              <span>Auto-Gas {autoGas ? "On" : "Off"}</span>
            </button>
          </div>

          {tiltStatus && <p className="controller-sensor-note">{tiltStatus}</p>}

          <section className="controller-layout" aria-label="POYY LINK game controller">
            <div className="steering-zone">
              <div className="steering-meta">
                <span>STEER</span>
                <span className="tabular-nums">
                  {tiltEnabled ? `${Math.round(tiltValue * 100)}%` : "Touch"}
                </span>
              </div>
              <div className="tilt-meter" aria-hidden="true">
                <div
                  className="tilt-meter-fill"
                  style={{
                    left: tiltValue >= 0 ? "50%" : `${50 + tiltValue * 50}%`,
                    width: `${Math.abs(tiltValue) * 50}%`,
                  }}
                />
              </div>
              <div className="steering-pad">
                <ControllerButton action="STEER_LEFT" onInput={sendInput}>
                  <ChevronLeft size={26} />
                </ControllerButton>
                <div className="steering-core">{tiltEnabled ? "TILT" : "POYY"}</div>
                <ControllerButton action="STEER_RIGHT" onInput={sendInput}>
                  <ChevronRight size={26} />
                </ControllerButton>
              </div>
            </div>

            <div className="controller-center">
              <span>POYY RACING</span>
              <small>{autoGas ? "Auto-Gas engaged" : "Hold GO or enable Auto-Gas"}</small>
            </div>

            <div className="pedal-zone">
              <ControllerButton action="BRAKE" active={braking} onInput={sendInput}>
                <span>BRAKE</span>
              </ControllerButton>
              <ControllerButton action="NITRO" accent="nitro" onInput={sendInput}>
                <Zap size={16} />
                <span>NITRO</span>
              </ControllerButton>
              <ControllerButton action="ACCELERATE" accent="go" active={autoGas && !braking} onInput={sendInput}>
                <span>{autoGas ? "AUTO" : "GO"}</span>
              </ControllerButton>
              <ControllerButton action="HANDBRAKE" accent="drift" onInput={sendInput}>
                <span>DRIFT</span>
              </ControllerButton>
            </div>
          </section>

          <footer className="controller-footer">
            <span>{message}</span>
            <div className="controller-footer-actions">
              <button
                type="button"
                onClick={() => document.documentElement.requestFullscreen?.()}
              >
                <Maximize2 size={14} /> Fullscreen
              </button>
              <button
                type="button"
                onClick={() => {
                  releaseAll();
                  socketRef.current?.disconnect();
                }}
              >
                <Power size={14} /> Disconnect
              </button>
            </div>
          </footer>
        </>
      )}
    </main>
  );
}
