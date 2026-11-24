"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Socket } from "socket.io-client";
import { ArrowLeft, FastForward, Lightbulb, Music, Pause, Play, RotateCcw, Trophy, Volume2, VolumeX } from "lucide-react";
import { useUniversalInputs } from "@/hooks/use-universal-inputs";
import { RacingAudioEngine, type RivalAudioInput } from "@/games/poyy-racing/audio";
import { CAR_LIVERIES, createRacerCarMesh, type RacerCarRig } from "@/games/poyy-racing/models/carModel";
import { createCitySkyline } from "@/games/poyy-racing/models/cityBuildings";
import {
  BARRIER_OFFSET,
  createTrackData,
  createTrackMeshes,
  type TrackData,
} from "@/games/poyy-racing/track";

export type GameMode = "RACE" | "TIME TRIAL" | "FREE DRIVE";
export type RacePhase = "INTRO" | "COUNTDOWN" | "RACING";

type RacerDot = { id: string; x: number; y: number; color: string; isPlayer: boolean };

type Telemetry = {
  speed: number;
  nitro: number;
  lap: number;
  position: number;
  totalRacers: number;
  time: number;
  bestLap: number | null;
  phase: RacePhase;
  countdown: number;
  showGo: boolean;
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
  steerAngle: number;
  braking: boolean;
  worldX: number;
  worldY: number;
  worldZ: number;
  tanX: number;
  tanZ: number;
  rig: RacerCarRig;
};

const TOTAL_LAPS = 3;
const INTRO_DURATION = 6.0;

