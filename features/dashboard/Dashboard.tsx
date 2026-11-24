"use client";

import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import {
  ArrowRight,
  Compass,
  Gamepad2,
  Gauge,
  History,
  Home,
  LogOut,
  Play,
  SlidersHorizontal,
  Smartphone,
  Trophy,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { PairingConnection } from "@/features/pairing/PairingScreen";
import type { GameMode } from "@/games/poyy-racing/RacingGame";
import heroCircuitNight from "@/src/assets/images/hero_circuit_night_1795516325691.jpg";
import circuitCanyonBend from "@/src/assets/images/circuit_canyon_bend_1795516325526.jpg";

type DashboardProps = {
  connection: PairingConnection;
  onPlay: (mode?: GameMode) => void;
  onDisconnect: () => void;
};

type NavSection = "Home" | "Modes" | "Hardware" | "Settings";

const events: Array<{
  title: string;
  mode: GameMode;
  meta: string;
  description: string;
  image: string;
}> = [
  {
    title: "Grand Prix Circuit",
    mode: "RACE",
    meta: "3 Laps · 4 Racers · Winding Loop",
    description: "Battle three AI rivals across sweeping S-curves, elevation hills, and downtown towers.",
    image: heroCircuitNight.src,
  },
  {
    title: "Canyon Time Attack",
    mode: "TIME TRIAL",
    meta: "3 Laps · Solo · Best Lap Clock",
    description: "Chase your fastest sector lines without traffic on the full architectural circuit.",
    image: circuitCanyonBend.src,
  },
  {
    title: "Open Circuit Cruise",
    mode: "FREE DRIVE",
    meta: "Endless · Traffic · Tilt & Auto-Gas",
    description: "Test phone tilt steering, auto-throttle, and drift lines at your own pace.",
    image: "/assets/racing.jpg",
  },
];

function playUiBeep(muted: boolean, freq = 520) {
  if (muted) return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.07);
    window.setTimeout(() => void ctx.close(), 120);
  } catch {
    // ignore audio unlock errors
  }
}

