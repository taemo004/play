// KI-Gegner: entscheidet in kurzen Abständen (Reaktionszeit), wohin sie läuft und wann sie rammt.
import { CFG, ARENAS, safeRadius, isSolid } from './sim.js';

export const DIFFICULTIES = {
  easy: { label: 'Leicht', react: 0.42, aim: 0.6, dashRange: 3.0, dashProb: 0.4, margin: 0.3, dodge: 0, speed: 0.75, recover: 0.15, power: 0.3, careful: false },
  normal: { label: 'Mittel', react: 0.24, aim: 0.3, dashRange: 3.6, dashProb: 0.7, margin: 0.9, dodge: 0.35, speed: 0.9, recover: 0.55, power: 0.6, careful: true },
  hard: { label: 'Schwer', react: 0.12, aim: 0.12, dashRange: 4.1, dashProb: 1, margin: 1.3, dodge: 0.8, speed: 1, recover: 0.95, power: 0.9, careful: true },
};

export function createBrain(diff, rng = Math.random) {
  return { d: DIFFICULTIES[diff] || DIFFICULTIES.normal, rng, t: rng() * 0.3, x: 0, z: 0, wander: rng() * Math.PI * 2 };
}

const norm = (x, z) => {
  const l = Math.hypot(x, z);
  return l > 1e-6 ? { x: x / l, z: z / l, l } : { x: 0, z: 0, l: 0 };
};

export function botThink(m, p, brain, dt) {
  brain.t -= dt;
  if (brain.t > 0) return { x: brain.x, z: brain.z, dash: false };
  const { d, rng } = brain;
  brain.t = d.react * (0.7 + rng() * 0.6);
  const out = decide(m, p, brain);
  brain.x = out.x;
  brain.z = out.z;
  return out;
}

function decide(m, p, brain) {
  const { d, rng } = brain;
  const idle = { x: 0, z: 0, dash: false };
  if (p.out || p.falling || m.phase === 'countdown') return idle;
  if (m.phase !== 'play') {
    // Nach der Runde: gemütlich zur Mitte schlendern
    brain.wander += (rng() - 0.5) * 1.5;
    const c = norm(-p.x, -p.z);
    return { x: c.x * 0.3 + Math.cos(brain.wander) * 0.25, z: c.z * 0.3 + Math.sin(brain.wander) * 0.25, dash: false };
  }
  // Auf Eis rutscht man länger – weiter vorausschauen
  const slide = 8 / ARENAS[m.arena].control;
  const safeR = safeRadius(m) - d.margin * 0.5 * Math.sqrt(slide);
  const pos = norm(p.x, p.z);
  const radial = pos.l > 1e-6 ? (p.x * p.vx + p.z * p.vz) / pos.l : 0;
  const canDash = p.cool <= 0 && p.stunT <= CFG.STUN_DASH_OK;
  const ahead = { x: p.x + p.vx * 0.3 * slide, z: p.z + p.vz * 0.3 * slide };

  // 1) Gefahr am Rand oder über einem Loch → zurück zur Mitte, notfalls mit Sprint
  const danger = pos.l > safeR - 0.4 || pos.l + Math.max(0, radial) * 0.35 * slide > safeR || (d.careful && !isSolid(m, ahead.x, ahead.z));
  if (danger) {
    const home = norm(-p.x, -p.z);
    const dash = canDash && radial > 3 && rng() < d.recover;
    return { x: home.x, z: home.z, dash };
  }

  const enemies = m.players.filter((o) => o.team !== p.team && !o.doomed && !o.out);
  if (!enemies.length) return idle;

  // 2) Ausweichen, wenn ein Gegner auf einen zurast
  for (const e of enemies) {
    if (e.dashT <= 0) continue;
    const rel = norm(p.x - e.x, p.z - e.z);
    const ev = norm(e.vx, e.vz);
    if (rel.l < 3.6 && ev.x * rel.x + ev.z * rel.z > 0.8 && rng() < d.dodge) {
      // Seitwärts – lieber zur Mitte hin
      let sx = -rel.z;
      let sz = rel.x;
      if (sx * -p.x + sz * -p.z < 0) {
        sx = -sx;
        sz = -sz;
      }
      return { x: sx, z: sz, dash: canDash && rng() < d.dodge };
    }
  }

  // Ziel: der Gegner, der am besten zu schubsen ist (nah und nah am Rand)
  let target = enemies[0];
  let best = Infinity;
  for (const e of enemies) {
    const score = Math.hypot(e.x - p.x, e.z - p.z) - Math.hypot(e.x, e.z) * 0.4;
    if (score < best) {
      best = score;
      target = e;
    }
  }
  const toT = norm(target.x - p.x, target.z - p.z);

  // 3) Power-up einsammeln, wenn es näher ist als der Gegner
  const pu = m.powerups[0];
  if (pu && rng() < d.power) {
    const toP = norm(pu.x - p.x, pu.z - p.z);
    if (toP.l < toT.l * 0.85 && Math.hypot(pu.x, pu.z) < safeR) return { x: toP.x * d.speed, z: toP.z * d.speed, dash: false };
  }

  // 4) Angriff: von der Innenseite rammen, damit der Gegner nach außen fliegt
  let outward = norm(target.x, target.z);
  if (outward.l < 0.6) outward = toT;
  const align = toT.x * outward.x + toT.z * outward.z;
  const targetEdge = Math.hypot(target.x, target.z) / Math.max(1, safeR);
  if (canDash && toT.l < d.dashRange && (align > 0.35 || (targetEdge > 0.7 && align > 0)) && rng() < d.dashProb) {
    const lead = toT.l / CFG.DASH_SPEED;
    const ax = target.x + target.vx * lead + (rng() - 0.5) * d.aim * 2;
    const az = target.z + target.vz * lead + (rng() - 0.5) * d.aim * 2;
    const aim = norm(ax - p.x, az - p.z);
    // Vorsichtige KI prüft, ob sie bei einem Fehlschuss selbst herunterfliegen würde
    const land = { x: p.x + aim.x * 3.4 * Math.sqrt(slide), z: p.z + aim.z * 3.4 * Math.sqrt(slide) };
    const risky = Math.hypot(land.x, land.z) > safeR + 0.4 || !isSolid(m, land.x, land.z);
    if (!d.careful || !risky || toT.l < 2) return { x: aim.x, z: aim.z, dash: true };
  }

  // Position hinter dem Gegner (zwischen ihm und der Mitte) einnehmen
  const behindD = 1.8;
  let gx = target.x - outward.x * behindD;
  let gz = target.z - outward.z * behindD;
  const g = norm(gx, gz);
  const maxR = safeR - 0.8;
  if (g.l > maxR) {
    gx = g.x * maxR;
    gz = g.z * maxR;
  }
  const go = norm(gx - p.x, gz - p.z);
  const sp = Math.min(1, go.l / 1.2) * d.speed;
  // etwas Zappeln, damit es lebendig wirkt
  brain.wander += (rng() - 0.5) * 0.8;
  return { x: go.x * sp + Math.cos(brain.wander) * 0.12, z: go.z * sp + Math.sin(brain.wander) * 0.12, dash: false };
}
