// Sonidos generados en el momento con Web Audio. No hay archivos de audio:
// las monedas son parciales metálicos inarmónicos con caída rápida.

let ctx = null;
let master = null;
let volume = 0.7;
let enabled = true;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setSound({ on, vol }) {
  if (on !== undefined) enabled = on;
  if (vol !== undefined) {
    volume = Math.max(0, Math.min(1, vol));
    if (master) master.gain.value = volume;
  }
}

/** Llamar en un clic: los navegadores sólo habilitan el audio después de una interacción. */
export const unlockAudio = () => { audio(); };

function clink(at, { pitch = 1, level = 0.35 } = {}) {
  const c = ctx;
  const f = (2200 + Math.random() * 1400) * pitch;
  // proporciones inarmónicas de una placa metálica chica
  const partials = [[1, 1], [2.76, 0.55], [5.4, 0.3], [8.93, 0.18]];
  const out = c.createGain();
  out.gain.setValueAtTime(0, at);
  out.gain.linearRampToValueAtTime(level, at + 0.002);
  out.gain.exponentialRampToValueAtTime(0.0008, at + 0.32 + Math.random() * 0.12);
  const pan = c.createStereoPanner ? c.createStereoPanner() : null;
  if (pan) { pan.pan.value = (Math.random() - 0.5) * 0.8; out.connect(pan); pan.connect(master); } else out.connect(master);
  for (const [ratio, amp] of partials) {
    if (f * ratio > c.sampleRate * 0.45) continue; // por encima de lo audible/representable
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * ratio, at);
    o.frequency.exponentialRampToValueAtTime(f * ratio * 0.995, at + 0.3);
    g.gain.value = amp;
    o.connect(g);
    g.connect(out);
    o.start(at);
    o.stop(at + 0.5);
  }
  // golpe corto de ruido para el "tic" del contacto
  const len = Math.floor(c.sampleRate * 0.012);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const n = c.createBufferSource();
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 5000;
  const ng = c.createGain();
  ng.gain.value = level * 0.6;
  n.buffer = buf;
  n.connect(hp); hp.connect(ng); ng.connect(out);
  n.start(at);
}

function tone(at, freq, dur, { type = 'triangle', level = 0.25 } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
  o.connect(g); g.connect(master);
  o.start(at); o.stop(at + dur + 0.05);
}

/** Lluvia de monedas. `count` entre 1 y 24 según cuánto ganaste. */
export function playCoins(count = 6, { quiet = false } = {}) {
  if (!enabled || !audio()) return;
  const n = Math.max(1, Math.min(24, Math.round(count)));
  const t0 = ctx.currentTime + 0.02;
  let t = t0;
  for (let i = 0; i < n; i++) {
    clink(t, { level: quiet ? 0.18 : 0.32 });
    if (Math.random() < 0.35) clink(t + 0.025, { pitch: 1.1, level: 0.15 });
    t += 0.045 + Math.random() * 0.06 * (1 - i / n);
  }
  // brillo final
  if (!quiet) [1568, 2093, 2637].forEach((f, i) => tone(t + 0.04 + i * 0.03, f, 0.6, { type: 'sine', level: 0.08 }));
}

export function playLevelUp() {
  if (!enabled || !audio()) return;
  const t = ctx.currentTime + 0.05;
  [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(t + i * 0.09, f, 0.5, { level: 0.22 }));
  tone(t + 0.5, 1046.5, 1.2, { type: 'sine', level: 0.15 });
  tone(t + 0.5, 1567.98, 1.2, { type: 'sine', level: 0.1 });
}

export function playAchievement() {
  if (!enabled || !audio()) return;
  const t = ctx.currentTime + 0.05;
  [880, 1174.66, 1760].forEach((f, i) => tone(t + i * 0.12, f, 0.7, { type: 'sine', level: 0.18 }));
  for (let i = 0; i < 4; i++) clink(t + 0.35 + i * 0.05, { pitch: 1.2, level: 0.15 });
}

/** Campana cuando el temporizador llega a cero. */
export function playAlarm() {
  if (!enabled || !audio()) return;
  const t = ctx.currentTime + 0.05;
  for (let r = 0; r < 3; r++) {
    tone(t + r * 0.7, 987.77, 0.6, { type: 'sine', level: 0.3 });
    tone(t + r * 0.7, 987.77 * 2.4, 0.4, { type: 'sine', level: 0.08 });
    tone(t + r * 0.7 + 0.18, 1318.5, 0.6, { type: 'sine', level: 0.25 });
  }
}

export function playStart() {
  if (!enabled || !audio()) return;
  const t = ctx.currentTime + 0.02;
  tone(t, 392, 0.18, { level: 0.18 });
  tone(t + 0.08, 587.33, 0.3, { level: 0.18 });
}