export function Dashboard({ connection, onPlay, onDisconnect }: DashboardProps) {
  const [section, setSection] = useState<NavSection>("Home");
  const [muted, setMuted] = useState(false);
  const root = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (!root.current) return;
    const animation = gsap.context(() => {
      gsap.fromTo(
        "[data-dashboard-reveal]",
        { autoAlpha: 0, y: 12 },
        { autoAlpha: 1, y: 0, duration: 0.38, stagger: 0.06, ease: "power3.out" },
      );
    }, root);
    return () => animation.revert();
  }, [section]);

  const switchSection = (next: NavSection) => {
    playUiBeep(muted, 440);
    setSection(next);
  };

  const launchMode = (mode: GameMode) => {
    playUiBeep(muted, 660);
    onPlay(mode);
  };

  return (
    <main className="console-shell" ref={root}>
      <aside className="console-rail" data-dashboard-reveal>
        <div className="console-logo" aria-label="POYY Console">
          <span>P</span>
        </div>

        <nav aria-label="Console sections">
          {(
            [
              { id: "Home", icon: Home },
              { id: "Modes", icon: Gamepad2 },
              { id: "Hardware", icon: History },
              { id: "Settings", icon: SlidersHorizontal },
            ] as const
          ).map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={section === id ? "active" : ""}
              onClick={() => switchSection(id)}
              aria-label={id}
            >
              <Icon size={19} />
              <span>{id}</span>
            </button>
          ))}
        </nav>

        <button type="button" className="rail-logout" onClick={onDisconnect} aria-label="Disconnect session">
          <LogOut size={18} />
          <span>Exit</span>
        </button>
      </aside>

      <section className="console-content">
        <header className="console-header" data-dashboard-reveal>
          <div className="console-brand-line">
            <span className="console-title-mark">POYY Console</span>
            <span className="header-sep" aria-hidden="true">
              /
            </span>
            <span className="header-crumb">{section}</span>
          </div>

          <div className="header-controls">
            <button
              type="button"
              className="audio-toggle"
              onClick={() => {
                setMuted(!muted);
                playUiBeep(muted, 480);
              }}
            >
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              <span>{muted ? "Muted" : "Audio On"}</span>
            </button>
            <button type="button" className="header-cta" onClick={() => launchMode("RACE")}>
              <Play size={14} />
              <span>Start Race</span>
            </button>
          </div>
        </header>

        {section === "Settings" ? (
          <Settings muted={muted} setMuted={setMuted} connection={connection} onDisconnect={onDisconnect} />
        ) : section === "Hardware" ? (
          <HardwareView connection={connection} onDisconnect={onDisconnect} />
        ) : (
          <>
            <section className="featured-game" data-dashboard-reveal>
              <img
                src={heroCircuitNight.src}
                alt="POYY Racing Night Circuit"
                referrerPolicy="no-referrer"
              />
              <div className="featured-scrim" />
              <div className="featured-content">
                <p className="featured-kicker">Featured Circuit · 3 Laps · 4 Racers</p>
                <h1>POYY Racing</h1>
                <p className="featured-desc">
                  Sweeping elevated curves, architectural skyline towers, three aggressive AI rivals, and wireless tilt-steer support.
                </p>
                <div className="featured-actions">
                  <button type="button" className="primary-button" onClick={() => launchMode("RACE")}>
                    <span>Race Grid (4 Cars)</span>
                    <ArrowRight size={17} />
                  </button>
                  <button type="button" className="secondary-button" onClick={() => launchMode("TIME TRIAL")}>
                    Time Trial
                  </button>
                </div>
              </div>

              <div className="featured-specs">
                <div>
                  <small>CIRCUIT</small>
                  <strong className="tabular-nums">1.4 KM</strong>
                </div>
                <div>
                  <small>RIVALS</small>
                  <strong className="tabular-nums">3 AI</strong>
                </div>
                <div>
                  <small>INPUT</small>
                  <strong>Tilt + Keys</strong>
                </div>
              </div>
            </section>

            <section className="dashboard-grid">
              <div className="game-library-block" data-dashboard-reveal>
                <div className="section-heading">
                  <div>
                    <h2>Select Event</h2>
                    <p>Choose a race format on the winding city-canyon loop.</p>
                  </div>
                </div>

                <div className="game-cards">
                  {events.map((item) => (
                    <article className="game-card" key={item.mode}>
                      <div className="game-card-art">
                        <img src={item.image} alt={item.title} referrerPolicy="no-referrer" />
                      </div>
                      <div className="game-card-body">
                        <p className="card-meta">{item.meta}</p>
                        <h3>{item.title}</h3>
                        <p className="card-desc">{item.description}</p>
                        <button type="button" className="card-launch-btn" onClick={() => launchMode(item.mode)}>
                          <span>Launch {item.mode.toLowerCase()}</span>
                          <ArrowRight size={14} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <aside className="status-stack" data-dashboard-reveal>
                <section className="status-panel">
                  <div className="panel-head">
                    <Smartphone size={16} />
                    <span>POYY LINK Controller</span>
                  </div>
                  <div className="panel-device">
                    <strong>{connection.device?.name ?? "Keyboard Active"}</strong>
                    <p>
                      {connection.device
                        ? `${connection.device.platform} · Paired and ready`
                        : "Pair a phone anytime for tilt steering and auto-gas."}
                    </p>
                  </div>
                  {!connection.device && (
                    <button type="button" className="panel-action-btn" onClick={onDisconnect}>
                      Pair a phone
                    </button>
                  )}
                </section>

                <section className="status-panel">
                  <div className="panel-head">
                    <Compass size={16} />
                    <span>Controller Capabilities</span>
                  </div>
                  <ul className="capability-list">
                    <li>
                      <Compass size={14} />
                      <span>Tilt Steer (Device Gyroscope)</span>
                    </li>
                    <li>
                      <Gauge size={14} />
                      <span>Auto-Gas Cruise Toggle</span>
                    </li>
                    <li>
                      <Trophy size={14} />
                      <span>3 AI Rivals &amp; Live Minimap</span>
                    </li>
                  </ul>
                </section>
              </aside>
            </section>
          </>
        )}
      </section>
    </main>
  );
}

function HardwareView({
  connection,
  onDisconnect,
}: {
  connection: PairingConnection;
  onDisconnect: () => void;
}) {
  return (
    <section className="settings-panel" data-dashboard-reveal>
      <div>
        <p className="card-meta">Controller &amp; Input Diagnostics</p>
        <h2>Connected Hardware</h2>
      </div>
      <div className="settings-row">
        <div>
          <strong>Primary Controller</strong>
          <small>
            {connection.device
              ? `${connection.device.name} (${connection.device.platform})`
              : "No mobile device paired — using local keyboard"}
          </small>
        </div>
        <span className="status-text">{connection.device ? "Linked" : "Standby"}</span>
      </div>
      <div className="settings-row">
        <div>
          <strong>Keyboard Mapping</strong>
          <small>W / ↑ Throttle · S / ↓ Brake · A / D Steer · Shift Nitro · Space Drift · Esc Pause</small>
        </div>
      </div>
      <div className="settings-row">
        <div>
          <strong>Pair Another Phone</strong>
          <small>Return to the QR pairing screen to generate a fresh link</small>
        </div>
        <button type="button" className="danger-button" onClick={onDisconnect}>
          Re-pair Device
        </button>
      </div>
    </section>
  );
}

function Settings({
  muted,
  setMuted,
  connection,
  onDisconnect,
}: {
  muted: boolean;
  setMuted: (value: boolean) => void;
  connection: PairingConnection;
  onDisconnect: () => void;
}) {
  return (
    <section className="settings-panel" data-dashboard-reveal>
      <div>
        <p className="card-meta">Console Preferences</p>
        <h2>Audio &amp; Session</h2>
      </div>
      <div className="settings-row">
        <div>
          <strong>Menu &amp; Console Audio</strong>
          <small>Tactile feedback clicks when navigating events</small>
        </div>
        <button
          type="button"
          className={`settings-toggle ${muted ? "off" : ""}`}
          aria-pressed={!muted}
          onClick={() => setMuted(!muted)}
        >
          <i />
        </button>
      </div>
      <div className="settings-row">
        <div>
          <strong>POYY LINK Session</strong>
          <small>{connection.device ? `${connection.device.name} is linked` : "Keyboard mode active"}</small>
        </div>
        <span className="status-text">{connection.device ? "Connected" : "Local"}</span>
      </div>
      <div className="settings-row">
        <div>
          <strong>End Session</strong>
          <small>Disconnect current pairing and return to the QR screen</small>
        </div>
        <button type="button" className="danger-button" onClick={onDisconnect}>
          Disconnect
        </button>
      </div>
    </section>
  );
}
