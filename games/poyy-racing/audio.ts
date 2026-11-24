export type RivalAudioInput = {
  speed: number;
  distance: number;
  pan: number;
  frontDot: number;
  dopplerFactor: number;
};

export type EngineTelemetryInput = {
  speed: number;
  accelerating: boolean;
  braking: boolean;
  nitroActive: boolean;
  tireSlip: number;
  paused: boolean;
  rivals?: RivalAudioInput[];
};

const RIVAL_CHARACTERS = [
  { basePitch: 0.93, baseFilterHz: 2350, loopOffset: 0.04 }, // Cobalt Apex (deep V12)
  { basePitch: 1.04, baseFilterHz: 3200, loopOffset: 0.16 }, // Solar GT (raspy GT)
  { basePitch: 1.13, baseFilterHz: 2750, loopOffset: 0.27 }, // Emerald V8 (high-rev V8)
] as const;

const UPSHIFT_SPEEDS = [11.5, 22.5, 34.0, 45.5, 57.0]; // m/s: 1->2, 2->3, 3->4, 4->5, 5->6
const DOWNSHIFT_SPEEDS = [7.5, 17.5, 28.5, 40.0, 51.5]; // m/s: 2->1, 3->2, 4->3, 5->4, 6->5
const GEAR_WINDOWS: ReadonlyArray<readonly [number, number]> = [
  [0, 12.5],
  [7.0, 23.5],
  [17.0, 35.0],
  [28.0, 46.5],
  [39.5, 58.0],
  [51.0, 72.0],
];

export class RacingAudioEngine {
  private ctx?: AudioContext;
  private mixBus?: GainNode;
  private compressor?: DynamicsCompressorNode;
  private masterGain?: GainNode;

  // Fallback synth only if WAV assets fail to load
  private fallbackOsc?: OscillatorNode;
  private fallbackGain?: GainNode;

  // Real audio buffers from user's uploaded Lamborghini recordings
  private startBuffer?: AudioBuffer;
  private idleBuffer?: AudioBuffer;
  private lowBuffer?: AudioBuffer;
  private midBuffer?: AudioBuffer;
  private endLoopBuffer?: AudioBuffer;

  private engineFilter?: BiquadFilterNode;
  private engineBusGain?: GainNode;

  private idleSource?: AudioBufferSourceNode;
  private idleGain?: GainNode;

  private lowSource?: AudioBufferSourceNode;
  private lowGain?: GainNode;

  private midSource?: AudioBufferSourceNode;
  private midGain?: GainNode;

  private endLoopSource?: AudioBufferSourceNode;
  private endLoopGain?: GainNode;

  // 3 independent spatialized AI rival engine channels
  private rivalChannels: Array<{
    source: AudioBufferSourceNode;
    filter: BiquadFilterNode;
    panner: StereoPannerNode;
    gain: GainNode;
    basePitch: number;
    baseFilterHz: number;
  }> = [];

  private brakeGain?: GainNode;
  private driftGain?: GainNode;
  private driftFilterLow?: BiquadFilterNode;
  private driftFilterHigh?: BiquadFilterNode;
  private nitroGain?: GainNode;
  private musicTimer?: number;
  private musicStep = 0;

  // Real-time vehicle & transmission state
  private smoothedSpeed = 0;
  private currentGear = 1;
  private shiftTimer = 0;
  private shiftTotal = 0.1;
  private shiftType: "up" | "down" = "up";
  private shiftCooldown = 0;
  private lastTelemetryTime = 0;

  // Cooldown guards to avoid audio stacking / clipping
  private lastCollisionAt = -1;
  private lastBeepAt = -1;
  private lastChimeAt = -1;

  private startPlayed = false;
  private samplesReady = false;
  private muted = false;
  private musicEnabled = true;
  private volume = 0.55;
  private unlocked = false;
  private disposed = false;

