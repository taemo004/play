// Synthetische Soundeffekte (WebAudio) – keine Audiodateien nötig.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('ss_muted') === '1';
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggle() {
    this.muted = !this.muted;
    localStorage.setItem('ss_muted', this.muted ? '1' : '0');
    return this.muted;
  }

  tone(freq, dur, { type = 'sine', vol = 0.3, to = null, delay = 0 } = {}) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur, { vol = 0.3, type = 'lowpass', freq = 1200, to = null, q = 1, delay = 0 } = {}) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  play(name, k = 1) {
    if (this.muted || !this.ctx) return;
    switch (name) {
      case 'dash':
        this.noise(0.2, { vol: 0.25 * k, type: 'bandpass', freq: 700, to: 2600, q: 1.5 });
        break;
      case 'hit':
        this.tone(170, 0.28, { vol: 0.7 * k, to: 45 });
        this.noise(0.12, { vol: 0.5 * k, freq: 2500, to: 300 });
        this.tone(520, 0.08, { type: 'square', vol: 0.08 * k, to: 260 });
        break;
      case 'clash':
        this.tone(880, 0.25, { type: 'square', vol: 0.12 });
        this.tone(1320, 0.3, { type: 'triangle', vol: 0.15 });
        this.tone(140, 0.3, { vol: 0.6, to: 50 });
        this.noise(0.15, { vol: 0.4, type: 'highpass', freq: 2000 });
        break;
      case 'bump':
        this.tone(220, 0.1, { vol: 0.25, to: 120 });
        break;
      case 'fall':
        this.tone(1100, 0.8, { vol: 0.12, to: 180, type: 'triangle' });
        break;
      case 'splash':
        this.noise(0.8, { vol: 0.45, freq: 900, to: 120 });
        this.tone(90, 0.5, { vol: 0.4, to: 40 });
        break;
      case 'shrink':
        this.noise(0.9, { vol: 0.35, freq: 260, to: 80 });
        break;
      case 'power':
        [660, 880, 1320].forEach((f, i) => this.tone(f, 0.16, { type: 'triangle', vol: 0.2, delay: i * 0.06 }));
        break;
      case 'shock':
        this.tone(110, 0.5, { vol: 0.6, to: 35 });
        this.noise(0.4, { vol: 0.4, type: 'bandpass', freq: 400, to: 3000 });
        break;
      case 'count':
        this.tone(660, 0.14, { type: 'square', vol: 0.12 });
        break;
      case 'go':
        this.tone(990, 0.35, { type: 'square', vol: 0.14 });
        this.tone(1480, 0.35, { type: 'triangle', vol: 0.1 });
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', vol: 0.22, delay: i * 0.11 }));
        break;
      case 'lose':
        [392, 330, 262].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.2, delay: i * 0.15 }));
        break;
      case 'pop':
        this.tone(700, 0.08, { type: 'sine', vol: 0.18, to: 1200 });
        this.tone(1400, 0.06, { type: 'triangle', vol: 0.08, delay: 0.05 });
        break;
      case 'click':
        this.tone(900, 0.05, { type: 'square', vol: 0.06 });
        break;
      default:
    }
  }
}
