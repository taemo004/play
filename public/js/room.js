// Raumlogik – läuft im Browser des Raum-Erstellers (Gastgeber) und übernimmt die Rolle des Servers:
// Lobby, Teams, Einstellungen und die eigentliche Partie. Der Gastgeber rechnet die Physik für alle,
// die Mitspieler schicken nur ihre Eingaben und bekommen ~30× pro Sekunde den Zustand zurück.

import { createMatch, stepMatch, encodeSnap, ARENA_MODES, GOALS } from './sim.js';
import { sanitizeLook, randomLook } from './looks.js';
import { createBrain, botThink, botReactions, DIFFICULTIES } from './ai.js';

export const MAX_PLAYERS = 4;
const STEP = 1 / 60;
const SNAP_EVERY = 1 / 30;
const TILES_EVERY = 30; // Feldzustand spätestens jeden 30. Schnappschuss mitschicken
const HEARTBEAT_MS = 2000;
const CLIENT_TIMEOUT_MS = 8000;
const AUTOSTART_MS = 12000; // öffentliche Räume starten von selbst, sobald 2 Spieler da sind
const PUBLIC_RESULT_S = 9; // danach geht ein öffentlicher Raum zurück in die Lobby
const RESUME_WAIT_MS = 6000; // Gastgeber-Wechsel: so lange auf zurückkehrende Spieler warten
const EMOTE_GAP_MS = 1200;
export const EMOTES = ['👍', '😂', '😡', '😱'];
const BOT_NAMES = ['Knödel', 'Dampfwalze', 'Moppel', 'Brocken', 'Wackelpudding', 'Kugelblitz', 'Donnerbauch', 'Pfannkuchen'];

