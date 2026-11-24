export class RacingAudioEngine {
  private ctx?: AudioContext;
  private masterGain?: GainNode;
  private engineOscA?: OscillatorNode;
  private engineOscB?: OscillatorNode;
  private engineFilter?: BiquadFilterNode;
  private engineGain?: GainNode;
  private driftGain?: GainNode;
  private nitroGain?: GainNode;
  private musicTimer?: number;
  private musicStep = 0;
  private muted = false;
  private musicEnabled = true;
  private volume = 0.55;
  private unlocked = false;

  unlock() {
    if (this.unlocked && this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const masterGain = ctx.createGain();
    masterGain.gain.value = this.muted ? 0 : this.volume;
    masterGain.connect(ctx.destination);

    // Dual-harmonic engine synthesizer
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 340;
    engineFilter.Q.value = 3.2;

    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;

    const engineOscA = ctx.createOscillator();
    engineOscA.type = "sawtooth";
    engineOscA.frequency.value = 58;

    const engineOscB = ctx.createOscillator();
    engineOscB.type = "triangle";
    engineOscB.frequency.value = 29;

    engineOscA.connect(engineFilter);
    engineOscB.connect(engineFilter);
    engineFilter.connect(engineGain).connect(masterGain);
    engineOscA.start();
    engineOscB.start();

    // Shared white-noise buffer for drift screech + nitro whoosh
    const noiseLen = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) channel[i] = Math.random() * 2 - 1;

    const driftNoise = ctx.createBufferSource();
    driftNoise.buffer = noiseBuffer;
    driftNoise.loop = true;
    const driftFilter = ctx.createBiquadFilter();
    driftFilter.type = "bandpass";
    driftFilter.frequency.value = 1450;
    driftFilter.Q.value = 4.5;
    const driftGain = ctx.createGain();
    driftGain.gain.value = 0;
    driftNoise.connect(driftFilter).connect(driftGain).connect(masterGain);
    driftNoise.start();

    const nitroNoise = ctx.createBufferSource();
    nitroNoise.buffer = noiseBuffer;
    nitroNoise.loop = true;
    const nitroFilter = ctx.createBiquadFilter();
    nitroFilter.type = "bandpass";
    nitroFilter.frequency.value = 620;
    nitroFilter.Q.value = 1.6;
    const nitroGain = ctx.createGain();
    nitroGain.gain.value = 0;
    nitroNoise.connect(nitroFilter).connect(nitroGain).connect(masterGain);
    nitroNoise.start();

    this.ctx = ctx;
    this.masterGain = masterGain;
    this.engineOscA = engineOscA;
    this.engineOscB = engineOscB;
    this.engineFilter = engineFilter;
    this.engineGain = engineGain;
    this.driftGain = driftGain;
    this.nitroGain = nitroGain;
    this.unlocked = true;

    this.startMusicLoop();
  }

  private startMusicLoop() {
    if (this.musicTimer) window.clearInterval(this.musicTimer);
    const bassNotes = [55, 55, 65.41, 73.42, 55, 55, 82.41, 73.42]; // A1 driving motorsport bassline
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx || !this.masterGain || this.muted || !this.musicEnabled || this.ctx.state !== "running") return;
      const now = this.ctx.currentTime;
      const note = bassNotes[this.musicStep % bassNotes.length];

      // Driving synth bass pulse
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(note, now);
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(520, now);
      filter.frequency.exponentialRampToValueAtTime(160, now + 0.16);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(filter).connect(gain).connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.19);

      // Subtle kick / hi-hat pulse
      if (this.musicStep % 2 === 0) {
        const kick = this.ctx.createOscillator();
        const kGain = this.ctx.createGain();
        kick.type = "sine";
        kick.frequency.setValueAtTime(125, now);
        kick.frequency.exponentialRampToValueAtTime(42, now + 0.09);
        kGain.gain.setValueAtTime(0.11, now);
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

  updateTelemetry(speed: number, nitroActive: boolean, drifting: boolean, paused: boolean) {
    if (!this.ctx || !this.engineOscA || !this.engineOscB || !this.engineFilter || !this.engineGain || !this.driftGain || !this.nitroGain) {
      return;
    }
    const now = this.ctx.currentTime;
    if (paused) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.05);
      this.driftGain.gain.setTargetAtTime(0, now, 0.05);
      this.nitroGain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    // Simulated 5-speed gearbox RPM wrap
    const normalized = Math.min(1, speed / 94);
    const gear = Math.min(4, Math.floor(normalized * 4.5));
    const gearSaw = ((normalized * 4.5) - gear) * 0.72 + 0.28;
    const baseFreq = 48 + gearSaw * 115 + (nitroActive ? 36 : 0);

    this.engineOscA.frequency.setTargetAtTime(baseFreq, now, 0.05);
    this.engineOscB.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.05);
    this.engineFilter.frequency.setTargetAtTime(280 + speed * (nitroActive ? 14 : 9), now, 0.06);
    this.engineGain.gain.setTargetAtTime(0.045 + normalized * 0.09, now, 0.06);

    this.driftGain.gain.setTargetAtTime(drifting ? 0.08 : 0, now, 0.04);
    this.nitroGain.gain.setTargetAtTime(nitroActive ? 0.09 : 0, now, 0.04);
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
    gain.gain.setValueAtTime(0.2 * Math.min(1, intensity), now);
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
    if (this.musicTimer) window.clearInterval(this.musicTimer);
    try {
      this.engineOscA?.stop();
      this.engineOscB?.stop();
    } catch {
      // ignore if already stopped
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = undefined;
    }
    this.unlocked = false;
  }
}
