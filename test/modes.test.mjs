// Aufladbares Rammen, Hügel halten, Rückkehr vom Himmel und Turnier
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CFG, createMatch, stepMatch, encodeSnap, applySnap } from '../public/js/sim.js';
import { createBrain, botThink } from '../public/js/ai.js';
import { STAGES, stageRoster, TOUR_WIN_ROUNDS } from '../public/js/tourney.js';
import { HATS, EXTRAS } from '../public/js/looks.js';
import { RoomHost } from '../public/js/room.js';

const DT = 1 / 60;
const duel = (opts = {}) =>
  createMatch({
    roster: [
      { id: 1, name: 'A', team: 0 },
      { id: 2, name: 'B', team: 1 },
    ],
    seed: 5,
    ...opts,
  });
const skip = (m) => {
  while (m.phase === 'countdown') stepMatch(m, DT, new Map());
  m.events.length = 0;
};
const run = (m, s, fn = () => new Map()) => {
  for (let i = 0; i < s / DT; i++) stepMatch(m, DT, fn(i));
};

function hitSpeed(chargeSeconds) {
  const m = duel();
  skip(m);
  const [a, b] = m.players;
  Object.assign(a, { x: 0, z: 2.5 });
  Object.assign(b, { x: 0, z: 0 });
  run(m, chargeSeconds, () => {
    b.x = 0;
    b.z = 0;
    return new Map([[1, { x: 0, z: 0, hold: true }]]);
  });
  const charged = a.charge;
  stepMatch(m, DT, new Map([[1, { x: 0, z: -1, dash: true, hold: false }]]));
  run(m, 0.25);
  const hit = m.events.find((e) => e.type === 'hit');
  return { charged, power: hit ? hit.power : 0, hit };
}

test('Aufladen macht den Stoß stärker, voll geladen fast doppelt', () => {
  const tap = hitSpeed(0);
  const full = hitSpeed(1.5);
  assert.equal(tap.charged, 0);
  assert.ok(Math.abs(full.charged - CFG.CHARGE_MAX) < 1e-9, 'Aufladung ist gedeckelt');
  assert.ok(full.power > tap.power * 1.7, `${full.power} vs ${tap.power}`);
  assert.equal(full.hit.charged, true);
  assert.equal(tap.hit.charged, false);
});

test('Beim Aufladen läuft man langsamer, ein Treffer bricht es ab', () => {
  const m = duel();
  skip(m);
  const a = m.players[0];
  Object.assign(a, { x: 0, z: 0 });
  run(m, 0.5, () => new Map([[1, { x: 1, z: 0, hold: true }]]));
  assert.ok(a.charging);
  assert.ok(Math.hypot(a.vx, a.vz) < CFG.SPEED * CFG.CHARGE_SLOW + 0.1);
  a.stunT = 0.3;
  stepMatch(m, DT, new Map([[1, { x: 1, z: 0, hold: true }]]));
  assert.equal(a.charge, 0);
  assert.equal(a.charging, false);
});

test('Loslassen während der Abklingzeit verpufft', () => {
  const m = duel();
  skip(m);
  const a = m.players[0];
  Object.assign(a, { x: 0, z: 0 });
  a.cool = 1;
  run(m, 0.5, () => new Map([[1, { x: 0, z: 0, hold: true }]]));
  assert.equal(a.charge, 0, 'kein Aufladen ohne bereites Rammen');
});

test('Hügel halten: Punkte nur allein auf dem Hügel, Sieg nach Zielzeit', () => {
  const m = duel({ goal: 'huegel' });
  skip(m);
  const [a, b] = m.players;
  // Rot allein auf dem Hügel
  run(m, 3, () => {
    Object.assign(a, { x: 0.3, z: 0 });
    return new Map();
  });
  assert.ok(m.hill[0] > 2.5 && m.hill[1] === 0);
  assert.equal(m.hillState, 0);
  // Beide auf dem Hügel: umkämpft, keine Punkte
  const before = m.hill[0];
  run(m, 1, () => {
    Object.assign(a, { x: 0.8, z: 0 });
    Object.assign(b, { x: -0.8, z: 0 });
    return new Map();
  });
  assert.equal(m.hillState, 2);
  assert.ok(Math.abs(m.hill[0] - before) < 0.05);
  // Arena bröckelt im Hügel-Modus nicht
  assert.equal(m.outerRing, m.rings);
  run(m, CFG.HILL_TARGET, () => {
    Object.assign(a, { x: 0.3, z: 0 });
    Object.assign(b, { x: 0, z: -4.5 });
    return new Map();
  });
  assert.deepEqual(m.score, [1, 0]);
  assert.ok(m.events.some((e) => e.type === 'roundEnd' && e.winner === 0));
});