  unlock() {
    if (this.disposed) return;
    if (this.unlocked && this.ctx) {
      if (this.ctx.state === "suspended") {
        void this.ctx.resume().then(() => {
          if (!this.startPlayed && !this.disposed) this.playStartRoar();
        });
      }
      return;
    }

    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();

    // Anti-clipping master bus: mixBus -> compressor -> masterGain -> destination
    const mixBus = ctx.createGain();
    mixBus.gain.value = 1;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.knee.value = 12;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.12;

    const masterGain = ctx.createGain();
    masterGain.gain.value = this.muted ? 0 : this.volume;

    mixBus.connect(compressor).connect(masterGain).connect(ctx.destination);

    // Dynamic throttle/brake tone filter (snaps open on gas, closes smoothly on brake/coast)
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 1800;
    engineFilter.Q.value = 0.55;

    const engineBusGain = ctx.createGain();
    engineBusGain.gain.value = 0.65;
    engineFilter.connect(engineBusGain).connect(mixBus);

    // Silent safety fallback oscillator
    const fallbackOsc = ctx.createOscillator();
    fallbackOsc.type = "sawtooth";
    fallbackOsc.frequency.value = 70;
    const fallbackGain = ctx.createGain();
    fallbackGain.gain.value = 0;
    fallbackOsc.connect(fallbackGain).connect(engineFilter);
    fallbackOsc.start();

    // Shared white-noise buffer for brake scrub, dual-band tire screech, and nitro wind
    const noiseLen = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) channel[i] = Math.random() * 2 - 1;

    const brakeNoise = ctx.createBufferSource();
    brakeNoise.buffer = noiseBuffer;
    brakeNoise.loop = true;
    const brakeFilter = ctx.createBiquadFilter();
    brakeFilter.type = "bandpass";
    brakeFilter.frequency.value = 2350;
    brakeFilter.Q.value = 2.4;
    const brakeGain = ctx.createGain();
    brakeGain.gain.value = 0;
    brakeNoise.connect(brakeFilter).connect(brakeGain).connect(mixBus);
    brakeNoise.start();

    // Dual resonant tire screech bands driven by real slip / sharp steering
    const driftNoise = ctx.createBufferSource();
    driftNoise.buffer = noiseBuffer;
    driftNoise.loop = true;

    const driftFilterLow = ctx.createBiquadFilter();
    driftFilterLow.type = "bandpass";
    driftFilterLow.frequency.value = 1280;
    driftFilterLow.Q.value = 5.5;

    const driftFilterHigh = ctx.createBiquadFilter();
    driftFilterHigh.type = "bandpass";
    driftFilterHigh.frequency.value = 2180;
    driftFilterHigh.Q.value = 6.8;

    const driftGain = ctx.createGain();
    driftGain.gain.value = 0;

    driftNoise.connect(driftFilterLow).connect(driftGain);
    driftNoise.connect(driftFilterHigh).connect(driftGain);
    driftGain.connect(mixBus);
    driftNoise.start();

    const nitroNoise = ctx.createBufferSource();
    nitroNoise.buffer = noiseBuffer;
    nitroNoise.loop = true;
    const nitroFilter = ctx.createBiquadFilter();
    nitroFilter.type = "bandpass";
    nitroFilter.frequency.value = 720;
    nitroFilter.Q.value = 1.5;
    const nitroGain = ctx.createGain();
    nitroGain.gain.value = 0;
    nitroNoise.connect(nitroFilter).connect(nitroGain).connect(mixBus);
    nitroNoise.start();

    this.ctx = ctx;
    this.mixBus = mixBus;
    this.compressor = compressor;
    this.masterGain = masterGain;
    this.engineFilter = engineFilter;
    this.engineBusGain = engineBusGain;
    this.fallbackOsc = fallbackOsc;
    this.fallbackGain = fallbackGain;
    this.brakeGain = brakeGain;
    this.driftGain = driftGain;
    this.driftFilterLow = driftFilterLow;
    this.driftFilterHigh = driftFilterHigh;
    this.nitroGain = nitroGain;
    this.lastTelemetryTime = ctx.currentTime;
    this.unlocked = true;

