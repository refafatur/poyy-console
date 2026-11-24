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
import {
  BARRIER_OFFSET,
  createTrackData,
  createTrackMeshes,
  type TrackData,
} from "@/games/poyy-racing/track";

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
  wrongWay: boolean;
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
  wrongWay: false,
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
const _carFwd = new THREE.Vector3();
const _carRight = new THREE.Vector3();
const _negFwd = new THREE.Vector3();
const _rivalPos = new THREE.Vector3();
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

  // Unlock & preload Lamborghini audio immediately on mount (and resume on user gesture)
  useEffect(() => {
    const audio = new RacingAudioEngine();
    audioRef.current = audio;
    const unlock = () => audio.unlock();
    unlock();
    window.addEventListener("keydown", unlock);
    window.addEventListener("pointerdown", unlock);
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

    const startSample = trackData.samples[0];
    const startX = startSample.position.x + startSample.right.x * 2.2;
    const startZ = startSample.position.z + startSample.right.z * 2.2;
    const startYaw = Math.atan2(-startSample.tangent.x, -startSample.tangent.z);

    const playerState = {
      x: startX,
      y: startSample.position.y,
      z: startZ,
      yaw: startYaw,
      vx: 0,
      vz: 0,
      speed: 0,
      trackIndex: 0,
      trackDistance: 0,
      prevTrackDistance: 0,
      progressDistance: 0,
      wrongWay: false,
      driftSlipVisual: 0,
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

    const updateRigVisuals = (
      rig: RacerCarRig,
      slipYaw: number,
      rollTilt: number,
      steerWheelAngle: number,
      wheelSpeed: number,
      braking: boolean,
      nitro: boolean,
      drifting: boolean,
      delta: number,
    ) => {
      rig.bodyTiltGroup.rotation.y = THREE.MathUtils.damp(rig.bodyTiltGroup.rotation.y, slipYaw, 10, delta);
      rig.bodyTiltGroup.rotation.z = THREE.MathUtils.damp(rig.bodyTiltGroup.rotation.z, rollTilt, 10, delta);
      rig.frontWheels.forEach((fw) => {
        fw.rotation.y = THREE.MathUtils.damp(fw.rotation.y, steerWheelAngle, 14, delta);
      });
      rig.allWheels.forEach((w) => {
        w.rotation.x -= wheelSpeed * delta * 2.4;
      });
      rig.brakeMaterial.emissiveIntensity = braking ? 3.4 : 0.9;
      rig.nitroFlames.forEach((f) => {
        f.visible = nitro;
        if (nitro) f.scale.setScalar(0.85 + Math.random() * 0.35);
      });
      rig.driftSmoke.visible = drifting;
    };

    const placeRivalOnTrack = (
      rig: RacerCarRig,
      distance: number,
      lateral: number,
      rollTilt: number,
      steerWheelAngle: number,
      speed: number,
      nitro: boolean,
      delta: number,
    ) => {
      trackData.sampleAt(distance, _pos, _tan, _right, _up);
      _negTan.copy(_tan).negate();
      _basis.makeBasis(_right, _up, _negTan);
      rig.root.position.copy(_pos).addScaledVector(_right, lateral);
      rig.root.quaternion.setFromRotationMatrix(_basis);
      updateRigVisuals(rig, 0, rollTilt, steerWheelAngle, speed, false, nitro, false, delta);
    };

    const placePlayerInWorld = (
      rig: RacerCarRig,
      x: number,
      y: number,
      z: number,
      yaw: number,
      surfaceUp: THREE.Vector3,
      slipYaw: number,
      rollTilt: number,
      steerWheelAngle: number,
      wheelSpeed: number,
      braking: boolean,
      nitro: boolean,
      drifting: boolean,
      delta: number,
    ) => {
      _carFwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      // Project heading onto the road slope plane while keeping world yaw strictly player-controlled
      _carFwd.addScaledVector(surfaceUp, -_carFwd.dot(surfaceUp)).normalize();
      _carRight.crossVectors(_carFwd, surfaceUp).normalize();
      _negFwd.copy(_carFwd).negate();
      _basis.makeBasis(_carRight, surfaceUp, _negFwd);

      rig.root.position.set(x, y, z);
      rig.root.quaternion.setFromRotationMatrix(_basis);
      updateRigVisuals(rig, slipYaw, rollTilt, steerWheelAngle, wheelSpeed, braking, nitro, drifting, delta);
    };

    // Initial placement before first frame
    placePlayerInWorld(
      playerRig,
      playerState.x,
      playerState.y,
      playerState.z,
      playerState.yaw,
      startSample.up,
      0,
      0,
      0,
      0,
      false,
      false,
      false,
      0.016,
    );
    rivals.forEach((r) => placeRivalOnTrack(r.rig, r.distance, r.lateral, 0, 0, 0, false, 0.016));

    // Set initial camera right behind player facing their world heading
    _carFwd.set(-Math.sin(playerState.yaw), 0, -Math.cos(playerState.yaw));
    camera.position
      .set(playerState.x, playerState.y, playerState.z)
      .addScaledVector(_carFwd, -8.8)
      .addScaledVector(startSample.up, 3.35);
    camera.lookAt(
      playerState.x + _carFwd.x * 20,
      playerState.y + 1.1,
      playerState.z + _carFwd.z * 20,
    );

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

    const maxLat = BARRIER_OFFSET - 1.15;

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

        // Current car heading basis vectors in XZ world space (strictly independent of track curvature!)
        let fx = -Math.sin(playerState.yaw);
        let fz = -Math.cos(playerState.yaw);
        let rx = Math.cos(playerState.yaw);
        let rz = -Math.sin(playerState.yaw);

        let forwardSpeed = playerState.vx * fx + playerState.vz * fz;
        let lateralSpeed = playerState.vx * rx + playerState.vz * rz;
        const absForward = Math.abs(forwardSpeed);

        const canNitro = active && input.pressed("NITRO") && playerState.nitro > 1 && forwardSpeed > 12;
        const topSpeed = canNitro ? 96 : 68;

        if (accelerating) {
          forwardSpeed = Math.min(topSpeed, forwardSpeed + (canNitro ? 46 : 30) * delta);
        } else if (!braking) {
          const drag = handbrake ? 22 : 9.5;
          if (forwardSpeed > 0) {
            forwardSpeed = Math.max(0, forwardSpeed - drag * delta);
          } else if (forwardSpeed < 0) {
            forwardSpeed = Math.min(0, forwardSpeed + drag * delta);
          }
        }

        if (braking) {
          if (forwardSpeed > 1.5) {
            forwardSpeed = Math.max(0, forwardSpeed - 54 * delta);
          } else {
            // Allow controlled reversing out of walls/barriers
            forwardSpeed = Math.max(-22, forwardSpeed - 24 * delta);
          }
        }

        if (canNitro) {
          playerState.nitro = Math.max(0, playerState.nitro - 24 * delta);
        } else {
          playerState.nitro = Math.min(100, playerState.nitro + 8 * delta);
        }

        playerState.drifting = handbrake && Math.abs(steering) > 0.14 && absForward > 18;

        // Pure manual steering: yaw ONLY changes when player steers (if steering === 0, car drives straight!)
        const steerScale =
          Math.min(1, absForward / 8.5) * (1 - 0.18 * Math.min(1, absForward / 90)) * (forwardSpeed >= -0.5 ? 1 : -1);
        const turnRate = playerState.drifting ? 2.15 : 1.72;
        playerState.yaw -= steering * turnRate * steerScale * delta;

        fx = -Math.sin(playerState.yaw);
        fz = -Math.cos(playerState.yaw);
        rx = Math.cos(playerState.yaw);
        rz = -Math.sin(playerState.yaw);

        // Strong lateral tire grip during normal cornering; looser slip angle when drifting
        const lateralGripRate = playerState.drifting ? 2.8 : 10.5;
        lateralSpeed *= Math.exp(-lateralGripRate * delta);

        playerState.vx = fx * forwardSpeed + rx * lateralSpeed;
        playerState.vz = fz * forwardSpeed + rz * lateralSpeed;

        // Integrate world position directly in XZ
        playerState.x += playerState.vx * delta;
        playerState.z += playerState.vz * delta;

        // Project onto circuit purely to sample road height, surface slope, lap progress, & guardrail bounds
        let proj = trackData.projectOntoTrack(playerState.x, playerState.z, playerState.trackIndex);
        playerState.trackIndex = proj.sampleIndex;

        // Guardrail physical boundary collision (no rail-steering on open road)
        if (Math.abs(proj.signedLateral) > maxLat) {
          const sideSign = Math.sign(proj.signedLateral);
          const clampedLat = sideSign * maxLat;
          playerState.x = proj.position.x + proj.right.x * clampedLat;
          playerState.z = proj.position.z + proj.right.z * clampedLat;

          const nx = -sideSign * proj.right.x;
          const nz = -sideSign * proj.right.z;
          const vn = playerState.vx * nx + playerState.vz * nz;
          if (vn < 0) {
            playerState.vx -= 1.18 * vn * nx;
            playerState.vz -= 1.18 * vn * nz;
            const impactSeverity = Math.min(1, -vn / Math.max(Math.hypot(playerState.vx, playerState.vz), 1));
            const scrub = 0.88 - impactSeverity * 0.24;
            playerState.vx *= scrub;
            playerState.vz *= scrub;

            // Physical nose deflection only upon actual wall impact so the car doesn't wedge nose-first
            if (-vn > 3.5) {
              const wallTanX = proj.tangent.x;
              const wallTanZ = proj.tangent.z;
              const forwardAlign = fx * wallTanX + fz * wallTanZ >= 0 ? 1 : -1;
              const targetWallYaw = Math.atan2(-(wallTanX * forwardAlign), -(wallTanZ * forwardAlign));
              let yawDiff = targetWallYaw - playerState.yaw;
              while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
              while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
              playerState.yaw += yawDiff * Math.min(0.45, impactSeverity * 0.65);
            }

            if (-vn > 6 && raceState.collisionCooldown <= 0) {
              playerState.shake = 0.28 + impactSeverity * 0.2;
              raceState.collisionCooldown = 0.42;
              audioRef.current?.playCollision(0.55 + impactSeverity * 0.45);
            }
          }

          proj = trackData.projectOntoTrack(playerState.x, playerState.z, playerState.trackIndex);
        }

        playerState.y = THREE.MathUtils.damp(playerState.y, proj.position.y, 18, delta);
        playerState.speed = Math.hypot(playerState.vx, playerState.vz);
        playerState.trackDistance = proj.distance;

        // Track genuine forward progress around the loop (wraps cleanly across start/finish seam)
        let deltaProgress = proj.distance - playerState.prevTrackDistance;
        if (deltaProgress < -trackData.lapLength * 0.5) {
          deltaProgress += trackData.lapLength;
        } else if (deltaProgress > trackData.lapLength * 0.5) {
          deltaProgress -= trackData.lapLength;
        }
        playerState.prevTrackDistance = proj.distance;
        playerState.progressDistance = Math.max(0, playerState.progressDistance + deltaProgress);

        playerState.wrongWay = active && forwardSpeed > 8 && fx * proj.tangent.x + fz * proj.tangent.z < -0.35;

        raceState.collisionCooldown = Math.max(0, raceState.collisionCooldown - delta);
        playerState.shake = Math.max(0, playerState.shake - delta * 1.4);

        if (active) {
          raceState.time += delta;
        }

        // Lap & finish detection based on true signed lap distance completed
        const currentLap = Math.floor(playerState.progressDistance / trackData.lapLength) + 1;
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

        // Update AI Rival Racers and compute true XZ car-to-car collisions
        for (const rival of rivals) {
          if (active) {
            const curvature = Math.abs(trackData.sampleAt(rival.distance + 22, _pos, _tan, _right, _up));
            const cornerFactor = THREE.MathUtils.clamp(1 - curvature * 0.42, 0.72, 1.0);
            const gapToPlayer = playerState.progressDistance - rival.distance;
            const rubberBand = mode === "RACE" ? THREE.MathUtils.clamp(gapToPlayer * 0.08, -4.5, 6.5) : 0;
            const targetSpeed = (rival.baseSpeed + rubberBand) * cornerFactor;

            rival.speed = THREE.MathUtils.damp(rival.speed, targetSpeed, 2.5, delta);
            rival.distance += rival.speed * delta;

            const distDiff = rival.distance - playerState.progressDistance;
            if (Math.abs(distDiff) < 16 && Math.abs(rival.lateral - proj.signedLateral) < 3.4) {
              rival.targetLateral = proj.signedLateral > 0 ? -5.2 : 5.2;
            } else if (Math.abs(distDiff) > 28) {
              const curveSign = Math.sign(trackData.sampleAt(rival.distance + 18, _pos, _tan, _right, _up));
              rival.targetLateral = THREE.MathUtils.clamp(curveSign * 4.5, -6.5, 6.5);
            }

            rival.lateral = THREE.MathUtils.damp(rival.lateral, rival.targetLateral, 2.2, delta);

            // Real XZ distance check against player's free world coordinates
            trackData.sampleAt(rival.distance, _pos, _tan, _right, _up);
            _rivalPos.copy(_pos).addScaledVector(_right, rival.lateral);
            const dx = playerState.x - _rivalPos.x;
            const dz = playerState.z - _rivalPos.z;
            const distSq = dx * dx + dz * dz;
            const minCarSep = 2.65;
            if (distSq > 1e-4 && distSq < minCarSep * minCarSep) {
              const dist = Math.sqrt(distSq);
              const nx = dx / dist;
              const nz = dz / dist;
              const push = minCarSep - dist;
              playerState.x += nx * push * 0.65;
              playerState.z += nz * push * 0.65;
              playerState.vx += nx * 8.5;
              playerState.vz += nz * 8.5;
              playerState.vx *= 0.94;
              playerState.vz *= 0.94;
              rival.speed = Math.max(16, rival.speed * 0.94);

              if (raceState.collisionCooldown <= 0) {
                playerState.shake = 0.34;
                raceState.collisionCooldown = 0.42;
                audioRef.current?.playCollision(0.9);
              }
            }
          }

          placeRivalOnTrack(
            rival.rig,
            rival.distance,
            rival.lateral,
            (rival.targetLateral - rival.lateral) * 0.025,
            (rival.targetLateral - rival.lateral) * 0.08,
            rival.speed,
            rival.speed > 66,
            delta,
          );
        }

        // Refresh world projection after rival collisions for final Y placement & shadow light
        const finalProj = trackData.projectOntoTrack(playerState.x, playerState.z, playerState.trackIndex);
        playerState.y = THREE.MathUtils.damp(playerState.y, finalProj.position.y, 18, delta);

        const signedWheelSpeed = forwardSpeed >= -0.5 ? playerState.speed : -playerState.speed;
        const visualSlip = playerState.drifting ? -steering * 0.24 : -steering * 0.05;
        placePlayerInWorld(
          playerRig,
          playerState.x,
          playerState.y,
          playerState.z,
          playerState.yaw,
          finalProj.up,
          visualSlip,
          steering * (playerState.drifting ? 0.14 : 0.055),
          -steering * 0.42,
          signedWheelSpeed,
          braking,
          canNitro,
          playerState.drifting,
          delta,
        );

        // Update key light shadow camera around player world position
        keyLight.position.set(playerState.x + 38, playerState.y + 70, playerState.z + 25);
        keyLight.target.position.set(playerState.x, playerState.y, playerState.z);
        keyLight.target.updateMatrixWorld();

        // Smooth dynamic chase camera strictly following player's actual world heading (no track snapping)
        const desiredFov = 58 + (playerState.speed / 96) * 14 + (canNitro ? 5 : 0);
        if (Math.abs(camera.fov - desiredFov) > 0.1) {
          camera.fov = THREE.MathUtils.damp(camera.fov, desiredFov, 6, delta);
          camera.updateProjectionMatrix();
        }

        const shakeX =
          playerState.shake > 0 || canNitro ? (Math.random() - 0.5) * (playerState.shake + (canNitro ? 0.07 : 0)) : 0;
        const shakeY =
          playerState.shake > 0 || canNitro ? (Math.random() - 0.5) * (playerState.shake + (canNitro ? 0.07 : 0)) : 0;

        _carFwd.set(-Math.sin(playerState.yaw), 0, -Math.cos(playerState.yaw));
        _carRight.set(Math.cos(playerState.yaw), 0, -Math.sin(playerState.yaw));
        _camTarget
          .set(playerState.x, playerState.y, playerState.z)
          .addScaledVector(_carFwd, -8.8)
          .addScaledVector(finalProj.up, 3.35 + shakeY)
          .addScaledVector(_carRight, shakeX);
        camera.position.lerp(_camTarget, 1 - Math.exp(-9.5 * delta));

        _camLook
          .set(playerState.x, playerState.y, playerState.z)
          .addScaledVector(_carFwd, 18)
          .addScaledVector(finalProj.up, 1.15);
        camera.lookAt(_camLook);

        const brakingDecel = braking && forwardSpeed > 1.5;
        const reversingThrottle = braking && forwardSpeed <= 1.5;
        audioRef.current?.updateTelemetry(
          playerState.speed,
          accelerating || reversingThrottle,
          brakingDecel,
          canNitro,
          playerState.drifting,
          false,
        );
      } else {
        audioRef.current?.updateTelemetry(0, false, false, false, false, true);
      }

      renderer.render(scene, camera);

      // Publish HUD telemetry at ~12Hz to avoid React re-render pressure
      raceState.publishAt += delta;
      if (raceState.publishAt >= 0.08) {
        raceState.publishAt = 0;
        const standing = 1 + rivals.filter((r) => r.distance > playerState.progressDistance).length;
        const dots: RacerDot[] = [
          ...rivals.map((r) => ({ id: r.id, ...toMinimapDot(trackData, r.distance), color: r.color, isPlayer: false })),
          { id: "player", ...toMinimapDot(trackData, playerState.trackDistance), color: "#e6392f", isPlayer: true },
        ];
        setTelemetry({
          speed: playerState.speed,
          nitro: playerState.nitro,
          lap: Math.min(TOTAL_LAPS, Math.floor(playerState.progressDistance / trackData.lapLength) + 1),
          position: standing,
          totalRacers: 1 + rivals.length,
          time: raceState.time,
          bestLap: raceState.bestLap,
          countdown: Math.ceil(raceState.countdown),
          drifting: playerState.drifting,
          wrongWay: playerState.wrongWay,
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
      playerRig.dispose();
      rivals.forEach((r) => r.rig.dispose());
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
    audioRef.current?.resetTransmission();
    audioRef.current?.playStartRoar();
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

      {telemetry.wrongWay && telemetry.countdown === 0 && !paused && !telemetry.finished && (
        <div className="race-wrong-way" role="status">
          WRONG WAY
        </div>
      )}

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
