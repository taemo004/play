// Spiellogik: Raster, Physik, Treffer, Bröckeln, Runden – und ob die KI ganze Partien zu Ende spielt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CFG, createMatch, stepMatch, hexToPoint, pointToHex, buildTiles, isSolid, encodeSnap, applySnap, applyTiles, tilesString } from '../public/js/sim.js';
import { createBrain, botThink } from '../public/js/ai.js';

const DT = 1 / 60;
const duel = (extra = {}) =>
  createMatch({
    roster: [
      { id: 1, name: 'A', team: 0 },
      { id: 2, name: 'B', team: 1 },
    ],
    seed: 7,
    ...extra,
  });

function skipCountdown(m) {
  while (m.phase === 'countdown') stepMatch(m, DT, new Map());
  m.events.length = 0;
}

function run(m, seconds, inputFn = () => new Map()) {
  for (let i = 0; i < seconds / DT; i++) stepMatch(m, DT, inputFn(i));
}

test('Sechseck-Raster: Umrechnung hin und zurück, Anzahl Felder', () => {
  for (let q = -5; q <= 5; q++) {
    for (let r = -5; r <= 5; r++) {
      const { x, z } = hexToPoint(q, r);
      assert.deepEqual(pointToHex(x + 0.3, z - 0.2), { q, r });
    }
  }
  assert.equal(buildTiles(4).length, 1 + 3 * 4 * 5);
  assert.equal(buildTiles(5).length, 1 + 3 * 5 * 6);
});

test('Arenagröße hängt vom Modus ab, Teams starten gegenüber', () => {
  const m = duel();
  assert.equal(m.rings, 4);
  const [a, b] = m.players;
  assert.ok(a.z > 2 && b.z < -2, 'Rot unten, Blau oben');
  assert.ok(isSolid(m, a.x, a.z) && isSolid(m, b.x, b.z));
  const big = createMatch({ roster: [0, 1, 2, 3].map((i) => ({ id: i + 1, team: i % 2 })) });
  assert.equal(big.rings, 5);
  for (const p of big.players) assert.ok(isSolid(big, p.x, p.z));
  const [p1, , p3] = big.players;
  assert.ok(Math.hypot(p1.x - p3.x, p1.z - p3.z) > 2 * CFG.PR, 'Teamkollegen überlappen nicht');
});

test('Im Countdown kann sich niemand bewegen', () => {
  const m = duel();
  const z0 = m.players[0].z;
  run(m, 1, () => new Map([[1, { x: 0, z: -1, dash: true }]]));
  assert.equal(m.phase, 'countdown');
  assert.equal(m.players[0].z, z0);
});

test('Laufen über die Kante: Spieler fällt, Gegner gewinnt die Runde', () => {
  const m = duel();
  skipCountdown(m);
  run(m, 2, () => new Map([[1, { x: 0, z: 1 }]]));
  const a = m.players[0];
  assert.ok(a.doomed, 'Spieler ist gefallen');
  assert.equal(m.phase, 'roundEnd');
  assert.deepEqual(m.score, [0, 1]);
  const fall = m.events.find((e) => e.type === 'fall');
  assert.equal(fall.by, null, 'ohne Treffer kein K.O.');
});

test('Rammen schleudert den Gegner weg und zählt als K.O.', () => {
  const m = duel();
  skipCountdown(m);
  const [a, b] = m.players;
  Object.assign(a, { x: 0, z: 1.5 });
  Object.assign(b, { x: 0, z: -0.3 });
  stepMatch(m, DT, new Map([[1, { x: 0, z: -1, dash: true }]]));
  run(m, 0.3);
  const hit = m.events.find((e) => e.type === 'hit');
  assert.ok(hit, 'Treffer-Ereignis');
  assert.equal(hit.a, 1);
  assert.equal(hit.b, 2);
  assert.ok(b.vz < -3 || b.falling, 'Opfer fliegt nach oben (-z)');
  assert.ok(Math.hypot(a.vx, a.vz) < 4, 'Angreifer wird gebremst');
  run(m, 3);
  // Aus der Mitte heraus reicht ein Stoß nicht ganz – aber nah an der Kante schon
  const m2 = duel();
  skipCountdown(m2);
  const [c, d] = m2.players;
  Object.assign(c, { x: 0, z: -3 });
  Object.assign(d, { x: 0, z: -4.8 });
  stepMatch(m2, DT, new Map([[1, { x: 0, z: -1, dash: true }]]));
  run(m2, 2);
  assert.ok(d.doomed, 'Opfer an der Kante fällt');
  assert.equal(c.stats.ko, 1);
  assert.equal(m2.events.find((e) => e.type === 'fall').by, 1);
  assert.deepEqual(m2.score, [1, 0]);
});

