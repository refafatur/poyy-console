"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { PairingScreen, type PairingConnection } from "@/features/pairing/PairingScreen";
import { Dashboard } from "@/features/dashboard/Dashboard";
import { RacingGame, type GameMode } from "@/games/poyy-racing/RacingGame";

type View = "loading" | "pairing" | "dashboard" | "racing";

export function ConsoleApp() {
  const [view, setView] = useState<View>("loading");
  const [connection, setConnection] = useState<PairingConnection>();
  const [raceMode, setRaceMode] = useState<GameMode>("RACE");

  useEffect(() => {
    const saved = sessionStorage.getItem("poyy-pairing");
    if (!saved) {
      setView("pairing");
      return;
    }
    try {
      const credentials = JSON.parse(saved) as { sessionId: string; ownerToken: string };
      if (!credentials.sessionId || !credentials.ownerToken) throw new Error("Invalid saved session");
      let retained = false;
      const socket = io(window.location.origin, { transports: ["websocket", "polling"] });
      socket.on("connect", () => {
        socket.emit(
          "pair:owner",
          credentials,
          (result: { ok: boolean; connected?: boolean; device?: PairingConnection["device"] }) => {
            if (result.ok) {
              retained = true;
              setConnection({ ...credentials, socket, device: result.device });
              setView("dashboard");
            } else {
              sessionStorage.removeItem("poyy-pairing");
              socket.disconnect();
              setView("pairing");
            }
          },
        );
      });
      socket.on("connect_error", () => setView("pairing"));
      return () => {
        if (!retained) socket.disconnect();
      };
    } catch {
      sessionStorage.removeItem("poyy-pairing");
      setView("pairing");
    }
  }, []);

  useEffect(() => {
    if (!connection) return;
    const updateController = (status: { connected: boolean; device?: PairingConnection["device"] }) => {
      setConnection((current) =>
        current ? { ...current, device: status.connected ? status.device : undefined } : current,
      );
    };
    connection.socket.on("pairing:status", updateController);
    return () => {
      connection.socket.off("pairing:status", updateController);
    };
  }, [connection]);

  const exitPairing = () => {
    connection?.socket.disconnect();
    sessionStorage.removeItem("poyy-pairing");
    setConnection(undefined);
    setView("pairing");
  };

  if (view === "loading") {
    return (
      <main className="boot-screen">
        <div className="boot-mark">P</div>
        <p>Initializing POYY Console</p>
      </main>
    );
  }
  if (view === "pairing") {
    return (
      <PairingScreen
        onConnected={(nextConnection) => {
          setConnection(nextConnection);
          setView("dashboard");
        }}
      />
    );
  }
  if (!connection) return null;
  if (view === "racing") {
    return <RacingGame socket={connection.socket} initialMode={raceMode} onExit={() => setView("dashboard")} />;
  }
  return (
    <Dashboard
      connection={connection}
      onPlay={(mode = "RACE") => {
        setRaceMode(mode);
        setView("racing");
      }}
      onDisconnect={exitPairing}
    />
  );
}
