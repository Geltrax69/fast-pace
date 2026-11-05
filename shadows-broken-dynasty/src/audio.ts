// Synthesised WebAudio SFX — no external audio files.
export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private musicTimer: number | null = null
  private musicStep = 0
  muted = false

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return }
    try {
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.5
      this.master.connect(this.ctx.destination)
      const len = this.ctx.sampleRate * 1
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const d = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    } catch { /* audio unavailable — game continues silent */ }
  }
  private noise(dur: number, filterFreq: number, type: BiquadFilterType, gain: number, sweepTo?: number) {
    if (!this.ctx || !this.master || !this.noiseBuf || this.muted) return
    const t = this.ctx.currentTime
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(filterFreq, t)
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + dur)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    src.connect(f); f.connect(g); g.connect(this.master)
    src.start(t); src.stop(t + dur + 0.05)
  }
  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0) {
    if (!this.ctx || !this.master || this.muted) return
    const t = this.ctx.currentTime + delay
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t)
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05)
  }
  whoosh() { this.noise(0.22, 1800, 'bandpass', 0.35, 300) }
  swingHeavy() { this.noise(0.35, 900, 'bandpass', 0.4, 150) }
  hitFlesh() { this.noise(0.12, 300, 'lowpass', 0.5); this.tone(90, 0.12, 'sine', 0.4, 50) }
  hitHeavy() { this.noise(0.2, 200, 'lowpass', 0.6); this.tone(60, 0.25, 'sine', 0.55, 35) }
  clash() { // metallic: bright noise + inharmonic partials
    this.noise(0.3, 5200, 'highpass', 0.28)
    this.tone(2093, 0.35, 'square', 0.08); this.tone(2637, 0.3, 'square', 0.06); this.tone(3520, 0.22, 'sine', 0.07)
  }
  parry() { // clear ring
    this.tone(1568, 0.6, 'sine', 0.22); this.tone(2093, 0.55, 'sine', 0.16); this.tone(3136, 0.4, 'sine', 0.08)
    this.noise(0.15, 6000, 'highpass', 0.2)
  }
  block() { this.tone(740, 0.18, 'square', 0.1); this.noise(0.12, 3000, 'highpass', 0.18) }
  step() { this.noise(0.07, 240, 'lowpass', 0.12) }
  roll() { this.noise(0.3, 500, 'lowpass', 0.2, 120) }
  jump() { this.noise(0.15, 700, 'bandpass', 0.15, 1400) }
  hurt() { this.tone(180, 0.2, 'sawtooth', 0.14, 70) }
  death() { this.tone(220, 0.9, 'sawtooth', 0.16, 40); this.noise(0.6, 300, 'lowpass', 0.25, 80) }
  roar() { this.tone(70, 1.1, 'sawtooth', 0.3, 38); this.tone(105, 1.0, 'sawtooth', 0.18, 55) }
  breakPot() { this.noise(0.25, 2400, 'bandpass', 0.3, 500); this.tone(1200, 0.1, 'square', 0.05, 600) }
  draw() { this.noise(0.25, 3500, 'highpass', 0.18, 900) }
  special() { this.noise(0.5, 1200, 'bandpass', 0.3, 3600); this.tone(440, 0.5, 'sine', 0.1, 880) }
  // Sparse, dark combat drone: low pentatonic plucks on a slow loop.
  startMusic(boss = false) {
    this.ensure(); if (!this.ctx || this.musicTimer !== null) return
    const scale = boss ? [110, 130.8, 146.8, 164.8, 196] : [110, 123.5, 146.8, 164.8, 185]
    const pattern = [0, 2, 1, 3, 2, 4, 3, 1, 0, 4, 2, 3]
    this.musicTimer = window.setInterval(() => {
      if (this.muted || !this.ctx) return
      const f = scale[pattern[this.musicStep % pattern.length]]
      this.tone(f, 1.4, 'triangle', 0.07)
      if (this.musicStep % 4 === 0) this.tone(f / 2, 2.2, 'sine', 0.09)
      this.musicStep++
    }, boss ? 380 : 520)
  }
  stopMusic() { if (this.musicTimer !== null) { clearInterval(this.musicTimer); this.musicTimer = null } }
}