test('Rammen hat eine Abklingzeit, Turbo verkürzt sie', () => {
  const m = duel();
  skipCountdown(m);
  const [a, b] = m.players;
  Object.assign(a, { x: 0, z: 0 });
  Object.assign(b, { x: 0, z: -4 });
  stepMatch(m, DT, new Map([[1, { x: 1, z: 0, dash: true }]]));
  assert.ok(a.dashT > 0);
  run(m, 0.5, () => new Map([[1, { x: 0, z: 0, dash: true }]]));
  assert.equal(m.events.filter((e) => e.type === 'dash').length, 1, 'kein zweiter Sprint während der Abklingzeit');
  run(m, CFG.DASH_COOL);
  Object.assign(a, { x: 0, z: 0, vx: 0, vz: 0, turboT: 5 });
  m.events.length = 0;
  // alle 1/3 s tippen, abwechselnd nach rechts und links
  run(m, 1.2, (i) => new Map([[1, { x: i % 40 < 20 ? 1 : -1, z: 0, dash: i % 20 === 0 }]]));
  assert.ok(m.events.filter((e) => e.type === 'dash').length >= 3, 'mit Turbo mehrfach rammen');
  assert.ok(!a.falling);
});

test('Frontal-Zusammenstoß: beide prallen ab', () => {
  const m = duel();
  skipCountdown(m);
  const [a, b] = m.players;
  Object.assign(a, { x: 0, z: 1.2 });
  Object.assign(b, { x: 0, z: -1.2 });
  stepMatch(
    m,
    DT,
    new Map([
      [1, { x: 0, z: -1, dash: true }],
      [2, { x: 0, z: 1, dash: true }],
    ]),
  );
  run(m, 0.15);
  assert.ok(m.events.some((e) => e.type === 'clash'));
  assert.ok(a.vz > 2 && b.vz < -2, 'beide fliegen zurück');
});

test('Koloss ist schwer zu verschieben', () => {
  const push = (heavy) => {
    const m = duel();
    skipCountdown(m);
    const [a, b] = m.players;
    Object.assign(a, { x: 0, z: 1.5 });
    Object.assign(b, { x: 0, z: 0 });
    if (heavy) Object.assign(b, { heavyT: 5, mass: CFG.HEAVY_MASS, radius: CFG.PR * CFG.HEAVY_SCALE });
    stepMatch(m, DT, new Map([[1, { x: 0, z: -1, dash: true }]]));
    run(m, 0.15);
    return Math.abs(b.vz);
  };
  assert.ok(push(true) < push(false) * 0.6);
});

test('Die Arena bröckelt Ring für Ring bis auf die Mitte', () => {
  const m = duel();
  skipCountdown(m);
  // Beide stehen in der Mitte, damit niemand fällt
  const hold = () => {
    m.players[0].x = 0.3;
    m.players[0].z = 0;
    m.players[1].x = -0.3;
    m.players[1].z = 0;
    return new Map();
  };
  run(m, CFG.SHRINK_START + 0.1, hold);
  assert.equal(m.outerRing, m.rings - 1);
  assert.ok(m.tiles.filter((t) => t.ring === m.rings).every((t) => t.state === 1), 'äußerer Ring glüht');
  run(m, CFG.CRUMBLE_TIME + 1, hold);
  assert.ok(m.tiles.filter((t) => t.ring === m.rings).every((t) => t.state === 2), 'äußerer Ring ist weg');
  run(m, 45, hold);
  assert.equal(m.phase, 'play');
  assert.equal(m.outerRing, CFG.MIN_RING);
  assert.ok(m.tiles.find((t) => t.ring === 0).state === 0, 'Mittelfeld bleibt');
  assert.ok(m.phase !== 'play' || m.phaseT < CFG.ROUND_LIMIT);
});