const initialTelemetry: Telemetry = {
  speed: 0,
  nitro: 100,
  lap: 1,
  position: 1,
  totalRacers: 4,
  time: 0,
  bestLap: null,
  phase: "INTRO",
  countdown: 3,
  showGo: false,
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
const _introPos = new THREE.Vector3();
const _introTan = new THREE.Vector3();
const _introRight = new THREE.Vector3();
const _introUp = new THREE.Vector3();
const _heroPos = new THREE.Vector3();
const _heroLook = new THREE.Vector3();
const _chasePos = new THREE.Vector3();
const _chaseLook = new THREE.Vector3();
const _listenerPos = new THREE.Vector3();
const _listenerFwd = new THREE.Vector3();
const _listenerRight = new THREE.Vector3();
const _relVec = new THREE.Vector3();
const _otherPos = new THREE.Vector3();
const _otherTan = new THREE.Vector3();
const _otherRight = new THREE.Vector3();
const _otherUp = new THREE.Vector3();

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
  const [headlightsOn, setHeadlightsOn] = useState(true);
  const [volume, setVolume] = useState(55);
  const [contextLost, setContextLost] = useState(false);

  const canvasMountRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<RacingAudioEngine | null>(null);
  const pausedRef = useRef(paused);
  const modeRef = useRef(mode);
  const headlightsOnRef = useRef(headlightsOn);
  const skipIntroRef = useRef<(() => void) | null>(null);

  pausedRef.current = paused;
  modeRef.current = mode;
  headlightsOnRef.current = headlightsOn;

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "KeyM") {
        setMuted((prev) => !prev);
      } else if (e.code === "KeyL") {
        setHeadlightsOn((prev) => !prev);
      } else if (e.code === "Space" && skipIntroRef.current) {
        e.preventDefault();
        skipIntroRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

    // Rival AI racers on staggered 2x2 starting grid ahead of player (active in RACE and FREE DRIVE)
    const rivals: RivalState[] =
      mode === "TIME TRIAL"
        ? []
        : [
            {
              id: "cobalt",
              name: CAR_LIVERIES.cobalt.name,
              color: "#3b82f6",
              distance: 19.5,
              lateral: -3.2,
              targetLateral: -3.2,
              speed: 0,
              baseSpeed: mode === "FREE DRIVE" ? 48 : 64.5,
              steerAngle: 0,
              braking: false,
              worldX: 0,
              worldY: 0,
              worldZ: 0,
              tanX: 0,
              tanZ: -1,
              rig: createRacerCarMesh(CAR_LIVERIES.cobalt),
            },
            {
              id: "amber",
              name: CAR_LIVERIES.amber.name,
              color: "#f59e0b",
              distance: 13.0,
              lateral: 3.2,
              targetLateral: 3.2,
              speed: 0,
              baseSpeed: mode === "FREE DRIVE" ? 51 : 62.5,
              steerAngle: 0,
              braking: false,
              worldX: 0,
              worldY: 0,
              worldZ: 0,
              tanX: 0,
              tanZ: -1,
              rig: createRacerCarMesh(CAR_LIVERIES.amber),
            },
            {
              id: "emerald",
              name: CAR_LIVERIES.emerald.name,
              color: "#10b981",
              distance: 6.5,
              lateral: -3.2,
              targetLateral: -3.2,
              speed: 0,
              baseSpeed: mode === "FREE DRIVE" ? 45 : 60.5,
              steerAngle: 0,
              braking: false,
              worldX: 0,
              worldY: 0,
              worldZ: 0,
              tanX: 0,
              tanZ: -1,
              rig: createRacerCarMesh(CAR_LIVERIES.emerald),
            },
          ];

    for (const r of rivals) scene.add(r.rig.root);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const startSample = trackData.samples[0];
    const startX = startSample.position.x + startSample.right.x * 3.2;
    const startZ = startSample.position.z + startSample.right.z * 3.2;
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
      phase: "INTRO" as RacePhase,
      introTime: 0,
      goBannerTimer: 0,
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

    const triggerSkipIntro = () => {
      if (raceState.phase !== "INTRO") return;
      raceState.phase = "COUNTDOWN";
      raceState.introTime = INTRO_DURATION;
      raceState.countdown = 3.2;
      raceState.lastBeep = 4;
      raceState.publishAt = 1; // publish immediately on next tick
      skipIntroRef.current = null;
    };
    skipIntroRef.current = triggerSkipIntro;

    const MAX_WHEEL_STEER_RAD = THREE.MathUtils.degToRad(33);

    const updateRigVisuals = (
      rig: RacerCarRig,
      slipYaw: number,
      rollTilt: number,
      steerWheelAngle: number,
      wheelSpeed: number,
      headlights: boolean,
      braking: boolean,
      reversing: boolean,
      nitro: boolean,
      drifting: boolean,
      delta: number,
    ) => {
      rig.bodyTiltGroup.rotation.y = THREE.MathUtils.damp(rig.bodyTiltGroup.rotation.y, slipYaw, 10, delta);
      rig.bodyTiltGroup.rotation.z = THREE.MathUtils.damp(rig.bodyTiltGroup.rotation.z, rollTilt, 10, delta);

      const steerLerp = 1 - Math.exp(-12 * delta);
      const clampedSteer = THREE.MathUtils.clamp(steerWheelAngle, -MAX_WHEEL_STEER_RAD, MAX_WHEEL_STEER_RAD);
      rig.frontWheels.forEach((fw) => {
        fw.rotation.y = THREE.MathUtils.lerp(fw.rotation.y, clampedSteer, steerLerp);
      });

      const angularVelocity = wheelSpeed / Math.max(0.2, rig.wheelRadius);
      rig.allWheels.forEach((w) => {
        w.rotation.x -= angularVelocity * delta;
      });

      const lightLerp = 1 - Math.exp(-18 * delta);
      rig.headlightMaterial.emissiveIntensity = THREE.MathUtils.lerp(
        rig.headlightMaterial.emissiveIntensity,
        headlights ? 4.2 : 0.08,
        lightLerp,
      );
      rig.headlightBeams.visible = headlights;
      rig.headlightSpots.forEach((spot) => {
        spot.intensity = headlights ? 42 : 0;
      });

      const targetBrakeIntensity = braking ? 4.8 : headlights ? 0.95 : 0.25;
      rig.brakeMaterial.emissiveIntensity = THREE.MathUtils.lerp(
        rig.brakeMaterial.emissiveIntensity,
        targetBrakeIntensity,
        lightLerp,
      );
      rig.reverseMaterial.emissiveIntensity = THREE.MathUtils.lerp(
        rig.reverseMaterial.emissiveIntensity,
        reversing ? 4.6 : 0,
        lightLerp,
      );

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
      braking: boolean,
      nitro: boolean,
      delta: number,
    ) => {
      trackData.sampleAt(distance, _pos, _tan, _right, _up);
      _negTan.copy(_tan).negate();
      _basis.makeBasis(_right, _up, _negTan);
      rig.root.position.copy(_pos).addScaledVector(_right, lateral);
      rig.root.quaternion.setFromRotationMatrix(_basis);
      updateRigVisuals(rig, 0, rollTilt, steerWheelAngle, speed, true, braking, false, nitro, false, delta);
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
      headlights: boolean,
      braking: boolean,
      reversing: boolean,
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
      updateRigVisuals(
        rig,
        slipYaw,
        rollTilt,
        steerWheelAngle,
        wheelSpeed,
        headlights,
        braking,
        reversing,
        nitro,
        drifting,
        delta,
      );
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
      headlightsOnRef.current,
      false,
      false,
      false,
      false,
      0.016,
    );
    rivals.forEach((r) => placeRivalOnTrack(r.rig, r.distance, r.lateral, 0, 0, 0, false, false, 0.016));

    // Set initial camera at Phase 1 aerial drone starting point
    const introStartDist = trackData.lapLength - 130;
    trackData.sampleAt(introStartDist, _introPos, _introTan, _introRight, _introUp);
    camera.fov = 54;
    camera.updateProjectionMatrix();
    camera.position
      .copy(_introPos)
      .addScaledVector(_introUp, 30)
      .addScaledVector(_introRight, -12);
    trackData.sampleAt(introStartDist + 42, _otherPos, _otherTan, _otherRight, _otherUp);
    camera.lookAt(_otherPos.x, _otherPos.y + 1.5, _otherPos.z);

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
        if (raceState.phase === "INTRO") {
          raceState.introTime += delta;
          if (input.pressed("HANDBRAKE") || raceState.introTime >= INTRO_DURATION) {
            raceState.phase = "COUNTDOWN";
            raceState.introTime = INTRO_DURATION;
            raceState.countdown = 3.2;
            raceState.lastBeep = 4;
            raceState.publishAt = 1;
            skipIntroRef.current = null;
          }
        } else if (raceState.phase === "COUNTDOWN") {
          raceState.countdown = Math.max(0, raceState.countdown - delta);
          const ceilCountdown = Math.ceil(raceState.countdown);
          if (ceilCountdown < raceState.lastBeep && ceilCountdown >= 0) {
            raceState.lastBeep = ceilCountdown;
            audioRef.current?.playCountdownBeep(ceilCountdown === 0);
            raceState.publishAt = 1;
          }
          if (raceState.countdown <= 0) {
            raceState.phase = "RACING";
            raceState.goBannerTimer = 0.85;
            raceState.publishAt = 1;
          }
        } else if (raceState.goBannerTimer > 0) {
          raceState.goBannerTimer = Math.max(0, raceState.goBannerTimer - delta);
        }

        const active = raceState.phase === "RACING";
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

            const impactVel = -vn;
            if (impactVel > 2.8 && raceState.collisionCooldown <= 0) {
              const scaledImpact = THREE.MathUtils.clamp((impactVel - 2.5) / 38, 0.14, 1);
              playerState.shake = 0.12 + scaledImpact * 0.36;
              raceState.collisionCooldown = 0.24;
              audioRef.current?.playCollision(scaledImpact);
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

        // Update AI Rival Racers (lookahead corner braking, overtaking, steering sync, and XZ collisions)
        const rivalAudioInputs: RivalAudioInput[] = [];
        for (let i = 0; i < rivals.length; i++) {
          const rival = rivals[i];
          if (active) {
            const localCurv = trackData.sampleAt(rival.distance + 4, _pos, _tan, _right, _up);
            const curv16 = Math.abs(trackData.sampleAt(rival.distance + 16, _pos, _tan, _right, _up));
            const curv34 = Math.abs(trackData.sampleAt(rival.distance + 34, _pos, _tan, _right, _up));
            const curv54 = Math.abs(trackData.sampleAt(rival.distance + 54, _pos, _tan, _right, _up));
            const maxAheadCurv = Math.max(curv16, curv34, curv54 * 0.85);
            const cornerFactor = THREE.MathUtils.clamp(1 - maxAheadCurv * 0.56, 0.58, 1.0);

            const paceWave = Math.sin(raceState.time * 0.45 + i * 2.1) * 1.6;
            const gapToPlayer = playerState.progressDistance - rival.distance;
            const rubberBand = mode === "RACE" ? THREE.MathUtils.clamp(gapToPlayer * 0.08, -4.5, 6.5) : 0;
            let targetSpeed = (rival.baseSpeed + rubberBand + paceWave) * cornerFactor;

            // Check overtaking opportunity against player and other AI rivals
            let blockerLat: number | null = null;
            let closestGap = 22;

            const playerGap = playerState.progressDistance - rival.distance;
            if (playerGap > 0 && playerGap < closestGap && Math.abs(rival.lateral - proj.signedLateral) < 3.5) {
              closestGap = playerGap;
              blockerLat = proj.signedLateral;
            }
            for (let j = 0; j < rivals.length; j++) {
              if (i === j) continue;
              const other = rivals[j];
              const gap = other.distance - rival.distance;
              if (gap > 0 && gap < closestGap && Math.abs(rival.lateral - other.lateral) < 3.4) {
                closestGap = gap;
                blockerLat = other.lateral;
              }
            }

            if (blockerLat !== null) {
              rival.targetLateral = blockerLat > 0 ? -5.8 : 5.8;
              if (closestGap < 8.5 && Math.abs(rival.lateral - blockerLat) < 2.6) {
                targetSpeed = Math.min(targetSpeed, Math.max(24, rival.speed * 0.88));
              }
            } else {
              const apexSign = Math.sign(trackData.sampleAt(rival.distance + 20, _pos, _tan, _right, _up));
              const preferredLane = apexSign !== 0 ? apexSign * 4.8 : (i - 1) * 2.8;
              rival.targetLateral = THREE.MathUtils.clamp(preferredLane, -6.5, 6.5);
            }

            rival.braking = targetSpeed < rival.speed - 1.8;
            const dampRate = rival.braking ? 4.2 : 2.3;
            rival.speed = THREE.MathUtils.damp(rival.speed, targetSpeed, dampRate, delta);
            rival.distance += rival.speed * delta;
            rival.lateral = THREE.MathUtils.damp(rival.lateral, rival.targetLateral, 2.5, delta);

            const trackSteer = THREE.MathUtils.clamp(-localCurv * 1.4, -0.45, 0.45);
            const laneSteer = THREE.MathUtils.clamp(-(rival.targetLateral - rival.lateral) * 0.085, -0.25, 0.25);
            rival.steerAngle = trackSteer + laneSteer;

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
              const rivalVx = _tan.x * rival.speed;
              const rivalVz = _tan.z * rival.speed;
              const relClosingVel = Math.max(0, -((playerState.vx - rivalVx) * nx + (playerState.vz - rivalVz) * nz));

              playerState.x += nx * push * 0.65;
              playerState.z += nz * push * 0.65;
              playerState.vx += nx * 8.5;
              playerState.vz += nz * 8.5;
              playerState.vx *= 0.94;
              playerState.vz *= 0.94;
              rival.speed = Math.max(16, rival.speed * 0.94);

              if (raceState.collisionCooldown <= 0) {
                const impactIntensity = THREE.MathUtils.clamp(Math.max(4, relClosingVel) / 34, 0.18, 1);
                playerState.shake = 0.14 + impactIntensity * 0.28;
                raceState.collisionCooldown = 0.28;
                audioRef.current?.playCollision(impactIntensity);
              }
            }
          } else {
            // Pre-race grid hold: brakes lit, front wheels centered
            rival.braking = true;
            rival.steerAngle = 0;
          }

          trackData.sampleAt(rival.distance, _pos, _tan, _right, _up);
          _rivalPos.copy(_pos).addScaledVector(_right, rival.lateral);
          rival.worldX = _rivalPos.x;
          rival.worldY = _rivalPos.y;
          rival.worldZ = _rivalPos.z;
          rival.tanX = _tan.x;
          rival.tanZ = _tan.z;

          placeRivalOnTrack(
            rival.rig,
            rival.distance,
            rival.lateral,
            (rival.targetLateral - rival.lateral) * 0.025,
            rival.steerAngle,
            rival.speed,
            rival.braking,
            rival.speed > 66,
            delta,
          );
        }

        // Refresh world projection after rival collisions for final Y placement & shadow light
        const finalProj = trackData.projectOntoTrack(playerState.x, playerState.z, playerState.trackIndex);
        playerState.y = THREE.MathUtils.damp(playerState.y, finalProj.position.y, 18, delta);

        const introFlash =
          raceState.phase === "INTRO" &&
          ((raceState.introTime > 3.4 && raceState.introTime < 3.62) ||
            (raceState.introTime > 3.82 && raceState.introTime < 4.04));
        const effectiveHeadlights = introFlash ? !headlightsOnRef.current : headlightsOnRef.current;
        const brakeLightActive = raceState.phase !== "RACING" || (braking && forwardSpeed > 0.2) || handbrake;
        const reverseLightActive = active && (forwardSpeed < -0.5 || (braking && forwardSpeed <= 0.5));
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
          -steering * MAX_WHEEL_STEER_RAD,
          forwardSpeed,
          effectiveHeadlights,
          brakeLightActive,
          reverseLightActive,
          canNitro,
          playerState.drifting,
          delta,
        );

        // Update key light shadow camera around player world position
        keyLight.position.set(playerState.x + 38, playerState.y + 70, playerState.z + 25);
        keyLight.target.position.set(playerState.x, playerState.y, playerState.z);
        keyLight.target.updateMatrixWorld();

        // Player basis vectors for chase camera & spatial audio listener
        _carFwd.set(-Math.sin(playerState.yaw), 0, -Math.cos(playerState.yaw));
        _carRight.set(Math.cos(playerState.yaw), 0, -Math.sin(playerState.yaw));

        _chasePos
          .set(playerState.x, playerState.y, playerState.z)
          .addScaledVector(_carFwd, -8.8)
          .addScaledVector(finalProj.up, 3.35);
        _chaseLook
          .set(playerState.x, playerState.y, playerState.z)
          .addScaledVector(_carFwd, 18)
          .addScaledVector(finalProj.up, 1.15);

        if (raceState.phase === "INTRO") {
          const t = raceState.introTime;
          if (t < 2.7) {
            // Phase 1: Aerial/drone flyover sweeping toward and just ahead of the starting grid
            const u = THREE.MathUtils.smoothstep(t / 2.7, 0, 1);
            const camDist = trackData.lapLength - THREE.MathUtils.lerp(130, -29, u);
            trackData.sampleAt(camDist, _introPos, _introTan, _introRight, _introUp);
            camera.position
              .copy(_introPos)
              .addScaledVector(_introUp, THREE.MathUtils.lerp(30, 5.4, u))
              .addScaledVector(_introRight, THREE.MathUtils.lerp(-12, 8.2, u));

            const lookDist = THREE.MathUtils.lerp(trackData.lapLength - 88, trackData.lapLength + 10, u);
            trackData.sampleAt(lookDist, _otherPos, _otherTan, _otherRight, _otherUp);
            _camLook.copy(_otherPos).addScaledVector(_otherUp, THREE.MathUtils.lerp(1.5, 1.0, u));
            camera.lookAt(_camLook);
            camera.fov = THREE.MathUtils.lerp(54, 50, u);
            camera.updateProjectionMatrix();
          } else if (t < 4.9) {
            // Phase 2: Low grid dolly past the 3 rivals settling onto a low front-3/4 hero shot of player
            const u = THREE.MathUtils.smoothstep((t - 2.7) / 2.2, 0, 1);
            const startGridDist = 29;
            trackData.sampleAt(startGridDist, _introPos, _introTan, _introRight, _introUp);
            _introPos.addScaledVector(_introUp, 5.4).addScaledVector(_introRight, 8.2);

            _heroPos
              .set(playerState.x, playerState.y, playerState.z)
              .addScaledVector(_carFwd, 5.2)
              .addScaledVector(_carRight, 3.1)
              .addScaledVector(finalProj.up, 1.15);
            _heroLook
              .set(playerState.x, playerState.y, playerState.z)
              .addScaledVector(finalProj.up, 0.72);

            // Arc gracefully along the right side of the grid at low eye level
            const midArc = Math.sin(u * Math.PI);
            camera.position.lerpVectors(_introPos, _heroPos, u);
            camera.position.y -= midArc * 2.1;
            camera.position.addScaledVector(_carRight, midArc * 2.6);

            trackData.sampleAt(10, _otherPos, _otherTan, _otherRight, _otherUp);
            _otherPos.addScaledVector(_otherUp, 1.0);
            _camLook.lerpVectors(_otherPos, _heroLook, u);
            camera.lookAt(_camLook);
            camera.fov = THREE.MathUtils.lerp(50, 48, u);
            camera.updateProjectionMatrix();
          } else {
            // Phase 3: Cubic ease-in-out sweep around the side of the player car into the chase camera
            const raw = THREE.MathUtils.clamp((t - 4.9) / (INTRO_DURATION - 4.9), 0, 1);
            const e = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;

            _heroPos
              .set(playerState.x, playerState.y, playerState.z)
              .addScaledVector(_carFwd, 5.2)
              .addScaledVector(_carRight, 3.1)
              .addScaledVector(finalProj.up, 1.15);
            _heroLook
              .set(playerState.x, playerState.y, playerState.z)
              .addScaledVector(finalProj.up, 0.72);

            camera.position.lerpVectors(_heroPos, _chasePos, e);
            camera.position.addScaledVector(_carRight, Math.sin(e * Math.PI) * 3.1);
            _camLook.lerpVectors(_heroLook, _chaseLook, e);
            camera.lookAt(_camLook);
            camera.fov = THREE.MathUtils.lerp(48, 58, e);
            camera.updateProjectionMatrix();
          }
        } else {
          // Gameplay & countdown chase camera
          const desiredFov = 58 + (playerState.speed / 96) * 14 + (canNitro ? 5 : 0);
          if (Math.abs(camera.fov - desiredFov) > 0.1) {
            camera.fov = THREE.MathUtils.damp(camera.fov, desiredFov, 6, delta);
            camera.updateProjectionMatrix();
          }

          const shakeX =
            playerState.shake > 0 || canNitro ? (Math.random() - 0.5) * (playerState.shake + (canNitro ? 0.07 : 0)) : 0;
          const shakeY =
            playerState.shake > 0 || canNitro ? (Math.random() - 0.5) * (playerState.shake + (canNitro ? 0.07 : 0)) : 0;

          _camTarget
            .copy(_chasePos)
            .addScaledVector(finalProj.up, shakeY)
            .addScaledVector(_carRight, shakeX);
          camera.position.lerp(_camTarget, 1 - Math.exp(-9.5 * delta));
          camera.lookAt(_chaseLook);
        }

        // Compute 3D spatial audio parameters for each AI rival
        let listVx = playerState.vx;
        let listVz = playerState.vz;
        if (raceState.phase === "INTRO") {
          _listenerPos.copy(camera.position);
          camera.getWorldDirection(_listenerFwd);
          _listenerFwd.y = 0;
          if (_listenerFwd.lengthSq() > 1e-4) _listenerFwd.normalize();
          _listenerRight.set(-_listenerFwd.z, 0, _listenerFwd.x);
          listVx = 0;
          listVz = 0;
        } else {
          _listenerPos.set(playerState.x, playerState.y, playerState.z);
          _listenerFwd.copy(_carFwd);
          _listenerRight.copy(_carRight);
        }

        for (let i = 0; i < rivals.length; i++) {
          const rival = rivals[i];
          _relVec.set(rival.worldX - _listenerPos.x, rival.worldY - _listenerPos.y, rival.worldZ - _listenerPos.z);
          const dist = _relVec.length();
          const pan = _relVec.dot(_listenerRight) / 14;
          const frontDot = dist > 0.1 ? _relVec.dot(_listenerFwd) / dist : 0;
          const rivalVx = rival.tanX * rival.speed;
          const rivalVz = rival.tanZ * rival.speed;
          const relClosing =
            dist > 0.2 ? -(((rivalVx - listVx) * _relVec.x + (rivalVz - listVz) * _relVec.z) / dist) : 0;
          const dopplerFactor = THREE.MathUtils.clamp(1 + relClosing / 320, 0.9, 1.12);
          rivalAudioInputs.push({
            speed: rival.speed,
            distance: dist,
            pan,
            frontDot,
            dopplerFactor,
          });
        }

        const brakingDecel = active && braking && forwardSpeed > 1.5;
        const reversingThrottle = active && braking && forwardSpeed <= 1.5;
        const latAccel = Math.abs(steering) * turnRate * steerScale * absForward;
        const cornerSlip =
          absForward > 20 && latAccel > 38 ? THREE.MathUtils.clamp((latAccel - 38) / 36, 0, 1) : 0;
        const lateralSkid =
          playerState.speed > 10 && Math.abs(lateralSpeed) > 5.5
            ? THREE.MathUtils.clamp((Math.abs(lateralSpeed) - 5.5) / 14, 0, 1)
            : 0;
        const driftIntensity = playerState.drifting
          ? THREE.MathUtils.clamp(0.55 + Math.abs(steering) * 0.35 + (absForward / 70) * 0.25, 0.45, 1)
          : 0;
        const tireSlip = Math.max(driftIntensity, cornerSlip, lateralSkid);

        audioRef.current?.updateTelemetry({
          speed: playerState.speed,
          accelerating: accelerating || reversingThrottle,
          braking: brakingDecel,
          nitroActive: canNitro,
          tireSlip,
          paused: false,
          rivals: rivalAudioInputs,
        });
      } else {
        audioRef.current?.updateTelemetry({
          speed: 0,
          accelerating: false,
          braking: false,
          nitroActive: false,
          tireSlip: 0,
          paused: true,
        });
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
          phase: raceState.phase,
          countdown: Math.ceil(raceState.countdown),
          showGo: raceState.goBannerTimer > 0,
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
      skipIntroRef.current = null;
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

  const handleCanvasTap = () => {
    if (telemetry.phase === "INTRO" && !paused) {
      skipIntroRef.current?.();
    }
  };

  return (
    <main className="racing-shell">
      <div className="racing-canvas-mount" ref={canvasMountRef} onClick={handleCanvasTap} />

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

      {(telemetry.phase !== "INTRO" || paused) && (
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
            onClick={() => setHeadlightsOn((prev) => !prev)}
            title={headlightsOn ? "Turn off headlights (L)" : "Turn on headlights (L)"}
            aria-label="Toggle headlights"
          >
            <Lightbulb size={15} />
            <span>{headlightsOn ? "Lights On" : "Lights Off"}</span>
          </button>
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
      )}

      {(telemetry.phase !== "INTRO" || paused) && (
        <>
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
        </>
      )}

      {telemetry.phase === "INTRO" && !paused && (
        <>
          <div className="intro-letterbox top" aria-hidden="true" />
          <div className="intro-letterbox bottom" aria-hidden="true" />
          <div className="intro-banner">
            <span className="eyebrow">POYY GRAND PRIX · STARTING GRID</span>
            <strong>{mode === "TIME TRIAL" ? "TIME TRIAL SOLO RUN" : "4-CAR GRID SHOWDOWN"}</strong>
          </div>
          <button className="intro-skip-btn" onClick={() => skipIntroRef.current?.()}>
            <FastForward size={15} />
            <span>Skip Intro</span>
            <kbd>SPACE</kbd>
          </button>
        </>
      )}

      {telemetry.phase === "COUNTDOWN" && telemetry.countdown > 0 && !paused && (
        <div className="race-countdown tabular-nums">{telemetry.countdown}</div>
      )}

      {telemetry.showGo && !paused && <div className="race-countdown go tabular-nums">GO!</div>}

      {telemetry.wrongWay && telemetry.phase === "RACING" && !paused && !telemetry.finished && (
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

      {(telemetry.phase !== "INTRO" || paused) && (
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
            <kbd>L</kbd> Lights
          </span>
          <span>
            <kbd>M</kbd> Mute
          </span>
          <span>
            <kbd>ESC</kbd> Pause
          </span>
          <span className="race-link-state">POYY LINK · {socket.connected ? "Connected" : "Reconnecting"}</span>
        </footer>
      )}
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
