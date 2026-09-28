// Raumlogik des Gastgebers: Beitreten, Teams, Einstellungen, Start, Eingaben, Schnappschüsse, Verlassen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomHost, buildRoster } from '../public/js/room.js';

function setup() {
  const room = new RoomHost('TEST');
  const inbox = new Map();
  const join = (name, local = false) => {
    const box = [];
    const id = room.addClient((m) => box.push(m), local);
    inbox.set(id, box);
    room.handle(id, { t: 'hello', name });
    return id;
  };
  const last = (id, t) => [...inbox.get(id)].reverse().find((m) => m.t === t);
  return { room, join, inbox, last };
}

test('Beitreten: Gastgeber, Teams abwechselnd, Raum voll bei 5', () => {
  const { room, join, last } = setup();
  const h = join('Host', true);
  const a = join('Anna');
  assert.equal(room.hostId, h);
  assert.equal(last(a, 'joined').id, a);
  const info = last(a, 'room');
  assert.deepEqual(
    info.players.map((p) => p.team),
    [0, 1],
  );
  join('Ben');
  assert.equal(room.mode, '2v2', 'ab 3 Spielern automatisch 2 gegen 2');
  join('Cleo');
  const e = join('Dana');
  assert.equal(last(e, 'error').code, 'full');
  assert.equal(room.players.length, 4);
  room.destroy();
});

test('Namen werden bereinigt', () => {
  const { room, join, last } = setup();
  const h = join('<b>Hacker</b>&"xx"', true);
  assert.equal(last(h, 'room').players[0].name, 'bHacker/bxx');
  room.destroy();
});

test('Nur der Gastgeber ändert Einstellungen und startet', () => {
  const { room, join, last } = setup();
  const h = join('Host', true);
  const a = join('Anna');
  room.handle(a, { t: 'settings', mode: '2v2' });
  assert.equal(room.mode, '1v1');
  room.handle(a, { t: 'start' });
  assert.equal(room.state, 'lobby');
  room.handle(h, { t: 'settings', mode: '2v2', fill: false, diff: 'hard' });
  assert.equal(room.mode, '2v2');
  assert.equal(room.fill, false);
  assert.equal(room.diff, 'hard');
  assert.equal(last(a, 'room').mode, '2v2');
  room.destroy();
});

test('Teamwechsel und Problemprüfung', () => {
  const { room, join } = setup();
  const h = join('Host', true);
  const a = join('Anna');
  room.handle(a, { t: 'team', team: 0 });
  assert.equal(room.clients.get(a).team, 1, '1 gegen 1: Team Rot ist voll');
  room.handle(h, { t: 'settings', mode: '2v2', fill: false });
  room.handle(a, { t: 'team', team: 0 });
  assert.equal(room.clients.get(a).team, 0);
  assert.match(room.problem(), /leer/);
  room.handle(h, { t: 'settings', fill: true });
  assert.equal(room.problem(), null);
  room.handle(h, { t: 'settings', mode: '1v1' });
  assert.notEqual(room.clients.get(h).team, room.clients.get(a).team, 'bei 1 gegen 1 wieder verteilt');
  room.destroy();
});

test('Aufstellung füllt freie Plätze mit KI', () => {
  const roster = buildRoster(
    [
      { id: 1, name: 'A', team: 0 },
      { id: 2, name: 'B', team: 0 },
    ],
    '2v2',
    true,
    'hard',
  );
  assert.equal(roster.length, 4);
  assert.equal(roster.filter((r) => r.team === 1 && r.bot === 'hard').length, 2);
  assert.equal(buildRoster([{ id: 1, name: 'A', team: 0 }], '1v1', false, 'easy').length, 1);
});