test('Hügel halten: Runtergefallene kommen vom Himmel zurück', () => {
  const m = duel({ goal: 'huegel' });
  skip(m);
  const b = m.players[1];
  run(m, 2.5, () => new Map([[2, { x: 0, z: -1 }]]));
  assert.ok(b.out || b.doomed, 'Blau ist runtergefallen');
  assert.equal(m.phase, 'play', 'Runde läuft weiter');
  let waited = 0;
  while (!m.events.some((e) => e.type === 'respawn' && e.id === 2) && waited < 5) {
    stepMatch(m, DT, new Map());
    waited += DT;
  }
  assert.ok(waited < CFG.RESPAWN + 1, 'Rückkehr nach kurzer Zeit');
  assert.ok(!b.out && b.y > 0 && b.drop, 'fällt vom Himmel');
  run(m, 1.5);
  assert.ok(m.events.some((e) => e.type === 'land' && e.id === 2));
  assert.equal(b.y, 0);
  assert.equal(b.falling, false);
});

test('Schnappschuss überträgt Aufladen und Hügelstand', () => {
  const m = duel({ goal: 'huegel' });
  skip(m);
  run(m, 2, () => {
    Object.assign(m.players[0], { x: 0.3, z: 0 });
    return new Map([[1, { x: 0, z: 0, hold: true }]]);
  });
  const s = encodeSnap(m, true);
  const mirror = duel({ goal: 'huegel' });
  applySnap(mirror, s, s, 1);
  assert.equal(mirror.players[0].charging, true);
  assert.ok(mirror.players[0].charge > 0.5);
  assert.ok(mirror.hill[0] > 1.5);
  assert.equal(mirror.hillState, 0);
});

test('KI spielt Hügel halten 2 gegen 2 zu Ende und lädt dabei auch auf', () => {
  const roster = ['hard', 'normal', 'hard', 'normal'].map((d, i) => ({ id: i + 1, team: i % 2, bot: d }));
  const m = createMatch({ roster, seed: 11, goal: 'huegel', arena: 'mix' });
  const brains = new Map(roster.map((r) => [r.id, createBrain(r.bot, m.rng)]));
  let charged = 0;
  let steps = 0;
  while (m.phase !== 'matchEnd' && steps < 60 * 60 * 20) {
    const inputs = new Map(m.players.map((p) => [p.id, botThink(m, p, brains.get(p.id), DT)]));
    stepMatch(m, DT, inputs);
    for (const e of m.events) if (e.type === 'dash' && e.charge > 0.3) charged++;
    m.events.length = 0;
    steps++;
  }
  assert.equal(m.phase, 'matchEnd');
  assert.ok(charged > 0, 'KI nutzt aufgeladene Stöße');
});

test('Turnier: fünf Stufen, gültiges Aussehen, Riese am Ende', () => {
  assert.equal(STAGES.length, 5);
  for (const [i, st] of STAGES.entries()) {
    assert.ok(HATS.some((h) => h.id === st.look.hat) && EXTRAS.some((e) => e.id === st.look.extra), st.name);
    const roster = stageRoster(i, { name: 'Ich', look: { hat: 'party', extra: 'none' } });
    const m = createMatch({ roster, arena: st.arena, goal: st.goal, winRounds: TOUR_WIN_ROUNDS });
    assert.equal(m.winRounds, 2);
    assert.equal(m.players[1].bot, st.diff);
  }
  const boss = createMatch({ roster: stageRoster(4, { name: 'Ich', look: {} }) }).players[1];
  assert.ok(boss.radius > CFG.PR * 1.3 && boss.mass > 1.2, 'Boss ist groß und schwer');
  // Koloss-Power-up und Rundenstart behalten die Grundgröße
  boss.heavyT = 0.01;
  boss.mass = 5;
  const m = createMatch({ roster: stageRoster(4, { name: 'Ich', look: {} }) });
  assert.ok(Math.abs(m.players[1].radius - CFG.PR * STAGES[4].size) < 1e-9);
});

test('Raum: Spielziel wählen und Halten wird übertragen', () => {
  const room = new RoomHost('HILL');
  const box = [];
  const h = room.addClient(() => {}, true);
  room.handle(h, { t: 'hello', name: 'Host' });
  const a = room.addClient((m) => box.push(m));
  room.handle(a, { t: 'hello', name: 'Anna' });
  room.handle(h, { t: 'settings', goal: 'huegel' });
  room.handle(h, { t: 'settings', goal: 'quatsch' });
  assert.equal(room.goal, 'huegel');
  room.handle(h, { t: 'start' });
  assert.equal([...box].reverse().find((m) => m.t === 'start').goal, 'huegel');
  assert.equal(room.match.goal, 'huegel');
  for (let i = 0; i < 200; i++) room.update(DT);
  room.handle(a, { t: 'in', x: 0, z: 0, d: 0, h: 1 });
  for (let i = 0; i < 30; i++) room.update(DT);
  const p = room.match.players.find((pl) => pl.id === a);
  assert.ok(p.charging && p.charge > 0.3, 'Gast lädt auf');
  room.handle(a, { t: 'in', x: 0, z: 1, d: 1, h: 0 });
  const ev = [];
  for (let i = 0; i < 5; i++) ev.push(...room.update(DT));
  assert.ok(ev.some((e) => e.type === 'dash' && e.id === a && e.charge > 0.3), 'geladener Stoß beim Loslassen');
  room.destroy();
});
