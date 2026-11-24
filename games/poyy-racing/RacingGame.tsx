"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Socket } from "socket.io-client";
import { ArrowLeft, Music, Pause, Play, RotateCcw, Trophy, Volume2, VolumeX } from "lucide-react";
import { useUniversalInputs } from "@/hooks/use-universal-inputs";
import { RacingAudioEngine } from "@/games/poyy-racing/audio";
import { CAR_LIVERIES, createRacerCarMesh, type RacerCarRig } from "@/games/poyy-racing/models/carModel";
import { createCitySkyline } from "@/games/poyy-racing/models/cityBuildings";
import { createTrackData, createTrackMeshes, ROAD_HALF_WIDTH, type TrackData } from "@/games/poyy-racing/track";

export type GameMode = "RACE" | "TIME TRIAL" | "FREE DRIVE";

type RacerDot = { id: string; x: number; y: number; color: string; isPlayer: boolean };

type Telemetry = {
  speed: number;
  nitro: number;
  lap: number;
  position: number;
  totalRacers: number;
  time: number;
  bestLap: number | null;
  countdown: number;
  drifting: boolean;
  finished: boolean;
  dots: RacerDot[];
};

type RivalState = {
  id: string;
  name: string;
  color: string;
  distance: number;
  lateral: number;
  targetLateral: number;
  speed: number;
  baseSpeed: number;
  rig: RacerCarRig;
};

const TOTAL_LAPS = 3;

const initialTelemetry: Telemetry = {
  speed: 0,
  nitro: 100,
  lap: 1,
  position: 1,
  totalRacers: 4,
  time: 0,
  bestLap: null,
  countdown: 3,
  drifting: false,
  finished: false,
  dots: [],
};

// Pre-allocated scratch math helpers (zero GC in render loop)
const _pos = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _negTan = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _camLook = new THREE.Vector3();

function detectSoftwareWebGL() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) return true;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

function toMinimapDot(track: TrackData, distance: number): { x: number; y: number } {
  const pts = track.minimapPoints;
  if (pts.length === 0) return { x: 50, y: 50 };
  const wrapped = ((distance % track.lapLength) + track.lapLength) % track.lapLength;
  const idx = Math.floor((wrapped / track.lapLength) * pts.length) % pts.length;
  return pts[idx];
}

