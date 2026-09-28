// Arenen, Zeitlupen-Markierung und Figuren-Aussehen
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CFG, ARENAS, createMatch, stepMatch, isSolid, tileAt, encodeSnap, applySnap } from '../public/js/sim.js';
import { HATS, EXTRAS, EMPTY_STATS, isUnlocked, sanitizeLook, randomLook, newlyUnlocked } from '../public/js/looks.js';

const DT = 1 / 60;
const duel = (arena) =>
  createMatch({
    roster: [
      { id: 1, name: 'A', team: 0, look: { hat: 'krone', extra: 'none' } },
      { id: 2, name: 'B', team: 1 },
    ],
    seed: 3,
    arena,
  });
const skip = (m) => {
  while (m.phase === 'countdown') stepMatch(m, DT, new Map());
  m.events.length = 0;
};
const run = (m, s, fn = () => new Map()) => {
  for (let i = 0; i < s / DT; i++) stepMatch(m, DT, fn(i));
};

test('Auf dem Gletscher rutscht man nach dem Loslassen weiter', () => {
  const slide = (arena) => {
    const m = duel(arena);
    skip(m);
    const a = m.players[0];
    Object.assign(a, { x: -3, z: 0 });
    run(m, 0.6, () => new Map([[1, { x: 1, z: 0 }]]));
    const x0 = a.x;
    run(m, 1);
    return a.x - x0;
  };
  assert.ok(slide('eis') > slide('lava') * 2, 'deutlich längerer Bremsweg');
});

test('Karussell dreht die Arena und nimmt Spieler mit', () => {
  const m = duel('dreh');
  skip(m);
  const b = m.players[1];
  b.x = 0.2;
  b.z = 0;
  const a = m.players[0];
  Object.assign(a, { x: 0, z: 3 });
  run(m, 6, () => {
    b.x = 0.2;
    b.z = 0;
    return new Map();
  });
  assert.ok(Math.abs(m.angle) > 0.5, 'Arena hat sich gedreht');
  assert.ok(Math.abs(Math.atan2(a.x, a.z)) > 0.4, 'Spieler wurde mitgenommen');
  assert.ok(isSolid(m, a.x, a.z), 'steht weiter auf einem Feld');
  // Feld-Suche berücksichtigt die Drehung
  const t = m.tiles.find((tt) => tt.ring === 2);
  const c = Math.cos(m.angle);
  const s = Math.sin(m.angle);
  assert.equal(tileAt(m, t.x * c - t.z * s, t.x * s + t.z * c), t);
});

test('Wechselnd: jede Runde eine andere Arena', () => {
  const m = duel('mix');
  const seen = [];
  for (let r = 0; r < 3; r++) {
    seen.push(m.arena);
    skip(m);
    run(m, 2, () => new Map([[2, { x: 0, z: -1 }]]));
    run(m, CFG.ROUND_END + CFG.REPLAY_EXTRA + 0.2);
  }
  assert.equal(new Set(seen).size, 3, seen.join(','));
  const m2 = duel('mix');
  assert.ok(m2.events.some((e) => e.type === 'round' && ARENAS[e.arena]), 'Rundenstart nennt die Arena');
});

test('Entscheidender Stoß: Wiederholung wird markiert und die Pause verlängert', () => {
  const m = duel('lava');
  skip(m);
  const [a, b] = m.players;
  Object.assign(a, { x: 0, z: -3 });
  Object.assign(b, { x: 0, z: -4.8 });
  stepMatch(m, DT, new Map([[1, { x: 0, z: -1, dash: true }]]));
  run(m, 1.5);
  const end = m.events.find((e) => e.type === 'roundEnd');
  assert.ok(end, 'Runde vorbei');
  assert.deepEqual({ victim: end.replay.victim, by: end.replay.by }, { victim: 2, by: 1 });
  assert.equal(m.roundEndLen, CFG.ROUND_END + CFG.REPLAY_EXTRA);
  // Ohne Stoß heruntergelaufen: keine Wiederholung
  const m2 = duel('lava');
  skip(m2);
  run(m2, 2, () => new Map([[2, { x: 0, z: -1 }]]));
  assert.equal(m2.events.find((e) => e.type === 'roundEnd').replay, null);
  assert.equal(m2.roundEndLen, CFG.ROUND_END);
});

test('Schnappschuss überträgt Arena und Drehwinkel', () => {
  const m = duel('dreh');
  skip(m);
  run(m, 3);
  const s = encodeSnap(m, true);
  const mirror = duel('lava');
  applySnap(mirror, s, s, 1);
  assert.equal(mirror.arena, 'dreh');
  assert.ok(Math.abs(mirror.angle - m.angle) < 0.01);
});

test('Aussehen: bereinigen, zufällig, freischalten', () => {
  assert.deepEqual(sanitizeLook({ hat: 'hacker<script>', extra: 'sonnenbrille' }), { hat: 'none', extra: 'sonnenbrille' });
  assert.deepEqual(sanitizeLook(null), { hat: 'none', extra: 'none' });
  for (let i = 0; i < 20; i++) {
    const l = randomLook();
    assert.ok(HATS.some((h) => h.id === l.hat) && EXTRAS.some((e) => e.id === l.extra));
    assert.ok(!['krone', 'heiligenschein'].includes(l.hat), 'seltene Hüte nur für Menschen');
  }
  const krone = HATS.find((h) => h.id === 'krone');
  assert.equal(isUnlocked(krone, EMPTY_STATS), false);
  assert.equal(isUnlocked(krone, { ...EMPTY_STATS, hardWins: 1 }), true);
  assert.ok(isUnlocked(HATS.find((h) => h.id === 'party'), EMPTY_STATS), 'Partyhut gibt es sofort');
  const fresh = newlyUnlocked(EMPTY_STATS, { ...EMPTY_STATS, wins: 1, kos: 2 });
  assert.deepEqual(fresh.map((f) => f.id), ['zylinder']);
  assert.equal(duel('lava').players[0].look.hat, 'krone');
});
