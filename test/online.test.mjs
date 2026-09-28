// Online-Ausbau: öffentliche Räume mit Autostart, Emojis, Gastgeber-Wechsel mit Spielstand
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomHost, EMOTES } from '../public/js/room.js';
import { createMatch, stepMatch } from '../public/js/sim.js';
import { botReactions } from '../public/js/ai.js';

function setup(isPublic = false) {
  const room = new RoomHost('QK01', isPublic);
  const inbox = new Map();
  const join = (name, { local = false, prev } = {}) => {
    const box = [];
    const id = room.addClient((m) => box.push(m), local);
    inbox.set(id, box);
    room.handle(id, { t: 'hello', name, prev });
    return id;
  };
  const last = (id, t) => [...inbox.get(id)].reverse().find((m) => m.t === t);
  return { room, join, last, inbox };
}

test('Öffentlicher Raum: Autostart ab 2 Spielern, Modus nach Spielerzahl', async () => {
  const { room, join, last } = setup(true);
  const h = join('Host', { local: true });
  assert.equal(room.autoStartAt, 0, 'allein kein Autostart');
  const a = join('Anna');
  assert.ok(room.autoStartAt > Date.now(), 'Countdown läuft');
  assert.equal(room.mode, '1v1');
  assert.ok(last(a, 'room').isPublic);
  assert.ok(last(a, 'room').autoStartIn > 10000);
  room.handle(h, { t: 'settings', mode: '2v2' });
  assert.equal(room.mode, '1v1', 'Modus ist in öffentlichen Räumen automatisch');
  join('Ben');
  assert.equal(room.mode, '2v2', 'bei 3 Spielern 2 gegen 2');
  room.removeClient(a);
  // Beschleunigt: Autostart direkt auslösen
  clearTimeout(room.autoTimer);
  room.autoTimer = null;
  room.startMatch();
  assert.equal(room.state, 'match');
  // Nach dem Spielende geht es automatisch zurück in die Lobby
  room.match.phase = 'matchEnd';
  room.match.phaseT = 20;
  room.update(1 / 60);
  assert.equal(room.state, 'lobby');
  assert.ok(room.autoStartAt > 0, 'nächster Autostart geplant');
  room.destroy();
});

test('Privater Raum startet nicht von selbst', () => {
  const { room, join } = setup(false);
  join('Host', { local: true });
  join('Anna');
  assert.equal(room.autoStartAt, 0);
  room.destroy();
});

test('Emojis: nur Mitspieler, nur gültige, nicht zu oft', () => {
  const { room, join, inbox } = setup(false);
  const h = join('Host', { local: true });
  const a = join('Anna');
  room.handle(a, { t: 'emo', e: 1 });
  assert.equal(room.state, 'lobby');
  room.handle(h, { t: 'start' });
  room.handle(a, { t: 'emo', e: 1 });
  room.handle(a, { t: 'emo', e: 2 });
  room.handle(a, { t: 'emo', e: 99 });
  const events = room.update(1 / 60);
  const emotes = events.filter((e) => e.type === 'emote');
  assert.deepEqual(emotes.map((e) => [e.id, e.e]), [[a, 1]], 'zweites Emoji zu schnell, ungültiges ignoriert');
  for (let i = 0; i < 3; i++) room.update(1 / 60);
  const snaps = inbox.get(a).filter((m) => m.t === 's' && m.ev);
  assert.ok(snaps.some((s) => s.ev.some((e) => e.type === 'emote' && e.id === a)), 'kommt bei allen an');
  assert.equal(EMOTES.length, 4);
  room.destroy();
});

test('KI reagiert gelegentlich mit Emojis', () => {
  const m = createMatch({
    roster: [
      { id: 1, team: 0 },
      { id: 2, team: 1, bot: 'normal' },
    ],
    seed: 1,
  });
  let n = 0;
  for (let i = 0; i < 200; i++) n += botReactions(m, [{ type: 'fall', id: 1, by: 2 }], Math.random).length;
  assert.ok(n > 30 && n < 120, `${n} Reaktionen`);
  assert.equal(botReactions(m, [{ type: 'fall', id: 2, by: 1 }], () => 0.9).length, 0);
});