export function sanitizeName(name) {
  const clean = String(name || '').replace(/[<>&"]/g, '').trim().slice(0, 14);
  return clean || 'Spieler';
}

export const teamSizeOf = (mode) => (mode === '2v2' ? 2 : 1);

// Baut die Aufstellung: Menschen zuerst, leere Plätze optional mit KI auffüllen
export function buildRoster(humans, mode, fill, diff, rng = Math.random) {
  const size = teamSizeOf(mode);
  const roster = [];
  const names = [...BOT_NAMES].sort(() => rng() - 0.5);
  let botId = 100;
  for (const team of [0, 1]) {
    const members = humans.filter((h) => h.team === team);
    for (const h of members) roster.push({ id: h.id, name: h.name, team, look: sanitizeLook(h.look) });
    if (fill) for (let k = members.length; k < size; k++) roster.push({ id: botId++, name: names.pop(), team, bot: diff, look: randomLook(rng) });
  }
  return roster;
}

export class RoomHost {
  constructor(code, isPublic = false) {
    this.code = code;
    this.isPublic = isPublic;
    this.autoStartAt = 0;
    this.autoTimer = null;
    this.resume = null;
    this.nextId = 1;
    this.clients = new Map(); // id -> { id, send, local, name, team, inRoom, lastSeen }
    this.hostId = null;
    this.state = 'lobby'; // lobby | match
    this.mode = '1v1';
    this.fill = true;
    this.diff = 'normal';
    this.arena = 'mix';
    this.goal = 'sumo';
    this.match = null;
    this.roster = null;
    this.inputs = new Map();
    this.dashSeen = new Map();
    this.brains = new Map();
    this.acc = 0;
    this.snapAcc = 0;
    this.snapCount = 0;
    this.sentTilesV = -1;
    this.outbox = []; // Ereignisse seit dem letzten Schnappschuss
    this.heartbeat = setInterval(() => this.pulse(), HEARTBEAT_MS);
    if (this.heartbeat.unref) this.heartbeat.unref(); // blockiert Node-Tests nicht
  }

  destroy() {
    this.dead = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.autoTimer);
    if (this.resume) clearTimeout(this.resume.timer);
    this.clients.clear();
  }

  // Einstellungen vom vorherigen Gastgeber übernehmen
  applySettings(st = {}) {
    if (st.mode === '1v1' || st.mode === '2v2') this.mode = st.mode;
    if (typeof st.fill === 'boolean') this.fill = st.fill;
    if (DIFFICULTIES[st.diff]) this.diff = st.diff;
    if (ARENA_MODES.includes(st.arena)) this.arena = st.arena;
    if (GOALS[st.goal]) this.goal = st.goal;
  }

  // Gastgeber-Wechsel mitten in der Partie: auf die anderen warten, dann mit Spielstand weiterspielen.
  // resume: { roster, score, round, winRounds, arena, goal, oldHostId, myOldId }
  setResume(resume) {
    const expected = new Set(resume.roster.filter((r) => !r.bot && r.id !== resume.oldHostId && r.id !== resume.myOldId).map((r) => r.id));
    this.resume = { ...resume, expected };
    this.resume.timer = setTimeout(() => this.startResume(), RESUME_WAIT_MS);
    if (this.resume.timer.unref) this.resume.timer.unref();
  }

  checkResume() {
    if (!this.resume) return;
    const back = new Set(this.players.map((p) => p.prev));
    if ([...this.resume.expected].every((id) => back.has(id))) this.startResume();
  }

  startResume() {
    const r = this.resume;
    if (!r || this.dead) return;
    clearTimeout(r.timer);
    this.resume = null;
    const byPrev = new Map(this.players.filter((p) => p.prev != null).map((p) => [p.prev, p]));
    let botId = 200;
    const roster = r.roster.map((e) => {
      const c = !e.bot && byPrev.get(e.id);
      if (c) {
        c.team = e.team;
        return { id: c.id, name: c.name, team: e.team, look: c.look };
      }
      // Wer nicht zurückkam (auch der alte Gastgeber), wird von der KI gespielt
      return { id: botId++, name: e.bot ? e.name : `${e.name} (KI)`, team: e.team, bot: e.bot || this.diff, look: e.look, size: e.size, mass: e.mass };
    });
    this.startMatch({ roster, startAt: { score: r.score, round: r.round }, winRounds: r.winRounds, arena: r.arena, goal: r.goal });
  }

  // Öffentliche Räume: Modus nach Spielerzahl, Autostart sobald 2 Spieler da sind
  updateAutoStart() {
    if (!this.isPublic || this.dead) return;
    if (this.state !== 'lobby' || this.players.length < 2 || this.resume) {
      clearTimeout(this.autoTimer);
      this.autoTimer = null;
      this.autoStartAt = 0;
      return;
    }
    const mode = this.players.length > 2 ? '2v2' : '1v1';
    if (mode !== this.mode) {
      this.mode = mode;
      this.rebalance();
    }
    if (this.autoTimer) return;
    this.autoStartAt = Date.now() + AUTOSTART_MS;
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null;
      this.autoStartAt = 0;
      if (this.state === 'lobby' && this.players.length >= 2 && !this.problem()) this.startMatch();
      else this.updateAutoStart();
    }, AUTOSTART_MS);
    if (this.autoTimer.unref) this.autoTimer.unref();
  }

  backToLobby() {
    this.state = 'lobby';
    this.match = null;
    this.rebalance();
    this.broadcast({ t: 'lobby' });
    this.updateAutoStart();
    this.broadcastRoom();
  }

  pulse() {
    const now = Date.now();
    for (const c of [...this.clients.values()]) {
      if (!c.local && now - c.lastSeen > CLIENT_TIMEOUT_MS) this.removeClient(c.id);
    }
    for (const c of this.clients.values()) if (!c.local) c.send({ t: 'hb' });
  }

  get players() {
    return [...this.clients.values()].filter((c) => c.inRoom);
  }

  addClient(send, local = false) {
    const c = { id: this.nextId++, send, local, lastSeen: Date.now(), name: 'Spieler', look: sanitizeLook(null), team: 0, inRoom: false, prev: null, lastEmo: 0 };
    this.clients.set(c.id, c);
    send({ t: 'welcome', id: c.id });
    return c.id;
  }

  removeClient(id) {
    if (this.dead) return;
    const c = this.clients.get(id);
    if (!c) return;
    this.clients.delete(id);
    if (!c.inRoom) return;
    // Mitten in der Partie übernimmt die KI den Platz
    const p = this.match && this.match.players.find((pl) => pl.id === id);
    if (p) {
      p.bot = this.diff;
      this.brains.set(id, createBrain(this.diff, this.match.rng));
      this.match.events.push({ type: 'left', id, t: this.match.time });
    }
    this.updateAutoStart();
    this.broadcastRoom();
  }

  broadcast(msg, remoteOnly = false) {
    for (const c of this.players) if (!remoteOnly || !c.local) c.send(msg);
  }

  teamCount(team) {
    return this.players.filter((p) => p.team === team).length;
  }

  roomInfo() {
    return {
      t: 'room',
      code: this.code,
      isPublic: this.isPublic,
      autoStartIn: this.autoStartAt ? Math.max(0, this.autoStartAt - Date.now()) : 0,
      resuming: !!this.resume,
      hostId: this.hostId,
      state: this.state,
      mode: this.mode,
      fill: this.fill,
      diff: this.diff,
      arena: this.arena,
      goal: this.goal,
      problem: this.problem(),
      players: this.players.map((p) => ({ id: p.id, name: p.name, team: p.team, look: p.look })),
    };
  }

  broadcastRoom() {
    this.broadcast(this.roomInfo());
  }

  // Warum man (noch) nicht starten kann – oder null
  problem() {
    const size = teamSizeOf(this.mode);
    for (const team of [0, 1]) {
      const n = this.teamCount(team);
      if (n > size) return `Team ${team ? 'Blau' : 'Rot'} hat zu viele Spieler.`;
      if (n === 0 && !this.fill) return `Team ${team ? 'Blau' : 'Rot'} ist leer – KI auffüllen einschalten oder warten.`;
    }
    return null;
  }

  // Bei Modus-Wechsel überzählige Spieler ins andere Team schieben
  rebalance() {
    const size = teamSizeOf(this.mode);
    for (const team of [0, 1]) {
      for (const p of this.players.filter((pl) => pl.team === team).slice(size)) {
        if (this.teamCount(1 - team) < size) p.team = 1 - team;
      }
    }
  }

  handle(id, msg) {
    if (this.dead || !msg || typeof msg.t !== 'string') return;
    const c = this.clients.get(id);
    if (!c) return;
    c.lastSeen = Date.now();
    const isHost = id === this.hostId;
    switch (msg.t) {
      case 'hb':
        return;
      case 'hello': {
        c.name = sanitizeName(msg.name);
        c.look = sanitizeLook(msg.look);
        if (Number.isInteger(msg.prev)) c.prev = msg.prev;
        if (c.inRoom) return this.broadcastRoom();
        if (this.players.length >= MAX_PLAYERS) return c.send({ t: 'error', code: 'full', msg: 'Der Raum ist voll (max. 4 Spieler).' });
        if (this.hostId == null) this.hostId = id;
        if (this.players.length >= 2 && this.mode === '1v1' && this.state === 'lobby' && !this.resume) this.mode = '2v2';
        const old = this.resume && this.resume.roster.find((r) => r.id === c.prev && !r.bot);
        c.team = old ? old.team : this.teamCount(1) < this.teamCount(0) ? 1 : 0;
        c.inRoom = true;
        c.send({ t: 'joined', id, state: this.state });
        this.updateAutoStart();
        this.broadcastRoom();
        if (this.state === 'match' && this.match) c.send(this.startMsg());
        this.checkResume();
        return;
      }
      case 'team': {
        if (this.state !== 'lobby' || !c.inRoom) return;
        const team = msg.team === 1 ? 1 : 0;
        if (team !== c.team && this.teamCount(team) < teamSizeOf(this.mode)) c.team = team;
        return this.broadcastRoom();
      }
      case 'emo': {
        // Emoji über der eigenen Figur – kurz gebremst, damit niemand spammt
        const e = msg.e | 0;
        const now = Date.now();
        if (!this.match || e < 0 || e >= EMOTES.length || now - c.lastEmo < EMOTE_GAP_MS) return;
        if (!this.match.players.some((p) => p.id === id)) return;
        c.lastEmo = now;
        this.match.events.push({ type: 'emote', id, e, t: this.match.time });
        return;
      }
      case 'settings': {
        if (!isHost || this.state !== 'lobby') return;
        if ((msg.mode === '1v1' || msg.mode === '2v2') && !this.isPublic) {
          if (msg.mode === '1v1' && this.players.length > 2) {
            c.send({ t: 'toast', msg: 'Für 1 gegen 1 sind zu viele Spieler im Raum.' });
          } else this.mode = msg.mode;
        }
        if (typeof msg.fill === 'boolean') this.fill = msg.fill;
        if (DIFFICULTIES[msg.diff]) this.diff = msg.diff;
        if (ARENA_MODES.includes(msg.arena)) this.arena = msg.arena;
        if (GOALS[msg.goal]) this.goal = msg.goal;
        this.rebalance();
        return this.broadcastRoom();
      }
      case 'start': {
        if (!isHost || this.state !== 'lobby') return;
        const why = this.problem();
        if (why) return c.send({ t: 'toast', msg: why });
        return this.startMatch();
      }
      case 'rematch': {
        if (!isHost || this.state !== 'match' || !this.match || this.match.phase !== 'matchEnd') return;
        return this.startMatch();
      }
      case 'lobby': {
        if (!isHost || this.state !== 'match') return;
        return this.backToLobby();
      }
      case 'in': {
        if (!this.match) return;
        const x = Number.isFinite(msg.x) ? msg.x : 0;
        const z = Number.isFinite(msg.z) ? msg.z : 0;
        const d = Number.isFinite(msg.d) ? msg.d : 0;
        const prev = this.inputs.get(id);
        const seen = this.dashSeen.get(id) ?? d;
        const dash = d > seen || (prev ? prev.dash : false);
        this.dashSeen.set(id, Math.max(seen, d));
        this.inputs.set(id, { x, z, dash, hold: !!msg.h });
        return;
      }
    }
  }

  startMsg() {
    return { t: 'start', roster: this.roster, rings: this.match.rings, winRounds: this.match.winRounds, arena: this.match.arenaMode, goal: this.match.goal };
  }

  startMatch(resume = null) {
    clearTimeout(this.autoTimer);
    this.autoTimer = null;
    this.autoStartAt = 0;
    this.roster = resume ? resume.roster : buildRoster(this.players, this.mode, this.fill, this.diff);
    this.match = createMatch({
      roster: this.roster,
      arena: resume ? resume.arena : this.arena,
      goal: resume ? resume.goal : this.goal,
      winRounds: resume ? resume.winRounds : 3,
      startAt: resume ? resume.startAt : null,
    });
    this.brains = new Map(this.roster.filter((r) => r.bot).map((r) => [r.id, createBrain(r.bot, this.match.rng)]));
    this.inputs.clear();
    this.dashSeen.clear();
    this.acc = this.snapAcc = 0;
    this.snapCount = 0;
    this.sentTilesV = -1;
    this.outbox = [];
    this.state = 'match';
    this.broadcast(this.startMsg());
    this.broadcastRoom();
  }

  // Vom Spiel-Loop des Gastgebers aufgerufen. Liefert die Ereignisse für die eigene Darstellung.
  update(dt) {
    const m = this.match;
    if (!m || this.dead) return [];
    this.acc = Math.min(this.acc + dt, 0.25);
    const events = [];
    while (this.acc >= STEP) {
      this.acc -= STEP;
      const inputs = new Map();
      for (const p of m.players) {
        if (p.bot) {
          let brain = this.brains.get(p.id);
          if (!brain) this.brains.set(p.id, (brain = createBrain(p.bot, m.rng)));
          inputs.set(p.id, botThink(m, p, brain, STEP));
        } else {
          const inp = this.inputs.get(p.id);
          if (inp) {
            inputs.set(p.id, { ...inp });
            inp.dash = false;
          }
        }
      }
      stepMatch(m, STEP, inputs);
      if (m.events.length) m.events.push(...botReactions(m, m.events, m.rng));
      if (m.events.length) {
        events.push(...m.events);
        this.outbox.push(...m.events);
        m.events.length = 0;
      }
    }
    // Öffentliche Räume gehen nach dem Ergebnis von selbst zurück in die Lobby
    if (this.isPublic && m.phase === 'matchEnd' && m.phaseT > PUBLIC_RESULT_S) {
      this.backToLobby();
      return events;
    }
    this.snapAcc += dt;
    if (this.snapAcc >= SNAP_EVERY) {
      this.snapAcc = Math.min(this.snapAcc - SNAP_EVERY, SNAP_EVERY);
      this.snapCount++;
      const withTiles = m.tilesVersion !== this.sentTilesV || this.snapCount % TILES_EVERY === 0;
      this.sentTilesV = m.tilesVersion;
      const snap = encodeSnap(m, withTiles);
      if (this.outbox.length) snap.ev = this.outbox.map(compactEvent);
      this.outbox = [];
      this.broadcast(snap, true);
    }
    return events;
  }
}

function compactEvent(e) {
  const out = {};
  for (const k in e) out[k] = typeof e[k] === 'number' ? Math.round(e[k] * 100) / 100 : e[k];
  return out;
}
