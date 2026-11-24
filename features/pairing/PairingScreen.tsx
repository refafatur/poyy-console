"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toDataURL } from "qrcode";
import { io, type Socket } from "socket.io-client";
import gsap from "gsap";
import { ArrowRight, Check, Copy, ExternalLink, Keyboard, RefreshCw, Smartphone, Wifi } from "lucide-react";
import heroCircuitNight from "@/src/assets/images/hero_circuit_night_1795516325691.jpg";

export type PairingConnection = {
  sessionId: string;
  ownerToken: string;
  socket: Socket;
  device?: { name: string; platform: string };
};

type PairingResponse = {
  sessionId: string;
  ownerToken: string;
  controllerUrl: string;
  expiresAt: number;
};

export function PairingScreen({ onConnected }: { onConnected: (connection: PairingConnection) => void }) {
  const [pairing, setPairing] = useState<PairingResponse>();
  const [qrCode, setQrCode] = useState("");
  const [status, setStatus] = useState("Generating pairing link");
  const [device, setDevice] = useState<PairingConnection["device"]>();
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const socketRef = useRef<Socket | undefined>(undefined);
  const releasedSocket = useRef(false);
  const shellRef = useRef<HTMLDivElement>(null);

  const endSession = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = undefined;
  }, []);

  const createPairing = useCallback(async () => {
    endSession();
    releasedSocket.current = false;
    setError("");
    setDevice(undefined);
    setQrCode("");
    setStatus("Generating pairing link");
    try {
      const response = await fetch("/api/pairing", { method: "POST", cache: "no-store" });
      const body = (await response.json()) as PairingResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not create a pairing session.");
      const image = await toDataURL(body.controllerUrl, {
        margin: 1,
        width: 440,
        color: { dark: "#0a0b0e", light: "#ffffff" },
      });
      setPairing(body);
      setQrCode(image);
      setStatus("Ready for POYY LINK device");

      const socket = io(window.location.origin, { transports: ["websocket", "polling"] });
      socketRef.current = socket;
      socket.on("connect", () => {
        socket.emit(
          "pair:owner",
          { sessionId: body.sessionId, ownerToken: body.ownerToken },
          (result: { ok: boolean; reason?: string; connected?: boolean; device?: PairingConnection["device"] }) => {
            if (!result.ok) setError(result.reason ?? "Pairing session was rejected.");
            if (result.connected) {
              setDevice(result.device);
              setStatus("Controller connected");
            }
          },
        );
      });
      socket.on("pairing:status", (next: { connected: boolean; device?: PairingConnection["device"] }) => {
        setDevice(next.device);
        setStatus(next.connected ? "Controller connected" : "Ready for POYY LINK device");
      });
      socket.on("connect_error", () => setError("Realtime connection unavailable. Check the server and retry."));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a pairing session.");
      setStatus("Pairing unavailable");
    }
  }, [endSession]);

  useEffect(() => {
    void createPairing();
    return () => {
      if (!releasedSocket.current) endSession();
    };
  }, [createPairing, endSession]);

  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((pairing.expiresAt - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining === 0) {
        endSession();
        setStatus("Pairing code expired");
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [endSession, pairing]);

  useEffect(() => {
    if (!shellRef.current) return;
    const context = gsap.context(() => {
      gsap.fromTo(
        "[data-pairing-reveal]",
        { autoAlpha: 0, y: 16 },
        { autoAlpha: 1, y: 0, duration: 0.45, stagger: 0.08, ease: "power3.out" },
      );
    }, shellRef);
    return () => context.revert();
  }, [qrCode]);

  function continueToConsole(allowKeyboardOnly = false) {
    if (!pairing || !socketRef.current) return;
    if (!allowKeyboardOnly && !device) return;
    const connection: PairingConnection = {
      sessionId: pairing.sessionId,
      ownerToken: pairing.ownerToken,
      socket: socketRef.current,
      device,
    };
    sessionStorage.setItem(
      "poyy-pairing",
      JSON.stringify({ sessionId: connection.sessionId, ownerToken: connection.ownerToken }),
    );
    socketRef.current.off("pairing:status");
    socketRef.current.off("connect_error");
    releasedSocket.current = true;
    onConnected(connection);
  }

  function copyLink() {
    if (!pairing?.controllerUrl) return;
    void navigator.clipboard?.writeText(pairing.controllerUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const canContinue = Boolean(device && pairing && socketRef.current?.connected);
  const canStartKeyboard = Boolean(pairing && socketRef.current?.connected);

  return (
    <main className="pairing-shell" ref={shellRef}>
      <section className="pairing-brand" data-pairing-reveal>
        <img
          src={heroCircuitNight.src}
          alt="Prototype race cars cornering on an elevated night circuit"
          className="pairing-hero-photo"
          referrerPolicy="no-referrer"
        />
        <div className="pairing-hero-scrim" />
        <div className="pairing-brand-inner">
          <div className="brand-wordmark">
            <span className="brand-square">P</span>
            <span>POYY CONSOLE</span>
          </div>

          <div className="pairing-hero-copy">
            <p className="editorial-kicker">Wireless Console · Tilt &amp; Auto-Throttle</p>
            <h1>Your phone is the wheel.</h1>
            <p className="brand-copy">
              Scan once to turn any smartphone into a tilt-steering controller with auto-gas, nitro, and live telemetry.
            </p>
          </div>

          <div className="pairing-spec-strip">
            <span>Winding 3D Circuit</span>
            <span aria-hidden="true">·</span>
            <span>4-Car Grid</span>
            <span aria-hidden="true">·</span>
            <span>Low-Latency Socket</span>
          </div>
        </div>
      </section>

      <section className="pairing-card" data-pairing-reveal>
        <div className="pairing-card-topline">
          <Wifi size={14} />
          <span>Device Pairing</span>
        </div>

        <h2>Connect your phone.</h2>
        <p className="pairing-intro">
          Scan with your phone camera to open POYY LINK, or open the controller directly in a second browser tab.
        </p>

        <div className="qr-stage">
          <div className="qr-frame">
            {qrCode ? <img src={qrCode} alt="QR code for POYY LINK controller" /> : <div className="qr-loading" />}
          </div>
          {pairing && (
            <div className="pairing-link-tools">
              <button type="button" className="link-tool-btn" onClick={copyLink}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? "Copied link" : "Copy link"}</span>
              </button>
              <a
                href={pairing.controllerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="link-tool-btn"
              >
                <ExternalLink size={14} />
                <span>Open controller</span>
              </a>
            </div>
          )}
        </div>

        <div className={`pairing-status ${device ? "connected" : ""}`}>
          <Smartphone size={15} />
          <span>{status}</span>
        </div>

        {device && (
          <div className="device-row">
            <strong>{device.name}</strong>
            <span>{device.platform} · Ready</span>
          </div>
        )}

        {error && <p className="pairing-error">{error}</p>}

        <div className="pairing-actions">
          <button
            type="button"
            className="primary-button"
            disabled={!canContinue}
            onClick={() => continueToConsole(false)}
          >
            <span>Enter Console</span>
            <ArrowRight size={17} />
          </button>

          <button
            type="button"
            className="secondary-light-button"
            disabled={!canStartKeyboard}
            onClick={() => continueToConsole(true)}
          >
            <Keyboard size={15} />
            <span>Use Keyboard</span>
          </button>
        </div>

        <div className="pairing-footer-meta">
          <button type="button" className="text-button" onClick={() => void createPairing()}>
            <RefreshCw size={13} />
            <span>Regenerate code</span>
          </button>
          <span className="tabular-nums">
            {secondsRemaining
              ? `Expires in ${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")}`
              : "Session expired"}
          </span>
        </div>
      </section>
    </main>
  );
}