test('Gastgeber-Wechsel: Partie geht mit Spielstand weiter, Gastgeber wird KI', () => {
  // Alte Partie: Host (1), Anna (2), Ben (3) + KI (100)
  const oldRoster = [
    { id: 1, name: 'Host', team: 0, look: { hat: 'krone', extra: 'none' } },
    { id: 3, name: 'Ben', team: 0, look: { hat: 'none', extra: 'none' } },
    { id: 2, name: 'Anna', team: 1, look: { hat: 'party', extra: 'none' } },
    { id: 100, name: 'Knödel', team: 1, bot: 'hard', look: { hat: 'party', extra: 'none' } },
  ];
  // Anna (alte ID 2) übernimmt als neuer Gastgeber
  const { room, join, last } = setup(false);
  room.applySettings({ mode: '2v2', diff: 'easy', arena: 'eis', goal: 'huegel' });
  room.setResume({ roster: oldRoster, score: [1, 2], round: 4, winRounds: 3, arena: 'eis', goal: 'huegel', oldHostId: 1, myOldId: 2 });
  const anna = join('Anna', { local: true, prev: 2 });
  assert.equal(room.state, 'lobby', 'wartet auf Ben');
  assert.ok(last(anna, 'room').resuming);
  const ben = join('Ben', { prev: 3 });
  assert.equal(room.state, 'match', 'alle zurück → weiter');
  const m = room.match;
  assert.deepEqual(m.score, [1, 2]);
  assert.equal(m.round, 4, 'die abgebrochene Runde startet neu');
  assert.equal(m.arena, 'eis');
  assert.equal(m.goal, 'huegel');
  const byName = (n) => m.players.find((p) => p.name.startsWith(n));
  assert.equal(byName('Anna').id, anna);
  assert.equal(byName('Anna').team, 1);
  assert.equal(byName('Ben').id, ben);
  assert.equal(byName('Ben').team, 0);
  assert.equal(byName('Host').bot, 'easy', 'alter Gastgeber wird von der KI gespielt');
  assert.equal(byName('Host').name, 'Host (KI)');
  assert.equal(byName('Knödel').bot, 'hard');
  assert.ok(new Set(m.players.map((p) => p.id)).size === 4, 'keine doppelten IDs');
  const start = last(ben, 'start');
  assert.equal(start.winRounds, 3);
  for (let i = 0; i < 400; i++) room.update(1 / 60);
  assert.equal(m.round, 4);
  room.destroy();
});

test('Gastgeber-Wechsel: wer nicht zurückkommt, wird nach Wartezeit KI', () => {
  const { room, join } = setup(false);
  room.setResume({
    roster: [
      { id: 1, name: 'Host', team: 0 },
      { id: 2, name: 'Anna', team: 1 },
      { id: 3, name: 'Ben', team: 0 },
    ],
    score: [0, 0],
    round: 1,
    winRounds: 3,
    arena: 'lava',
    goal: 'sumo',
    oldHostId: 1,
    myOldId: 2,
  });
  join('Anna', { local: true, prev: 2 });
  assert.equal(room.state, 'lobby');
  room.startResume(); // = Ablauf der Wartezeit
  assert.equal(room.state, 'match');
  assert.equal(room.match.players.filter((p) => p.bot).length, 2);
  room.destroy();
});

test('Gastgeber-Wechsel in der Lobby: Einstellungen bleiben', () => {
  const { room, join, last } = setup(false);
  room.applySettings({ mode: '2v2', fill: false, diff: 'hard', arena: 'dreh', goal: 'huegel' });
  const a = join('Anna', { local: true });
  const info = last(a, 'room');
  assert.deepEqual([info.mode, info.fill, info.diff, info.arena, info.goal], ['2v2', false, 'hard', 'dreh', 'huegel']);
  room.destroy();
});