    void this.loadLamborghiniSamples(ctx, engineFilter);
    this.startMusicLoop();
  }

  private createLoopLayer(ctx: AudioContext, buffer: AudioBuffer, destination: AudioNode) {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain).connect(destination);
    source.start(0);
    return { source, gain };
  }

  private async loadLamborghiniSamples(ctx: AudioContext, destination: AudioNode) {
    try {
      const urls = [
        "/audio/lambo-start.wav",
        "/audio/lambo-idle.wav",
        "/audio/lambo-low.wav",
        "/audio/lambo-mid.wav",
        "/audio/lambo-end-loop.wav",
      ];
      const buffers = await Promise.all(
        urls.map(async (url) => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
          const arr = await res.arrayBuffer();
          return ctx.decodeAudioData(arr);
        }),
      );
      if (this.disposed || this.ctx !== ctx) return;

      this.startBuffer = buffers[0];
      this.idleBuffer = buffers[1];
      this.lowBuffer = buffers[2];
      this.midBuffer = buffers[3];
      this.endLoopBuffer = buffers[4];

      // 4 speed-locked continuous loop bands running in phase-free equal-power crossfade
      const idle = this.createLoopLayer(ctx, this.idleBuffer, destination);
      this.idleSource = idle.source;
      this.idleGain = idle.gain;

      const low = this.createLoopLayer(ctx, this.lowBuffer, destination);
      this.lowSource = low.source;
      this.lowGain = low.gain;

      const mid = this.createLoopLayer(ctx, this.midBuffer, destination);
      this.midSource = mid.source;
      this.midGain = mid.gain;

      const endLoop = this.createLoopLayer(ctx, this.endLoopBuffer, destination);
      this.endLoopSource = endLoop.source;
      this.endLoopGain = endLoop.gain;

      // 3 independent AI rival spatial engine channels using distinct offsets & timbres
      if (this.mixBus) {
        this.rivalChannels = RIVAL_CHARACTERS.map((char) => {
          const source = ctx.createBufferSource();
          source.buffer = this.midBuffer!;
          source.loop = true;

          const filter = ctx.createBiquadFilter();
          filter.type = "lowpass";
          filter.frequency.value = char.baseFilterHz;
          filter.Q.value = 0.65;

          const panner = ctx.createStereoPanner();
          panner.pan.value = 0;

          const gain = ctx.createGain();
          gain.gain.value = 0;

          source.connect(filter).connect(panner).connect(gain).connect(this.mixBus!);
          const safeOffset = Math.min(Math.max(0, char.loopOffset), Math.max(0, this.midBuffer!.duration - 0.05));
          source.start(0, safeOffset);

          return {
            source,
            filter,
            panner,
            gain,
            basePitch: char.basePitch,
            baseFilterHz: char.baseFilterHz,
          };
        });
      }

      this.samplesReady = true;
      if (!this.startPlayed) {
        this.playStartRoar();
      }
    } catch (err) {
      console.warn("Unable to decode Lamborghini WAV assets:", err);
    }
  }

  resetTransmission() {
    this.smoothedSpeed = 0;
    this.currentGear = 1;
    this.shiftTimer = 0;
    this.shiftCooldown = 0;
  }

  playStartRoar() {
    if (!this.ctx || !this.mixBus || !this.startBuffer || this.muted || this.ctx.state !== "running") return;
    this.startPlayed = true;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.startBuffer;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.85, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + this.startBuffer.duration);
    src.connect(gain).connect(this.mixBus);
    src.start(now);
  }

  private startMusicLoop() {
    if (this.musicTimer) window.clearInterval(this.musicTimer);
    const bassNotes = [55, 55, 65.41, 73.42, 55, 55, 82.41, 73.42];
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx || !this.mixBus || this.muted || !this.musicEnabled || this.ctx.state !== "running") return;
      const now = this.ctx.currentTime;
      const note = bassNotes[this.musicStep % bassNotes.length];

      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(note, now);
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(440, now);
      filter.frequency.exponentialRampToValueAtTime(140, now + 0.16);
      gain.gain.setValueAtTime(0.036, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(filter).connect(gain).connect(this.mixBus);
      osc.start(now);
      osc.stop(now + 0.19);

      if (this.musicStep % 2 === 0) {
        const kick = this.ctx.createOscillator();
        const kGain = this.ctx.createGain();
        kick.type = "sine";
        kick.frequency.setValueAtTime(120, now);
        kick.frequency.exponentialRampToValueAtTime(42, now + 0.09);
        kGain.gain.setValueAtTime(0.07, now);
        kGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
        kick.connect(kGain).connect(this.mixBus);
        kick.start(now);
        kick.stop(now + 0.12);
      }

      this.musicStep++;
    }, 190);
  }

  mute() {
    this.setSettings(true, this.volume * 100, this.musicEnabled);
  }

  unmute() {
    this.setSettings(false, this.volume * 100, this.musicEnabled);
  }

  toggleMute() {
    this.setSettings(!this.muted, this.volume * 100, this.musicEnabled);
    return this.muted;
  }

  isMuted() {
    return this.muted;
  }

  setSettings(muted: boolean, volumePercent: number, musicEnabled: boolean) {
    this.muted = muted;
    this.volume = Math.max(0, Math.min(1, volumePercent / 100));
    this.musicEnabled = musicEnabled;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.03);
    }
  }

  updateTelemetry(input: EngineTelemetryInput) {
    if (
      !this.ctx ||
      !this.engineFilter ||
      !this.engineBusGain ||
      !this.brakeGain ||
      !this.driftGain ||
      !this.nitroGain
    ) {
      return;
    }

    const now = this.ctx.currentTime;
    const dt = Math.min(0.1, Math.max(0, now - this.lastTelemetryTime));
    this.lastTelemetryTime = now;

    if (input.paused) {
      this.engineBusGain.gain.setTargetAtTime(0, now, 0.04);
      this.brakeGain.gain.setTargetAtTime(0, now, 0.03);
      this.driftGain.gain.setTargetAtTime(0, now, 0.025);
      this.nitroGain.gain.setTargetAtTime(0, now, 0.03);
      for (const ch of this.rivalChannels) {
        ch.gain.gain.setTargetAtTime(0, now, 0.04);
      }
      return;
    }

    // Smooth real-time speed tracking (responsive for instant gas & brake feedback)
    const absSpeed = Math.max(0, input.speed);
    this.smoothedSpeed += (absSpeed - this.smoothedSpeed) * 0.42;
    const s = this.smoothedSpeed;
    const speedNorm = Math.min(1, s / 68);
    const nitroExtra = input.nitroActive ? Math.min(1, Math.max(0, s - 68) / 28) * 0.12 : 0;

    // 6-speed gearbox with hysteresis & cooldown (no gear hunting at max gas)
    this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);
    if (this.shiftCooldown <= 0) {
      if (this.currentGear < 6 && s >= UPSHIFT_SPEEDS[this.currentGear - 1]) {
        this.currentGear += 1;
        this.shiftType = "up";
        this.shiftTotal = 0.115;
        this.shiftTimer = 0.115;
        this.shiftCooldown = 0.26;
      } else if (this.currentGear > 1 && s <= DOWNSHIFT_SPEEDS[this.currentGear - 2]) {
        this.currentGear -= 1;
        this.shiftType = "down";
        this.shiftTotal = 0.085;
        this.shiftTimer = 0.085;
        this.shiftCooldown = 0.26;
      }
    }

    // Brief clutch/throttle pause & pitch dip during gear change
    let shiftGainMul = 1;
    let shiftPitchMul = 1;
    if (this.shiftTimer > 0) {
      this.shiftTimer = Math.max(0, this.shiftTimer - dt);
      const u = 1 - this.shiftTimer / this.shiftTotal;
      const cutEnv = Math.sin(u * Math.PI);
      shiftGainMul = 1 - cutEnv * (this.shiftType === "up" ? 0.44 : 0.28);
      shiftPitchMul = 1 - cutEnv * (this.shiftType === "up" ? 0.13 : 0.075);
    }

    // Compute normalized in-gear RPM (0..1)
    const [gMin, gMax] = GEAR_WINDOWS[this.currentGear - 1];
    const inGearProgress = Math.min(1, Math.max(0, (s - gMin) / Math.max(1, gMax - gMin)));
    const rpmBias = this.currentGear < 6 ? (inGearProgress - 0.48) * 0.075 : inGearProgress * 0.05;

    // Immediate throttle / brake / coast dynamics
    const onThrottle = input.accelerating || input.nitroActive;
    let targetFilterHz: number;
    let targetBusGain: number;

    if (onThrottle) {
      targetFilterHz = 2800 + speedNorm * 8200 + (input.nitroActive ? 1500 : 0);
      targetBusGain = (0.64 + speedNorm * 0.32) * shiftGainMul;
    } else if (input.braking) {
      targetFilterHz = 760 + speedNorm * 1350;
      targetBusGain = (0.28 + speedNorm * 0.22) * shiftGainMul;
    } else {
      targetFilterHz = 1350 + speedNorm * 2350;
      targetBusGain = (0.38 + speedNorm * 0.24) * shiftGainMul;
    }

    const filterTau = this.shiftTimer > 0 ? 0.018 : 0.03;
    this.engineFilter.frequency.setTargetAtTime(targetFilterHz, now, filterTau);
    this.engineBusGain.gain.setTargetAtTime(targetBusGain, now, filterTau);

    if (
      this.samplesReady &&
      this.idleSource &&
      this.idleGain &&
      this.lowSource &&
      this.lowGain &&
      this.midSource &&
      this.midGain &&
      this.endLoopSource &&
      this.endLoopGain
    ) {
      this.fallbackGain?.gain.setTargetAtTime(0, now, 0.04);

      // Equal-power trigonometric crossfade locked directly to car speed (0..68+ m/s)
      let wIdle = 0;
      let wLow = 0;
      let wMid = 0;
      let wEnd = 0;

      if (s < 3) {
        wIdle = 1;
      } else if (s < 12) {
        const t = (s - 3) / 9;
        wIdle = Math.cos(t * Math.PI * 0.5);
        wLow = Math.sin(t * Math.PI * 0.5);
      } else if (s < 22) {
        wLow = 1;
      } else if (s < 36) {
        const t = (s - 22) / 14;
        wLow = Math.cos(t * Math.PI * 0.5);
        wMid = Math.sin(t * Math.PI * 0.5);
      } else if (s < 44) {
        wMid = 1;
      } else if (s < 57) {
        const t = (s - 44) / 13;
        wMid = Math.cos(t * Math.PI * 0.5);
        wEnd = Math.sin(t * Math.PI * 0.5);
      } else {
        // Max speed / max gas (>= 57 m/s): hold user's end roar continuously with zero extra shifts
        wEnd = 1;
      }

      const idleRate = (0.94 + Math.min(1, s / 12) * 0.22) * shiftPitchMul;
      const lowRate = Math.max(0.65, (0.81 + Math.min(1, Math.max(0, s - 2) / 34) * 0.36 + rpmBias) * shiftPitchMul);
      const midRate = Math.max(0.68, (0.83 + Math.min(1, Math.max(0, s - 20) / 38) * 0.32 + rpmBias) * shiftPitchMul);
      const endRate = Math.max(
        0.75,
        (0.91 + Math.min(1, Math.max(0, s - 44) / 24) * 0.13 + nitroExtra + rpmBias * 0.5) * shiftPitchMul,
      );

      const loadBoost = onThrottle ? 0.94 : input.braking ? 0.60 : 0.72;
      const rateTau = this.shiftTimer > 0 ? 0.018 : 0.03;

      this.idleSource.playbackRate.setTargetAtTime(idleRate, now, rateTau);
      this.lowSource.playbackRate.setTargetAtTime(lowRate, now, rateTau);
      this.midSource.playbackRate.setTargetAtTime(midRate, now, rateTau);
      this.endLoopSource.playbackRate.setTargetAtTime(endRate, now, rateTau);

      this.idleGain.gain.setTargetAtTime(wIdle * 0.58, now, 0.032);
      this.lowGain.gain.setTargetAtTime(wLow * 0.85 * loadBoost, now, 0.032);
      this.midGain.gain.setTargetAtTime(wMid * 0.88 * loadBoost, now, 0.032);
      this.endLoopGain.gain.setTargetAtTime(wEnd * 0.92 * loadBoost, now, 0.032);
    } else if (this.fallbackOsc && this.fallbackGain) {
      this.fallbackOsc.frequency.setTargetAtTime((65 + speedNorm * 140) * shiftPitchMul, now, 0.035);
      this.fallbackGain.gain.setTargetAtTime((0.05 + speedNorm * 0.06) * shiftGainMul, now, 0.035);
    }

    // Brake disc / tire deceleration scrub when actively braking above 5 m/s
    const brakeScrub = input.braking && absSpeed > 5 ? Math.min(1, Math.max(0.25, absSpeed / 55)) * 0.048 : 0;
    this.brakeGain.gain.setTargetAtTime(brakeScrub, now, 0.028);

    // Tire screech tied directly to real tire slip / sharp high-speed cornering, cuts off rapidly when traction returns
    const slip = Math.min(1, Math.max(0, input.tireSlip));
    if (this.driftFilterLow && this.driftFilterHigh) {
      this.driftFilterLow.frequency.setTargetAtTime(1180 + slip * 360, now, 0.03);
      this.driftFilterHigh.frequency.setTargetAtTime(2040 + slip * 480, now, 0.03);
    }
    this.driftGain.gain.setTargetAtTime(slip > 0.02 ? slip * 0.095 : 0, now, slip > 0.02 ? 0.035 : 0.022);

    this.nitroGain.gain.setTargetAtTime(input.nitroActive ? 0.075 : 0, now, 0.035);

    // Update 3D spatialized AI rival engine channels independently
    const MAX_RIVAL_AUDIO_RADIUS = 75;
    for (let i = 0; i < this.rivalChannels.length; i++) {
      const ch = this.rivalChannels[i];
      const rival = input.rivals?.[i];
      if (!rival || rival.distance >= MAX_RIVAL_AUDIO_RADIUS) {
        ch.gain.gain.setTargetAtTime(0, now, 0.05);
        continue;
      }

      const normDist = Math.max(0, 1 - rival.distance / MAX_RIVAL_AUDIO_RADIUS);
      const attenuation = Math.pow(normDist, 1.25);
      const targetGain = attenuation * 0.65;

      const speedRatio = Math.min(1.15, Math.max(0, rival.speed / 68));
      const targetRate = Math.max(0.58, (0.72 + speedRatio * 0.46) * ch.basePitch * rival.dopplerFactor);
      const frontEq = rival.frontDot >= 0 ? 1.0 + rival.frontDot * 0.16 : 0.72 + (1 + rival.frontDot) * 0.28;
      const targetFilterHz = ch.baseFilterHz * (0.65 + speedRatio * 0.62) * frontEq;
      const clampedPan = Math.min(0.95, Math.max(-0.95, rival.pan));

      ch.source.playbackRate.setTargetAtTime(targetRate, now, 0.04);
      ch.filter.frequency.setTargetAtTime(targetFilterHz, now, 0.04);
      ch.panner.pan.setTargetAtTime(clampedPan, now, 0.035);
      ch.gain.gain.setTargetAtTime(targetGain, now, 0.04);
    }
  }

  playCountdownBeep(go: boolean) {
    if (!this.ctx || !this.mixBus || this.muted || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    if (now - this.lastBeepAt < 0.25) return;
    this.lastBeepAt = now;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(go ? 880 : 440, now);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (go ? 0.36 : 0.16));
    osc.connect(gain).connect(this.mixBus);
    osc.start(now);
    osc.stop(now + (go ? 0.38 : 0.18));
  }

  playCollision(impactIntensity = 0.6) {
    if (!this.ctx || !this.mixBus || this.muted || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    // Cooldown guard prevents rapid wall/car scrapes from stacking and clipping
    if (now - this.lastCollisionAt < 0.16) return;
    this.lastCollisionAt = now;

    const clamped = Math.min(1, Math.max(0.08, impactIntensity));

    // Low chassis impact thud
    const thud = this.ctx.createOscillator();
    const thudGain = this.ctx.createGain();
    thud.type = "sawtooth";
    thud.frequency.setValueAtTime(95 + clamped * 75, now);
    thud.frequency.exponentialRampToValueAtTime(34, now + 0.16 + clamped * 0.08);
    thudGain.gain.setValueAtTime(0.24 * clamped, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18 + clamped * 0.08);
    thud.connect(thudGain).connect(this.mixBus);
    thud.start(now);
    thud.stop(now + 0.27);

    // Metallic body crunch burst scaled by impact velocity
    const burstLen = Math.floor(this.ctx.sampleRate * 0.12);
    const burstBuf = this.ctx.createBuffer(1, burstLen, this.ctx.sampleRate);
    const data = burstBuf.getChannelData(0);
    for (let i = 0; i < burstLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp((-i / burstLen) * 5);
    }
    const burst = this.ctx.createBufferSource();
    burst.buffer = burstBuf;
    const crunchFilter = this.ctx.createBiquadFilter();
    crunchFilter.type = "bandpass";
    crunchFilter.frequency.value = 600 + clamped * 900;
    crunchFilter.Q.value = 1.2;
    const burstGain = this.ctx.createGain();
    burstGain.gain.setValueAtTime(0.2 * clamped, now);
    burstGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    burst.connect(crunchFilter).connect(burstGain).connect(this.mixBus);
    burst.start(now);
  }

  playLapChime() {
    if (!this.ctx || !this.mixBus || this.muted || this.ctx.state !== "running") return;
    const baseNow = this.ctx.currentTime;
    if (baseNow - this.lastChimeAt < 0.25) return;
    this.lastChimeAt = baseNow;

    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      if (!this.ctx || !this.mixBus) return;
      const now = baseNow + i * 0.07;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain).connect(this.mixBus);
      osc.start(now);
      osc.stop(now + 0.24);
    });
  }

  playFinishFanfare() {
    if (!this.ctx || !this.mixBus || this.muted || this.ctx.state !== "running") return;
    const baseNow = this.ctx.currentTime;
    if (baseNow - this.lastChimeAt < 0.25) return;
    this.lastChimeAt = baseNow;

    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      if (!this.ctx || !this.mixBus) return;
      const now = baseNow + i * 0.1;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain).connect(this.mixBus);
      osc.start(now);
      osc.stop(now + 0.37);
    });
  }

  dispose() {
    this.disposed = true;
    if (this.musicTimer) window.clearInterval(this.musicTimer);
    try {
      this.fallbackOsc?.stop();
      this.idleSource?.stop();
      this.lowSource?.stop();
      this.midSource?.stop();
      this.endLoopSource?.stop();
      for (const ch of this.rivalChannels) {
        ch.source.stop();
      }
      this.rivalChannels = [];
    } catch {
      // ignore if already stopped
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = undefined;
    }
    this.samplesReady = false;
    this.unlocked = false;
  }
}