test('Partie: Start, Eingaben, Schnappschüsse, Revanche und zurück zur Lobby', () => {
  const { room, join, inbox, last } = setup();
  const h = join('Host', true);
  const a = join('Anna');
  room.handle(h, { t: 'start' });
  assert.equal(room.state, 'match');
  const start = last(a, 'start');
  assert.equal(start.roster.length, 2);
  assert.equal(start.rings, 4);
  // Countdown abwarten, dann läuft Anna nach unten (+z) und rammt einmal
  for (let i = 0; i < 200; i++) room.update(1 / 60);
  const za = room.match.players.find((p) => p.id === a).z;
  room.handle(a, { t: 'in', x: 0, z: 1, d: 0 });
  room.handle(a, { t: 'in', x: 0, z: 1, d: 1 });
  let events = [];
  for (let i = 0; i < 30; i++) events = events.concat(room.update(1 / 60));
  assert.ok(room.match.players.find((p) => p.id === a).z > za + 1, 'Eingabe kommt an');
  assert.ok(events.some((e) => e.type === 'dash' && e.id === a), 'Rammen kommt an');
  const snaps = inbox.get(a).filter((m) => m.t === 's');
  assert.ok(snaps.length > 5, 'Mitspieler bekommt Schnappschüsse');
  assert.ok(snaps.some((s) => s.tl), 'mit Feldzustand');
  assert.ok(snaps.some((s) => s.ev && s.ev.some((e) => e.type === 'dash')), 'mit Ereignissen');
  assert.ok(!inbox.get(h).some((m) => m.t === 's'), 'Gastgeber rechnet selbst');
  // Revanche erst nach Spielende
  room.handle(h, { t: 'rematch' });
  const m1 = room.match;
  assert.equal(room.match, m1);
  m1.phase = 'matchEnd';
  room.handle(h, { t: 'rematch' });
  assert.notEqual(room.match, m1);
  room.handle(h, { t: 'lobby' });
  assert.equal(room.state, 'lobby');
  assert.ok(last(a, 'lobby'));
  room.destroy();
});

test('Wer mitten in der Partie geht, wird von der KI ersetzt', () => {
  const { room, join } = setup();
  const h = join('Host', true);
  const a = join('Anna');
  room.handle(h, { t: 'start' });
  room.removeClient(a);
  const p = room.match.players.find((pl) => pl.id === a);
  assert.equal(p.bot, 'normal');
  assert.ok(room.match.events.some((e) => e.type === 'left' && e.id === a));
  let maxSpeed = 0;
  for (let i = 0; i < 600; i++) {
    room.update(1 / 60);
    maxSpeed = Math.max(maxSpeed, Math.hypot(p.vx, p.vz));
  }
  assert.ok(maxSpeed > 3, 'KI bewegt die Figur');
  room.destroy();
});

test('Späte Zuschauer bekommen die laufende Partie', () => {
  const { room, join, last } = setup();
  const h = join('Host', true);
  join('Anna');
  room.handle(h, { t: 'start' });
  const c = join('Cleo');
  assert.ok(last(c, 'start'), 'Zuschauer bekommt die Aufstellung');
  assert.ok(!last(c, 'start').roster.some((r) => r.id === c));
  room.destroy();
});

test('Arena und Aussehen kommen bei allen an', () => {
  const room = new RoomHost('LOOK');
  const box = [];
  const h = room.addClient(() => {}, true);
  room.handle(h, { t: 'hello', name: 'Host', look: { hat: 'cowboy', extra: 'quatsch' } });
  const a = room.addClient((m) => box.push(m));
  room.handle(a, { t: 'hello', name: 'Anna', look: { hat: 'party', extra: 'sonnenbrille' } });
  room.handle(a, { t: 'settings', arena: 'eis' });
  assert.equal(room.arena, 'mix', 'nur der Gastgeber wählt die Arena');
  room.handle(h, { t: 'settings', arena: 'eis' });
  room.handle(h, { t: 'settings', arena: 'weltall' });
  assert.equal(room.arena, 'eis');
  const info = [...box].reverse().find((m) => m.t === 'room');
  assert.equal(info.arena, 'eis');
  assert.deepEqual(info.players.find((p) => p.id === h).look, { hat: 'cowboy', extra: 'none' });
  room.handle(h, { t: 'settings', mode: '2v2' });
  room.handle(h, { t: 'start' });
  const start = [...box].reverse().find((m) => m.t === 'start');
  assert.equal(start.arena, 'eis');
  assert.equal(room.match.arena, 'eis');
  assert.deepEqual(start.roster.find((r) => r.id === a).look, { hat: 'party', extra: 'sonnenbrille' });
  assert.ok(start.roster.filter((r) => r.bot).every((r) => r.look && r.look.hat !== 'none'), 'KI trägt etwas');
  room.destroy();
});