test('Power-ups erscheinen und wirken', () => {
  const m = duel();
  skipCountdown(m);
  run(m, CFG.POWER_FIRST + 0.1);
  assert.equal(m.powerups.length, 1);
  const pu = m.powerups[0];
  const a = m.players[0];
  a.x = pu.x;
  a.z = pu.z;
  stepMatch(m, DT, new Map());
  assert.equal(m.powerups.length, 0);
  const ev = m.events.find((e) => e.type === 'power');
  assert.equal(ev.id, 1);
  assert.equal(ev.kind, pu.type);
  assert.ok(m.events.some((e) => e.type === 'pspawn' && e.kind === pu.type), 'Erscheinen wird gemeldet');
  if (pu.type === 'heavy') assert.ok(a.heavyT > 0 && a.mass > 1);
  if (pu.type === 'turbo') assert.ok(a.turboT > 0);
});

test('Partie endet nach 3 gewonnenen Runden', () => {
  const m = duel();
  let rounds = 0;
  while (m.phase !== 'matchEnd' && rounds < 10) {
    skipCountdown(m);
    // Blau läuft jede Runde von der Arena
    run(m, 3, () => new Map([[2, { x: 0, z: -1 }]]));
    run(m, CFG.ROUND_END + 0.1);
    rounds++;
  }
  assert.equal(m.phase, 'matchEnd');
  assert.deepEqual(m.score, [3, 0]);
  assert.equal(m.matchWinner, 0);
  assert.equal(m.players[1].stats.falls, 3);
});

for (const [label, diffs] of [
  ['1 gegen 1', ['normal', 'hard']],
  ['2 gegen 2', ['easy', 'normal', 'hard', 'normal']],
]) {
  test(`KI spielt eine ganze Partie ${label} zu Ende`, () => {
    const roster = diffs.map((d, i) => ({ id: i + 1, name: 'KI' + i, team: i % 2, bot: d }));
    const m = createMatch({ roster, seed: 99 });
    const brains = new Map(roster.map((r) => [r.id, createBrain(r.bot, m.rng)]));
    let steps = 0;
    while (m.phase !== 'matchEnd' && steps < 60 * 60 * 15) {
      const inputs = new Map(m.players.map((p) => [p.id, botThink(m, p, brains.get(p.id), DT)]));
      stepMatch(m, DT, inputs);
      m.events.length = 0;
      steps++;
      if (steps % 60 === 0) for (const p of m.players) assert.ok(Number.isFinite(p.x + p.z + p.y + p.vx + p.vz), 'keine NaN-Werte');
    }
    assert.equal(m.phase, 'matchEnd', 'Partie wurde beendet');
    assert.ok(Math.max(...m.score) === 3);
    const hits = m.players.reduce((s, p) => s + p.stats.hits, 0);
    assert.ok(hits > 5, 'die KI rammt tatsächlich');
  });
}

test('Schnappschuss: Kodieren und beim Mitspieler anwenden', () => {
  const host = duel();
  skipCountdown(host);
  run(host, 1, () => new Map([[1, { x: 1, z: 0 }]]));
  const s1 = encodeSnap(host, true);
  run(host, 0.1, () => new Map([[1, { x: 1, z: 0 }]]));
  const s2 = encodeSnap(host, false);
  const mirror = duel({ seed: 1 });
  applyTiles(mirror, s1.tl);
  applySnap(mirror, s1, s2, 0.5);
  const hp = host.players[0];
  const mp = mirror.players[0];
  assert.equal(mirror.phase, 'play');
  assert.ok(Math.abs(mp.x - (s1.p[0][0] + s2.p[0][0]) / 2) < 0.02);
  assert.ok(mp.x < hp.x + 0.01);
  assert.equal(tilesString(mirror), s1.tl);
  assert.ok(JSON.stringify(s1).length < 600, 'Schnappschuss bleibt klein');
});
