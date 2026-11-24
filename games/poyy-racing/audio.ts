export class RacingAudioEngine {
  private ctx?: AudioContext;
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

  private brakeGain?: GainNode;
  private driftGain?: GainNode;
  private nitroGain?: GainNode;
  private musicTimer?: number;
  private musicStep = 0;

  private smoothedSpeed = 0;
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
    const masterGain = ctx.createGain();
    masterGain.gain.value = this.muted ? 0 : this.volume;
    masterGain.connect(ctx.destination);

    // Dynamic throttle/brake tone filter (snaps open on gas, closes smoothly on brake/coast)
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 1800;
    engineFilter.Q.value = 0.55;

    const engineBusGain = ctx.createGain();
    engineBusGain.gain.value = 0.65;
    engineFilter.connect(engineBusGain).connect(masterGain);

    // Silent safety fallback oscillator
    const fallbackOsc = ctx.createOscillator();
    fallbackOsc.type = "sawtooth";
    fallbackOsc.frequency.value = 70;
    const fallbackGain = ctx.createGain();
    fallbackGain.gain.value = 0;
    fallbackOsc.connect(fallbackGain).connect(engineFilter);
    fallbackOsc.start();

    // Shared white-noise buffer for brake scrub, tire drift screech, and nitro wind
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
    brakeNoise.connect(brakeFilter).connect(brakeGain).connect(masterGain);
    brakeNoise.start();

    const driftNoise = ctx.createBufferSource();
    driftNoise.buffer = noiseBuffer;
    driftNoise.loop = true;
    const driftFilter = ctx.createBiquadFilter();
    driftFilter.type = "bandpass";
    driftFilter.frequency.value = 1480;
    driftFilter.Q.value = 4.6;
    const driftGain = ctx.createGain();
    driftGain.gain.value = 0;
    driftNoise.connect(driftFilter).connect(driftGain).connect(masterGain);
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
    nitroNoise.connect(nitroFilter).connect(nitroGain).connect(masterGain);
    nitroNoise.start();

    this.ctx = ctx;
    this.masterGain = masterGain;
    this.engineFilter = engineFilter;
    this.engineBusGain = engineBusGain;
    this.fallbackOsc = fallbackOsc;
    this.fallbackGain = fallbackGain;
    this.brakeGain = brakeGain;
    this.driftGain = driftGain;
    this.nitroGain = nitroGain;
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
  }

  playStartRoar() {
    if (!this.ctx || !this.masterGain || !this.startBuffer || this.muted || this.ctx.state !== "running") return;
    this.startPlayed = true;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.startBuffer;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.85, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + this.startBuffer.duration);
    src.connect(gain).connect(this.masterGain);
    src.start(now);
  }

  private startMusicLoop() {
    if (this.musicTimer) window.clearInterval(this.musicTimer);
    const bassNotes = [55, 55, 65.41, 73.42, 55, 55, 82.41, 73.42];
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx || !this.masterGain || this.muted || !this.musicEnabled || this.ctx.state !== "running") return;
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
      osc.connect(filter).connect(gain).connect(this.masterGain);
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
        kick.connect(kGain).connect(this.masterGain);
        kick.start(now);
        kick.stop(now + 0.12);
      }

      this.musicStep++;
    }, 190);
  }

  setSettings(muted: boolean, volumePercent: number, musicEnabled: boolean) {
    this.muted = muted;
    this.volume = Math.max(0, Math.min(1, volumePercent / 100));
    this.musicEnabled = musicEnabled;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.04);
    }
  }

  updateTelemetry(
    speed: number,
    accelerating: boolean,
    braking: boolean,
    nitroActive: boolean,
    drifting: boolean,
    paused: boolean,
  ) {
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

    if (paused) {
      this.engineBusGain.gain.setTargetAtTime(0, now, 0.04);
      this.brakeGain.gain.setTargetAtTime(0, now, 0.04);
      this.driftGain.gain.setTargetAtTime(0, now, 0.04);
      this.nitroGain.gain.setTargetAtTime(0, now, 0.04);
      return;
    }

    // Fast smoothing keeps speed-locked pitch & band sweeps tight to every gas/brake change
    const absSpeed = Math.max(0, speed);
    this.smoothedSpeed += (absSpeed - this.smoothedSpeed) * 0.45;
    const s = this.smoothedSpeed;
    const speedNorm = Math.min(1, s / 68);
    const nitroExtra = nitroActive ? Math.min(1, Math.max(0, s - 68) / 28) * 0.14 : 0;

    // Immediate throttle / brake / coast load dynamics (tau = 30ms)
    const onThrottle = accelerating || nitroActive;
    let targetFilterHz: number;
    let targetBusGain: number;

    if (onThrottle) {
      targetFilterHz = 2800 + speedNorm * 8200 + (nitroActive ? 1500 : 0);
      targetBusGain = 0.68 + speedNorm * 0.28;
    } else if (braking) {
      targetFilterHz = 780 + speedNorm * 1350;
      targetBusGain = 0.30 + speedNorm * 0.22;
    } else {
      targetFilterHz = 1400 + speedNorm * 2400;
      targetBusGain = 0.40 + speedNorm * 0.25;
    }

    this.engineFilter.frequency.setTargetAtTime(targetFilterHz, now, 0.03);
    this.engineBusGain.gain.setTargetAtTime(targetBusGain, now, 0.03);

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

      // Equal-power trigonometric crossfade locked directly to real car speed (0..68+ m/s)
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
      } else if (s < 58) {
        const t = (s - 44) / 14;
        wMid = Math.cos(t * Math.PI * 0.5);
        wEnd = Math.sin(t * Math.PI * 0.5);
      } else {
        // Max speed / max gas (>= 58 m/s): hold user's end roar continuously
        wEnd = 1;
      }

      const idleRate = 0.94 + Math.min(1, s / 12) * 0.24;
      const lowRate = 0.80 + Math.min(1, Math.max(0, s - 2) / 34) * 0.42;
      const midRate = 0.82 + Math.min(1, Math.max(0, s - 20) / 38) * 0.36;
      const endRate = 0.90 + Math.min(1, Math.max(0, s - 44) / 24) * 0.14 + nitroExtra;

      // Idle layer stays steady even at 0 speed; driving bands scale gently with load
      const loadBoost = onThrottle ? 0.92 : braking ? 0.62 : 0.72;

      this.idleSource.playbackRate.setTargetAtTime(idleRate, now, 0.03);
      this.lowSource.playbackRate.setTargetAtTime(lowRate, now, 0.03);
      this.midSource.playbackRate.setTargetAtTime(midRate, now, 0.03);
      this.endLoopSource.playbackRate.setTargetAtTime(endRate, now, 0.03);

      this.idleGain.gain.setTargetAtTime(wIdle * 0.58, now, 0.035);
      this.lowGain.gain.setTargetAtTime(wLow * 0.85 * loadBoost, now, 0.035);
      this.midGain.gain.setTargetAtTime(wMid * 0.88 * loadBoost, now, 0.035);
      this.endLoopGain.gain.setTargetAtTime(wEnd * 0.92 * loadBoost, now, 0.035);
    } else if (this.fallbackOsc && this.fallbackGain) {
      this.fallbackOsc.frequency.setTargetAtTime(65 + speedNorm * 140, now, 0.04);
      this.fallbackGain.gain.setTargetAtTime(0.05 + speedNorm * 0.06, now, 0.04);
    }

    const brakeScrub = braking && absSpeed > 5 ? Math.min(1, Math.max(0.25, absSpeed / 55)) * 0.048 : 0;
    this.brakeGain.gain.setTargetAtTime(brakeScrub, now, 0.03);
    this.driftGain.gain.setTargetAtTime(drifting ? 0.085 : 0, now, 0.04);
    this.nitroGain.gain.setTargetAtTime(nitroActive ? 0.075 : 0, now, 0.04);
  }

  playCountdownBeep(go: boolean) {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(go ? 880 : 440, now);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (go ? 0.36 : 0.16));
    osc.connect(gain).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + (go ? 0.38 : 0.18));
  }

  playCollision(intensity = 1) {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.18);
    gain.gain.setValueAtTime(0.22 * Math.min(1, intensity), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.21);
  }

  playLapChime() {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      if (!this.ctx || !this.masterGain) return;
      const now = this.ctx.currentTime + i * 0.07;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain).connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.24);
    });
  }

  playFinishFanfare() {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      if (!this.ctx || !this.masterGain) return;
      const now = this.ctx.currentTime + i * 0.1;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain).connect(this.masterGain);
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