export function RacingGame({
  socket,
  initialMode = "RACE",
  onExit,
}: {
  socket: Socket;
  initialMode?: GameMode;
  onExit: () => void;
}) {
  const inputs = useUniversalInputs(socket);
  const [mode, setMode] = useState<GameMode>(initialMode);
  const [raceId, setRaceId] = useState(0);
  const [paused, setPaused] = useState(false);
  const [telemetry, setTelemetry] = useState<Telemetry>(initialTelemetry);
  const [muted, setMuted] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [volume, setVolume] = useState(55);
  const [contextLost, setContextLost] = useState(false);

  const canvasMountRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<RacingAudioEngine | null>(null);
  const pausedRef = useRef(paused);
  const modeRef = useRef(mode);

  pausedRef.current = paused;
  modeRef.current = mode;

  const trackData = useMemo(() => createTrackData(), []);
  const minimapPath = useMemo(() => {
    const pts = trackData.minimapPoints;
    if (!pts.length) return "";
    return `${pts.map((p, idx) => `${idx === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} Z`;
  }, [trackData]);

  // Unlock Web Audio on first user gesture or controller socket event
  useEffect(() => {
    const audio = new RacingAudioEngine();
    audioRef.current = audio;
    const unlock = () => audio.unlock();
    window.addEventListener("keydown", unlock, { once: true });
    window.addEventListener("pointerdown", unlock, { once: true });
    socket.on("input:event", unlock);
    return () => {
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("pointerdown", unlock);
      socket.off("input:event", unlock);
      audio.dispose();
      audioRef.current = null;
    };
  }, [socket]);

  useEffect(() => {
    audioRef.current?.setSettings(muted, volume, musicEnabled);
  }, [muted, volume, musicEnabled]);

  // Mount WebGL scene once per raceId / mode reset
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => setContextLost(false);
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b101b);
    scene.fog = new THREE.FogExp2(0x0b101b, 0.0036);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(60, container.clientWidth / Math.max(container.clientHeight, 1), 0.5, 650);

    // Three-point twilight motorsport lighting rig (single shadow caster)
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x16141a, 1.05);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffcf9e, 2.6);
    keyLight.position.set(45, 75, 30);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 5;
    keyLight.shadow.camera.far = 220;
    const d = 55;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);
    scene.add(keyLight.target);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.85);
    rimLight.position.set(-40, 28, -50);
    scene.add(rimLight);

    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    const trackMeshes = createTrackMeshes(trackData, maxAnisotropy);
    const cityMeshes = createCitySkyline(trackData, maxAnisotropy);
    scene.add(trackMeshes, cityMeshes);

    // Player car
    const playerRig = createRacerCarMesh(CAR_LIVERIES.player);
    scene.add(playerRig.root);

    // Rival AI racers (active in RACE mode, optional cruising in FREE DRIVE)
    const rivals: RivalState[] =
      mode === "TIME TRIAL"
        ? []
        : [
            {
              id: "cobalt",
              name: CAR_LIVERIES.cobalt.name,
              color: "#3b82f6",
              distance: 14,
              lateral: -4.2,
              targetLateral: -4.2,
              speed: 0,
              baseSpeed: mode === "FREE DRIVE" ? 46 : 63.5,
              rig: createRacerCarMesh(CAR_LIVERIES.cobalt),
            },
            {
              id: "amber",
              name: CAR_LIVERIES.amber.name,
              color: "#f59e0b",
              distance: 26,
              lateral: 3.8,
              targetLateral: 3.8,
              speed: 0,
              baseSpeed: mode === "FREE DRIVE" ? 50 : 61.5,
              rig: createRacerCarMesh(CAR_LIVERIES.amber),
            },
            {
              id: "emerald",
              name: CAR_LIVERIES.emerald.name,
              color: "#10b981",
              distance: 38,
              lateral: -1.2,
              targetLateral: -1.2,
              speed: 0,
              baseSpeed: mode === "FREE DRIVE" ? 42 : 59.5,
              rig: createRacerCarMesh(CAR_LIVERIES.emerald),
            },
          ];

    for (const r of rivals) scene.add(r.rig.root);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const playerState = {
      distance: 0,
      lateral: 2.2,
      speed: 0,
      heading: 0,
      nitro: 100,
      drifting: false,
      shake: 0,
    };

    const raceState = {
      time: 0,
      lapStartTime: 0,
      lastLap: 1,
      bestLap: null as number | null,
      countdown: 3.2,
      lastBeep: 4,
      pauseHeld: false,
      publishAt: 0,
      finished: false,
      collisionCooldown: 0,
    };

    const placeCarOnTrack = (
      rig: RacerCarRig,
      distance: number,
      lateral: number,
      yawOffset: number,
      rollTilt: number,
      steerWheelAngle: number,
      speed: number,
      braking: boolean,
      nitro: boolean,
      drifting: boolean,
      delta: number,
    ) => {
      trackData.sampleAt(distance, _pos, _tan, _right, _up);
      _negTan.copy(_tan).negate();
      _basis.makeBasis(_right, _up, _negTan);
      rig.root.position.copy(_pos).addScaledVector(_right, lateral);
      rig.root.quaternion.setFromRotationMatrix(_basis);
      rig.root.rotateY(yawOffset);

      rig.bodyTiltGroup.rotation.z = THREE.MathUtils.damp(rig.bodyTiltGroup.rotation.z, rollTilt, 10, delta);
      rig.frontWheels.forEach((fw) => {
        fw.rotation.y = THREE.MathUtils.damp(fw.rotation.y, steerWheelAngle, 14, delta);
      });
      rig.allWheels.forEach((w) => {
        w.rotation.x -= speed * delta * 2.4;
      });
      rig.brakeMaterial.emissiveIntensity = braking ? 3.2 : 0.9;
      rig.nitroFlames.forEach((f) => {
        f.visible = nitro;
        if (nitro) f.scale.setScalar(0.85 + Math.random() * 0.35);
      });
      rig.driftSmoke.visible = drifting;
    };

    // Initial placement before first frame
    placeCarOnTrack(playerRig, 0, playerState.lateral, 0, 0, 0, 0, false, false, false, 0.016);
    rivals.forEach((r) => placeCarOnTrack(r.rig, r.distance, r.lateral, 0, 0, 0, 0, false, false, false, 0.016));

    // Set initial camera right behind player
    trackData.sampleAt(0, _pos, _tan, _right, _up);
    camera.position.copy(_pos).addScaledVector(_tan, -10).addScaledVector(_up, 3.8);
    camera.lookAt(_pos.clone().addScaledVector(_tan, 24));

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = Math.max(container.clientHeight, 1);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    let frameId = 0;
    let disposed = false;
    let lastTime = performance.now();

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      if (!sync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const poll = () => {
        if (disposed) return;
        const status = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (status === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const tick = (now: number) => {
      if (disposed) return;
      const delta = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const input = inputs.current;
      const pausePressed = input.pressed("PAUSE");
      if (pausePressed && !raceState.pauseHeld) {
        setPaused((prev) => !prev);
      }
      raceState.pauseHeld = pausePressed;

      const isPaused = pausedRef.current;

      if (!isPaused && !raceState.finished) {
        raceState.countdown = Math.max(0, raceState.countdown - delta);
        const ceilCountdown = Math.ceil(raceState.countdown);
        if (ceilCountdown < raceState.lastBeep && ceilCountdown >= 0) {
          raceState.lastBeep = ceilCountdown;
          audioRef.current?.playCountdownBeep(ceilCountdown === 0);
        }

        const active = raceState.countdown === 0;
        const accelerating = active && input.pressed("ACCELERATE");
        const braking = active && input.pressed("BRAKE");
        const handbrake = active && input.pressed("HANDBRAKE");

        const digitalSteer = (input.pressed("STEER_RIGHT") ? 1 : 0) - (input.pressed("STEER_LEFT") ? 1 : 0);
        const analogSteer = input.axis("STEER");
        const steering = THREE.MathUtils.clamp(digitalSteer + analogSteer, -1, 1);

        const canNitro = active && input.pressed("NITRO") && playerState.nitro > 1 && playerState.speed > 12;
        const topSpeed = canNitro ? 96 : 67;

        if (accelerating) {
          playerState.speed = Math.min(topSpeed, playerState.speed + (canNitro ? 44 : 29) * delta);
        } else {
          playerState.speed = Math.max(0, playerState.speed - (handbrake ? 22 : 9.5) * delta);
        }
        if (braking) {
          playerState.speed = Math.max(0, playerState.speed - 48 * delta);
        }

        if (canNitro) {
          playerState.nitro = Math.max(0, playerState.nitro - 24 * delta);
        } else {
          playerState.nitro = Math.min(100, playerState.nitro + 8 * delta);
        }

        playerState.drifting = handbrake && Math.abs(steering) > 0.14 && playerState.speed > 18;
        const steerAuthority = (playerState.drifting ? 1.45 : 0.92) * (0.28 + playerState.speed / 68);
        playerState.lateral += steering * steerAuthority * 13.5 * delta;

        // Guardrail clamp with realistic speed scrub + impact thud
        const maxLat = ROAD_HALF_WIDTH - 1.35;
        if (Math.abs(playerState.lateral) > maxLat) {
          playerState.lateral = Math.sign(playerState.lateral) * maxLat;
          if (playerState.speed > 18 && raceState.collisionCooldown <= 0) {
            playerState.speed *= 0.86;
            playerState.shake = 0.25;
            raceState.collisionCooldown = 0.45;
            audioRef.current?.playCollision(0.6);
          }
        }

        playerState.heading = THREE.MathUtils.damp(
          playerState.heading,
          -steering * (playerState.drifting ? 0.34 : 0.14),
          10,
          delta,
        );
        playerState.distance += playerState.speed * delta;
        raceState.collisionCooldown = Math.max(0, raceState.collisionCooldown - delta);
        playerState.shake = Math.max(0, playerState.shake - delta * 1.4);

        if (active) {
          raceState.time += delta;
        }

        // Lap & finish detection
        const currentLap = Math.floor(playerState.distance / trackData.lapLength) + 1;
        if (currentLap > raceState.lastLap) {
          const lapDuration = raceState.time - raceState.lapStartTime;
          raceState.lapStartTime = raceState.time;
          if (raceState.bestLap === null || lapDuration < raceState.bestLap) {
            raceState.bestLap = lapDuration;
          }
          raceState.lastLap = currentLap;
          if (mode !== "FREE DRIVE" && currentLap > TOTAL_LAPS) {
            raceState.finished = true;
            audioRef.current?.playFinishFanfare();
          } else {
            audioRef.current?.playLapChime();
          }
        }

        // Update AI Rival Racers
        for (const rival of rivals) {
          if (active) {
            const curvature = Math.abs(trackData.sampleAt(rival.distance + 22, _pos, _tan, _right, _up));
            const cornerFactor = THREE.MathUtils.clamp(1 - curvature * 0.42, 0.72, 1.0);
            // Gentle rubber-banding so rivals stay competitive without teleporting
            const gapToPlayer = playerState.distance - rival.distance;
            const rubberBand = mode === "RACE" ? THREE.MathUtils.clamp(gapToPlayer * 0.08, -4.5, 6.5) : 0;
            const targetSpeed = (rival.baseSpeed + rubberBand) * cornerFactor;

            rival.speed = THREE.MathUtils.damp(rival.speed, targetSpeed, 2.5, delta);
            rival.distance += rival.speed * delta;

            // Overtaking / lane avoidance relative to player & other rivals
            const distDiff = rival.distance - playerState.distance;
            if (Math.abs(distDiff) < 16 && Math.abs(rival.lateral - playerState.lateral) < 3.2) {
              rival.targetLateral = playerState.lateral > 0 ? -5.0 : 5.0;
            } else if (Math.abs(distDiff) > 28) {
              // Follow gentle inside apex line on curves
              const curveSign = Math.sign(trackData.sampleAt(rival.distance + 18, _pos, _tan, _right, _up));
              rival.targetLateral = THREE.MathUtils.clamp(curveSign * 4.5, -6.5, 6.5);
            }

            rival.lateral = THREE.MathUtils.damp(rival.lateral, rival.targetLateral, 2.2, delta);

            // Car-to-car collision with player
            const longDiff = playerState.distance - rival.distance;
            const latDiff = playerState.lateral - rival.lateral;
            if (Math.abs(longDiff) < 4.3 && Math.abs(latDiff) < 2.05) {
              const pushSign = latDiff >= 0 ? 1 : -1;
              playerState.lateral = THREE.MathUtils.clamp(playerState.lateral + pushSign * 0.45, -maxLat, maxLat);
              rival.lateral = THREE.MathUtils.clamp(rival.lateral - pushSign * 0.35, -maxLat, maxLat);
              playerState.speed = Math.max(12, playerState.speed * 0.94);
              if (raceState.collisionCooldown <= 0) {
                playerState.shake = 0.32;
                raceState.collisionCooldown = 0.45;
                audioRef.current?.playCollision(0.95);
              }
            }
          }

          placeCarOnTrack(
            rival.rig,
            rival.distance,
            rival.lateral,
            0,
            (rival.targetLateral - rival.lateral) * 0.025,
            (rival.targetLateral - rival.lateral) * 0.08,
            rival.speed,
            false,
            rival.speed > 66,
            false,
            delta,
          );
        }

        // Place player car
        placeCarOnTrack(
          playerRig,
          playerState.distance,
          playerState.lateral,
          playerState.heading,
          steering * (playerState.drifting ? 0.14 : 0.05),
          -steering * 0.38,
          playerState.speed,
          braking,
          canNitro,
          playerState.drifting,
          delta,
        );

        // Update key light shadow camera around player
        trackData.sampleAt(playerState.distance, _pos, _tan, _right, _up);
        keyLight.position.set(_pos.x + 38, _pos.y + 70, _pos.z + 25);
        keyLight.target.position.copy(_pos);
        keyLight.target.updateMatrixWorld();

        // Smooth dynamic chase camera with FOV speed kick
        const desiredFov = 58 + (playerState.speed / 96) * 14 + (canNitro ? 5 : 0);
        if (Math.abs(camera.fov - desiredFov) > 0.1) {
          camera.fov = THREE.MathUtils.damp(camera.fov, desiredFov, 6, delta);
          camera.updateProjectionMatrix();
        }

        const shakeX = playerState.shake > 0 || canNitro ? (Math.random() - 0.5) * (playerState.shake + (canNitro ? 0.07 : 0)) : 0;
        const shakeY = playerState.shake > 0 || canNitro ? (Math.random() - 0.5) * (playerState.shake + (canNitro ? 0.07 : 0)) : 0;

        _camTarget
          .copy(_pos)
          .addScaledVector(_right, playerState.lateral * 0.72 + shakeX)
          .addScaledVector(_tan, -8.8)
          .addScaledVector(_up, 3.35 + shakeY);
        camera.position.lerp(_camTarget, 1 - Math.exp(-8.5 * delta));

        _camLook
          .copy(_pos)
          .addScaledVector(_right, playerState.lateral * 0.45)
          .addScaledVector(_tan, 24)
          .addScaledVector(_up, 1.0);
        camera.lookAt(_camLook);

        audioRef.current?.updateTelemetry(playerState.speed, canNitro, playerState.drifting, false);
      } else {
        audioRef.current?.updateTelemetry(0, false, false, true);
      }

      renderer.render(scene, camera);

      // Publish HUD telemetry at ~12Hz to avoid React re-render pressure
      raceState.publishAt += delta;
      if (raceState.publishAt >= 0.08) {
        raceState.publishAt = 0;
        const standing = 1 + rivals.filter((r) => r.distance > playerState.distance).length;
        const dots: RacerDot[] = [
          ...rivals.map((r) => ({ id: r.id, ...toMinimapDot(trackData, r.distance), color: r.color, isPlayer: false })),
          { id: "player", ...toMinimapDot(trackData, playerState.distance), color: "#e6392f", isPlayer: true },
        ];
        setTelemetry({
          speed: playerState.speed,
          nitro: playerState.nitro,
          lap: Math.min(TOTAL_LAPS, Math.floor(playerState.distance / trackData.lapLength) + 1),
          position: standing,
          totalRacers: 1 + rivals.length,
          time: raceState.time,
          bestLap: raceState.bestLap,
          countdown: Math.ceil(raceState.countdown),
          drifting: playerState.drifting,
          finished: raceState.finished,
          dots,
        });
      }

      if (isSoftwareGl) {
        afterDraw(() => {
          if (!disposed) tick(performance.now());
        });
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    if (isSoftwareGl) {
      tick(performance.now());
    } else {
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      envTarget.dispose();
      renderer.dispose();
    };
  }, [inputs, mode, raceId, trackData]);

  const restartRace = (nextMode?: GameMode) => {
    if (nextMode) setMode(nextMode);
    setPaused(false);
    setTelemetry(initialTelemetry);
    setRaceId((id) => id + 1);
  };

  return (
    <main className="racing-shell">
      <div className="racing-canvas-mount" ref={canvasMountRef} />

      {contextLost && (
        <div className="race-overlay">
          <div className="race-modal">
            <p className="eyebrow">GRAPHICS CONTEXT</p>
            <h1>Restoring viewport</h1>
            <p>WebGL context was interrupted. Return to console or restart the session.</p>
            <div className="overlay-actions">
              <button className="primary-button" onClick={() => restartRace()}>
                Reload track
              </button>
              <button className="secondary-button" onClick={onExit}>
                Back to console
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="race-topbar">
        <button className="race-back" onClick={onExit}>
          <ArrowLeft size={16} />
          <span>Console</span>
        </button>

        <div className="race-mode-segmented" role="group" aria-label="Game mode">
          {(["RACE", "TIME TRIAL", "FREE DRIVE"] as GameMode[]).map((option) => (
            <button
              key={option}
              className={option === mode ? "selected" : ""}
              onClick={() => restartRace(option)}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="race-controls">
          <button
            className="hud-icon-btn"
            onClick={() => setMusicEnabled((prev) => !prev)}
            title={musicEnabled ? "Mute soundtrack" : "Enable soundtrack"}
            aria-label="Toggle music"
          >
            <Music size={15} />
            <span>{musicEnabled ? "Music" : "No Music"}</span>
          </button>
          <button
            className="hud-icon-btn"
            onClick={() => setMuted((prev) => !prev)}
            title={muted ? "Unmute audio" : "Mute audio"}
            aria-label="Toggle sound"
          >
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <label className="hud-volume" aria-label="Master volume">
            <input type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
          </label>
          <button className="hud-icon-btn" onClick={() => setPaused((p) => !p)}>
            {paused ? <Play size={14} /> : <Pause size={14} />}
            <span>{paused ? "Resume" : "Pause"}</span>
          </button>
        </div>
      </header>

      <aside className="race-minimap-panel" aria-label="Circuit map and standings">
        <svg viewBox="0 0 100 100" className="minimap-svg">
          <path d={minimapPath} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="4.5" strokeLinejoin="round" />
          <path d={minimapPath} fill="none" stroke="#f4f2ec" strokeWidth="1.4" strokeLinejoin="round" />
          {telemetry.dots.map((dot) => (
            <circle
              key={dot.id}
              cx={dot.x}
              cy={dot.y}
              r={dot.isPlayer ? 4.4 : 3.2}
              fill={dot.color}
              stroke="#0a0b0e"
              strokeWidth="1.2"
            />
          ))}
        </svg>
        <div className="minimap-stats">
          {mode === "RACE" && (
            <div>
              <small>POS</small>
              <strong className="tabular-nums">
                {telemetry.position} / {telemetry.totalRacers}
              </strong>
            </div>
          )}
          <div>
            <small>{mode === "FREE DRIVE" ? "DRIVE" : "LAP"}</small>
            <strong className="tabular-nums">{mode === "FREE DRIVE" ? "OPEN" : `${telemetry.lap} / ${TOTAL_LAPS}`}</strong>
          </div>
          <div>
            <small>TIME</small>
            <strong className="tabular-nums">{formatTime(telemetry.time)}</strong>
          </div>
        </div>
      </aside>

      <section className="race-hud" aria-label="Vehicle telemetry">
        <div className="race-speed-dock">
          <div className="race-speed">
            <span className="tabular-nums">{String(Math.round(telemetry.speed * 3.6)).padStart(3, "0")}</span>
            <small>KM/H {telemetry.drifting ? "· DRIFT" : ""}</small>
          </div>
          <div className="nitro-meter">
            <div className="nitro-label">
              <span>NITRO</span>
              <b className="tabular-nums">{Math.round(telemetry.nitro)}%</b>
            </div>
            <div className="nitro-track">
              <i style={{ width: `${telemetry.nitro}%` }} />
            </div>
          </div>
        </div>
      </section>

      {telemetry.countdown > 0 && !paused && <div className="race-countdown tabular-nums">{telemetry.countdown}</div>}

      {paused && (
        <div className="race-overlay">
          <div className="race-modal">
            <p className="eyebrow">RACE PAUSED</p>
            <h1>Take a breath.</h1>
            <p>Keyboard and POYY LINK inputs are held safely until you resume.</p>
            <div className="overlay-actions">
              <button className="primary-button" onClick={() => setPaused(false)}>
                Resume race
              </button>
              <button className="secondary-button" onClick={() => restartRace()}>
                <RotateCcw size={15} /> Restart
              </button>
              <button className="secondary-button" onClick={onExit}>
                Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {telemetry.finished && (
        <div className="race-overlay">
          <div className="race-modal">
            <p className="eyebrow">CHECKERED FLAG</p>
            <h1>
              {mode === "RACE" ? `Finished ${ordinal(telemetry.position)}` : "Circuit complete"}
            </h1>
            <p>
              Total time <strong className="tabular-nums">{formatTime(telemetry.time)}</strong>
              {telemetry.bestLap ? (
                <>
                  {" "}
                  · Best lap <strong className="tabular-nums">{formatTime(telemetry.bestLap)}</strong>
                </>
              ) : null}
            </p>
            <div className="overlay-actions">
              <button className="primary-button" onClick={() => restartRace()}>
                <Trophy size={15} /> Race again
              </button>
              <button className="secondary-button" onClick={onExit}>
                Return to console
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="race-help">
        <span>
          <kbd>W</kbd> Throttle
        </span>
        <span>
          <kbd>A</kbd>
          <kbd>D</kbd> or Phone Tilt Steer
        </span>
        <span>
          <kbd>SHIFT</kbd> Nitro
        </span>
        <span>
          <kbd>SPACE</kbd> Drift
        </span>
        <span>
          <kbd>ESC</kbd> Pause
        </span>
        <span className="race-link-state">POYY LINK · {socket.connected ? "Connected" : "Reconnecting"}</span>
      </footer>
    </main>
  );
}

function ordinal(n: number) {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  const centiseconds = Math.floor((seconds % 1) * 100);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}
