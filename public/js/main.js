// Sumo Smash – Hauptlogik: Menüs, Spielmodi (KI, zu zweit, online), Spiel-Loop und Anzeige.
import { APP_VERSION } from './version.js';
import { createMatch, stepMatch, applySnap, applyTiles, CFG, GOALS } from './sim.js';
import { STAGES, stageRoster, TOUR_WIN_ROUNDS } from './tourney.js';
import { createBrain, botThink } from './ai.js';
import { Renderer, Preview, POWER_ICONS, POWER_NAMES } from './render.js';
import { HATS, EXTRAS, EMPTY_STATS, isUnlocked, sanitizeLook, randomLook, newlyUnlocked } from './looks.js';
import { Controls } from './input.js';
import { Sfx } from './audio.js';
import { Net } from './net.js';
import { sanitizeName, teamSizeOf } from './room.js';

// Passen Seite und Skripte nicht zusammen (alte Seite aus dem Cache nach einer
// Veröffentlichung), einmal neu laden – sonst würde das Spiel gleich abstürzen.
if (document.documentElement.dataset.v !== APP_VERSION) {
  const key = 'ss_reload_' + APP_VERSION;
  let reloaded = false;
  try {
    reloaded = sessionStorage.getItem(key) === '1';
    sessionStorage.setItem(key, '1');
  } catch {
    /* egal */
  }
  if (!reloaded) location.reload();
  else {
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;inset:0;z-index:99;display:flex;align-items:center;justify-content:center;padding:24px;background:#1b0b2e;color:#fff;font:18px system-ui,sans-serif;text-align:center';
    box.innerHTML = 'Eine neue Version von Sumo Smash wurde veröffentlicht.<br>Bitte lade die Seite in einer Minute neu.';
    document.body.appendChild(box);
  }
  throw new Error('Spieldateien passen nicht zur Seite (Version ' + APP_VERSION + ') – Seite wird neu geladen.');
}

const STEP = 1 / 60;
const INTERP_DELAY = 0.085; // Sekunden, die Mitspieler hinter dem Gastgeber darstellen (glättet Ruckler)
const OWN_DELAY = 0.035; // die eigene Figur mit weniger Verzögerung – fühlt sich direkter an
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('ss_' + k);
      return v === null ? d : v;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('ss_' + k, v);
    } catch {
      /* egal */
    }
  },
};

const ARENA_LABEL = {
  mix: '🎲 Wechselnd',
  lava: '🌋 Vulkan',
  eis: '🧊 Gletscher – rutschig!',
  dreh: '🎠 Karussell – dreht immer schneller',
};
const REPLAY_SPEED = 0.42;

const settings = {
  aiArena: store.get('aiArena', 'lava'),
  aiGoal: store.get('aiGoal', 'sumo'),
  localGoal: store.get('localGoal', 'sumo'),
  localArena: store.get('localArena', 'lava'),
  aiMode: store.get('aiMode', '1v1'),
  aiDiff: store.get('aiDiff', 'normal'),
  localMode: store.get('localMode', '1v1'),
  localDiff: store.get('localDiff', 'normal'),
};

const renderer = new Renderer($('#game'), $('#labels'));
const controls = new Controls($('#touch'));
const sfx = new Sfx();
const net = new Net(() => playerName(), () => myLook());

function loadJSON(key, fallback) {
  try {
    return { ...fallback, ...JSON.parse(store.get(key, '{}')) };
  } catch {
    return { ...fallback };
  }
}
function loadStats() {
  return loadJSON('stats', EMPTY_STATS);
}
// Nur freigeschaltete Teile tragen (falls der Speicher verändert wurde)
function myLook() {
  const look = sanitizeLook(loadJSON('look', {}));
  const stats = loadStats();
  if (!isUnlocked(HATS.find((h) => h.id === look.hat), stats)) look.hat = 'none';
  if (!isUnlocked(EXTRAS.find((e) => e.id === look.extra), stats)) look.extra = 'none';
  return look;
}

let session = null;
let room = null; // letzter Lobby-Stand (online)
let resultTimer = null;
let lastCount = 0;
let wakeLock = null;

function playerName() {
  return sanitizeName($('#in-name').value || store.get('name', ''));
}

// Bildschirm-Richtung → Welt-Richtung, abhängig von der Kameradrehung
function toWorld(r, az) {
  const c = Math.cos(az);
  const s = Math.sin(az);
  return { x: r.x * c + r.y * s, z: -r.x * s + r.y * c };
}

// ---------- Spielmodi ----------

// Läuft komplett auf diesem Gerät (Demo im Menü, gegen KI, zu zweit)
class LocalSession {
  constructor(kind, roster, humans, opts = {}) {
    this.kind = kind;
    this.roster = roster;
    this.humans = humans; // [{ pid, slot }]
    this.localIds = humans.map((h) => h.pid);
    this.azimuth = 0;
    this.topDown = !!opts.topDown;
    this.arena = opts.arena || 'lava';
    this.diff = opts.diff || null;
    this.goal = opts.goal || 'sumo';
    this.winRounds = opts.winRounds || 3;
    this.tourStage = opts.tourStage ?? null;
    this.start();
  }

  start() {
    this.match = createMatch({ roster: this.roster, arena: this.arena, goal: this.goal, winRounds: this.winRounds });
    this.brains = new Map(this.roster.filter((r) => r.bot).map((r) => [r.id, createBrain(r.bot, this.match.rng)]));
    this.acc = 0;
    this.lastDash = new Map();
  }

  get view() {
    return this.match;
  }

  update(dt) {
    const m = this.match;
    const inputs = new Map();
    for (const h of this.humans) {
      const r = controls.read(h.slot);
      const w = toWorld(r, this.azimuth);
      const last = this.lastDash.has(h.pid) ? this.lastDash.get(h.pid) : r.dash;
      inputs.set(h.pid, { x: w.x, z: w.z, dash: r.dash > last, hold: r.hold });
      this.lastDash.set(h.pid, r.dash);
    }
    const events = [];
    this.acc = Math.min(this.acc + dt, 0.2);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      for (const p of m.players) if (p.bot) inputs.set(p.id, botThink(m, p, this.brains.get(p.id), STEP));
      stepMatch(m, STEP, inputs);
      for (const h of this.humans) inputs.get(h.pid).dash = false;
      events.push(...m.events);
      m.events.length = 0;
    }
    return events;
  }
}

// Gastgeber einer Online-Partie: rechnet für alle (room.js)
class HostSession {
  constructor() {
    this.kind = 'host';
    this.localIds = [net.id];
    this.azimuth = this.myTeam() === 1 ? Math.PI : 0;
    this.topDown = false;
  }

  myTeam() {
    const p = net.host.match.players.find((pl) => pl.id === net.id);
    return p ? p.team : 0;
  }

  get view() {
    return net.host.match;
  }

  update(dt) {
    if (!net.host) return [];
    const r = controls.read(0);
    const w = toWorld(r, this.azimuth);
    net.host.handle(net.id, { t: 'in', x: w.x, z: w.z, d: r.dash, h: r.hold ? 1 : 0 });
    return net.host.update(dt);
  }
}

// Mitspieler: bekommt Schnappschüsse vom Gastgeber und stellt sie leicht verzögert und geglättet dar
class ClientSession {
  constructor(msg) {
    this.kind = 'client';
    this.match = createMatch({ roster: msg.roster, rings: msg.rings, winRounds: msg.winRounds, arena: msg.arena, goal: msg.goal, seed: 1 });
    this.match.events.length = 0;
    const me = msg.roster.find((r) => r.id === net.id);
    this.isPlayer = !!me;
    this.localIds = me ? [me.id] : [];
    this.azimuth = me && me.team === 1 ? Math.PI : 0;
    this.topDown = false;
    this.snaps = [];
    this.offset = null;
    this.evq = [];
    this.sendAcc = 0;
    this.lastSentDash = -1;
  }

  get view() {
    return this.match;
  }

  onSnap(s) {
    const now = performance.now() / 1000;
    const sample = now - s.ht;
    if (this.offset === null || sample < this.offset) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.01;
    const last = this.snaps[this.snaps.length - 1];
    if (last && s.ht <= last.ht) return;
    this.snaps.push(s);
    if (this.snaps.length > 60) this.snaps.shift();
    if (s.tl) applyTiles(this.match, s.tl);
    if (s.ev) this.evq.push(...s.ev);
  }

  // Die zwei Schnappschüsse um Zeitpunkt t und der Mischfaktor dazwischen
  pick(t) {
    const snaps = this.snaps;
    let a = snaps[0];
    let b = a;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].ht <= t) {
        a = snaps[i];
        b = snaps[i + 1] || a;
        break;
      }
    }
    const span = b.ht - a.ht;
    return [a, b, span > 0 ? Math.min(1, Math.max(0, (t - a.ht) / span)) : 1];
  }

  update(dt) {
    if (this.isPlayer) {
      const r = controls.read(0);
      this.sendAcc += dt;
      if (this.sendAcc >= 1 / 30 || r.dash !== this.lastSentDash || r.hold !== this.lastSentHold) {
        this.lastSentHold = r.hold;
        this.sendAcc = 0;
        this.lastSentDash = r.dash;
        const w = toWorld(r, this.azimuth);
        net.send({ t: 'in', x: Math.round(w.x * 100) / 100, z: Math.round(w.z * 100) / 100, d: r.dash, h: r.hold ? 1 : 0 });
      }
    }
    if (!this.snaps.length) return [];
    const now = performance.now() / 1000 - this.offset;
    const rt = now - INTERP_DELAY;
    applySnap(this.match, ...this.pick(rt));
    const own = this.match.players.findIndex((p) => this.localIds.includes(p.id));
    if (own >= 0) applySnap(this.match, ...this.pick(now - OWN_DELAY), own);
    const due = [];
    this.evq = this.evq.filter((e) => {
      if (e.t <= rt) {
        due.push(e);
        return false;
      }
      return true;
    });
    return due;
  }
}

function demoSession() {
  const roster = [
    { id: 1, name: 'Knödel', team: 0, bot: 'normal', look: randomLook() },
    { id: 2, name: 'Moppel', team: 1, bot: 'normal', look: randomLook() },
    { id: 3, name: 'Brocken', team: 0, bot: 'hard', look: randomLook() },
    { id: 4, name: 'Kugelblitz', team: 1, bot: 'hard', look: randomLook() },
  ];
  const s = new LocalSession('demo', roster, [], { arena: 'mix' });
  s.match.winRounds = 99;
  return s;
}

// ---------- Ablauf ----------

function show(id) {
  for (const el of $$('.screen')) el.classList.toggle('hidden', el.id !== id);
  if (id === 'scr-tour') renderTour();
  if (id === 'scr-look') openLookScreen();
  else if (preview) preview.stop();
}

function setSession(s, { playing }) {
  stopReplay();
  recording.length = 0;
  session = s;
  clearTimeout(resultTimer);
  lastCount = 0;
  const duo = s.localIds.length > 1;
  document.body.classList.toggle('duo', duo);
  renderer.setup(s.view, { localIds: s.localIds, azimuth: s.azimuth, topDown: s.topDown });
  $('#hud').classList.toggle('hidden', !playing);
  $('#touch').classList.toggle('hidden', !playing || !s.localIds.length);
  if (playing) {
    show(null);
    if (duo) controls.configure([{ keys: 'wasd', region: 'bottom', gamepad: 0 }, { keys: 'arrows', region: 'top', gamepad: 1 }]);
    else if (s.localIds.length) controls.configure([{ keys: 'both', region: 'full', gamepad: 0 }]);
    else controls.clear();
    buildDots(s.view.winRounds);
    setBanner('');
    requestWakeLock();
  } else {
    controls.clear();
    releaseWakeLock();
  }
}

function toMenu(screen = 'scr-menu') {
  net.close();
  room = null;
  setSession(demoSession(), { playing: false });
  show(screen);
}

function startAi() {
  sfx.unlock();
  const size = settings.aiMode === '2v2' ? 2 : 1;
  const names = ['Knödel', 'Dampfwalze', 'Moppel', 'Brocken'];
  const roster = [{ id: 1, name: playerName(), team: 0, look: myLook() }];
  if (size === 2) roster.push({ id: 2, name: 'Partner-KI', team: 0, bot: settings.aiDiff, look: randomLook() });
  for (let k = 0; k < size; k++) roster.push({ id: 10 + k, name: names[k], team: 1, bot: settings.aiDiff, look: randomLook() });
  const s = new LocalSession('ai', roster, [{ pid: 1, slot: 0 }], { arena: settings.aiArena, diff: settings.aiDiff, goal: settings.aiGoal });
  setSession(s, { playing: true });
}

// ---------- Turnier ----------

function tourState() {
  return loadJSON('tour', { stage: 0 });
}

function startTour(stage) {
  sfx.unlock();
  const st = STAGES[stage];
  const roster = stageRoster(stage, { name: playerName(), look: myLook() });
  const s = new LocalSession('tour', roster, [{ pid: 1, slot: 0 }], {
    arena: st.arena,
    goal: st.goal,
    diff: st.diff,
    winRounds: TOUR_WIN_ROUNDS,
    tourStage: stage,
  });
  setSession(s, { playing: true });
  toast(`🏆 Turnier ${stage + 1}/${STAGES.length}: ${esc(st.name)} – ${esc(st.title)}`);
}

function renderTour() {
  const { stage } = tourState();
  const stats = loadStats();
  $('#tour-list').innerHTML = STAGES.map((st, i) => {
    const hat = HATS.find((h) => h.id === st.look.hat);
    const state = i < stage ? 'done' : i === stage ? 'current' : 'locked';
    const badge = state === 'done' ? '✅' : state === 'current' ? '⚔️' : '🔒';
    const goal = st.goal === 'huegel' ? ' · ⛰️ Hügel halten' : '';
    return `<li class="tour-${state}${st.boss ? ' boss' : ''}">
      <span class="t-icon">${hat ? hat.icon : '🥋'}</span>
      <span class="t-main"><b>${esc(st.name)}</b> <small>${esc(st.title)}</small>
        ${state === 'current' ? `<span class="t-text">${esc(st.text)}<br><small>${ARENA_LABEL[st.arena === 'mix' ? 'mix' : st.arena] || '🎲 Wechselnd'}${goal}</small></span>` : ''}</span>
      <span class="t-badge">${badge}</span></li>`;
  }).join('');
  $('#tour-info').textContent = stats.tourney
    ? `Turniersiege: ${stats.tourney} 🏆`
    : 'Besiege alle fünf Gegner. Verlierst du, kannst du den Kampf beliebig oft wiederholen.';
  $('#btn-tour-start').textContent = stage === 0 ? 'Turnier starten' : `Gegen ${STAGES[stage].name} antreten`;
}

$('#btn-tour-start').addEventListener('click', () => startTour(tourState().stage));

function startLocal() {
  sfx.unlock();
  const roster = [
    { id: 1, name: 'Spieler 1', team: 0, look: myLook() },
    { id: 2, name: 'Spieler 2', team: 1, look: randomLook() },
  ];
  if (settings.localMode === '2v2') {
    roster.push({ id: 3, name: 'KI Rot', team: 0, bot: settings.localDiff, look: randomLook() });
    roster.push({ id: 4, name: 'KI Blau', team: 1, bot: settings.localDiff, look: randomLook() });
  }
  const s = new LocalSession('local', roster, [
    { pid: 1, slot: 0 },
    { pid: 2, slot: 1 },
  ], { topDown: true, arena: settings.localArena, goal: settings.localGoal });
  setSession(s, { playing: true });
}

// ---------- Spiel-Loop ----------

let lastT = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  if (!session) return;
  let events = [];
  try {
    events = session.update(dt);
  } catch (e) {
    console.error(e);
  }
  if (session.kind === 'demo') {
    renderer.azimuth += dt * 0.08;
    const v = session.view;
    if (v.phase === 'roundEnd' && v.phaseT > 2.5 && v.score[0] + v.score[1] >= 5) session.start();
  }
  handleEvents(events);
  if (session.kind !== 'demo') record(session.view, events);
  if (replayPending && (replayPending.wait -= dt) <= 0) {
    const info = replayPending.info;
    replayPending = null;
    startReplay(info);
  }
  if (replay) updateReplay(dt);
  else renderer.render(session.view, dt);
  if (session.kind !== 'demo') updateHud(session.view);
}

// ---------- Zeitlupen-Wiederholung ----------
// Die letzten Sekunden werden mitgeschnitten. Endet eine Runde durch einen Stoß,
// läuft der entscheidende Moment noch einmal langsam und aus der Nähe.

const recording = [];
let replay = null;
let replayPending = null;

function record(view, events) {
  const last = recording[recording.length - 1];
  if (last && view.time < last.t - 0.5) recording.length = 0; // neue Partie
  if (last && view.time <= last.t) {
    if (events.length) last.events.push(...events);
    return;
  }
  recording.push({
    t: view.time,
    angle: view.angle || 0,
    tiles: view.tiles.map((t) => t.state),
    players: view.players.map((p) => ({
      x: p.x,
      y: p.y,
      z: p.z,
      fx: p.fx,
      fz: p.fz,
      dashT: p.dashT,
      stunT: p.stunT,
      heavyT: p.heavyT,
      turboT: p.turboT,
      radius: p.radius,
      falling: p.falling,
      doomed: p.doomed,
      out: p.out,
    })),
    events: events.filter((e) => ['hit', 'clash', 'bump', 'splash', 'dash', 'shock', 'power'].includes(e.type)),
  });
  while (recording.length && recording[0].t < view.time - 3) recording.shift();
}

function scheduleReplay(info) {
  if (!info || session.kind === 'demo') return;
  replayPending = { info, wait: 0.7 };
}

function startReplay(info) {
  const frames = recording.filter((f) => f.t >= info.t - 1.25 && f.t <= info.t + 0.4);
  if (frames.length < 10) return;
  const v = session.view;
  // Eigene Ansicht der Partie für die Wiederholung (die echte läuft im Hintergrund weiter)
  const rv = {
    ...v,
    players: v.players.map((p) => ({ ...p })),
    tiles: v.tiles.map((t) => ({ ...t })),
    powerups: [],
  };
  replay = { frames, t: frames[0].t, idx: 0, rv, victim: info.victim };
  document.body.classList.add('replaying');
  renderer.labelsEl.classList.add('hidden');
}

function stopReplay() {
  replayPending = null;
  if (!replay) return;
  replay = null;
  renderer.cinematic = null;
  document.body.classList.remove('replaying');
  renderer.labelsEl.classList.remove('hidden');
}

function updateReplay(dt) {
  const r = replay;
  r.t += dt * REPLAY_SPEED;
  const f = r.frames;
  while (r.idx < f.length - 1 && f[r.idx + 1].t <= r.t) {
    r.idx++;
    for (const e of f[r.idx].events) {
      renderer.onEvent(e);
      if (e.type === 'hit' || e.type === 'clash' || e.type === 'splash') sfx.play(e.type, 0.8);
    }
  }
  const a = f[r.idx];
  const b = f[Math.min(r.idx + 1, f.length - 1)];
  const k = b.t > a.t ? Math.min(1, Math.max(0, (r.t - a.t) / (b.t - a.t))) : 0;
  const rv = r.rv;
  rv.angle = a.angle + (b.angle - a.angle) * k;
  rv.tiles.forEach((t, i) => (t.state = a.tiles[i]));
  rv.players.forEach((p, i) => {
    const pa = a.players[i];
    const pb = b.players[i];
    Object.assign(p, pa);
    for (const key of ['x', 'y', 'z', 'fx', 'fz']) p[key] = pa[key] + (pb[key] - pa[key]) * k;
  });
  const victim = rv.players.find((p) => p.id === r.victim);
  if (victim) renderer.cinematic = { x: victim.x, z: victim.z };
  renderer.render(rv, dt * REPLAY_SPEED);
  if (r.idx >= f.length - 1) stopReplay();
}

// Tippen überspringt die Wiederholung
window.addEventListener('pointerdown', () => replay && stopReplay(), true);
window.addEventListener('keydown', () => replay && stopReplay(), true);
requestAnimationFrame(frame);

function nameOf(id, cap = false) {
  const v = session.view;
  const p = v.players.find((pl) => pl.id === id);
  if (!p) return '?';
  if (session.localIds.length === 1 && session.localIds[0] === id) return cap ? 'Du' : 'dich';
  return p.name;
}

function vibrate(ms) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch {
    /* egal */
  }
}

function handleEvents(events) {
  if (!events.length) return;
  countFalls(events);
  const demo = session.kind === 'demo';
  const mine = (id) => session.localIds.includes(id);
  const single = session.localIds.length === 1;
  for (const e of events) {
    if (!replay) renderer.onEvent(e);
    if (demo) continue;
    switch (e.type) {
      case 'dash':
        sfx.play('dash', (mine(e.id) ? 1 : 0.45) * (1 + (e.charge || 0)));
        if (mine(e.id)) vibrate(12);
        break;
      case 'land':
        sfx.play('bump');
        break;
      case 'hit':
        if (e.charged && (mine(e.a) || mine(e.b))) toast(mine(e.a) ? '💥 Volltreffer!' : '😵 Voll erwischt!');
        sfx.play('hit', Math.min(1, e.power / CFG.DASH_KNOCK));
        if (mine(e.b)) vibrate(60);
        else if (mine(e.a)) vibrate(25);
        break;
      case 'clash':
        sfx.play('clash');
        if (mine(e.a) || mine(e.b)) vibrate(40);
        break;
      case 'bump':
        sfx.play('bump');
        break;
      case 'fall': {
        sfx.play('fall');
        const victim = session.view.players.find((p) => p.id === e.id);
        if (e.by != null) {
          if (single && mine(e.by)) toast(`💥 K.O.! Du hast ${esc(victim ? victim.name : '?')} rausgeschubst`);
          else if (single && mine(e.id)) toast(`${esc(nameOf(e.by, true))} hat dich rausgeschubst!`);
          else toast(`${esc(nameOf(e.by, true))} schubst ${esc(nameOf(e.id))} raus!`);
        } else toast(single && mine(e.id) ? 'Ups – du bist runtergefallen!' : `${esc(nameOf(e.id, true))} ist runtergefallen`);
        break;
      }
      case 'splash':
        sfx.play('splash');
        break;
      case 'shrink':
        sfx.play('shrink');
        break;
      case 'power':
        sfx.play('power');
        if (mine(e.id)) {
          const hint = { heavy: 'schwer wie ein Fels', turbo: 'Rammen lädt blitzschnell', shock: 'Gegner weggestoßen' }[e.kind];
          toast(`${POWER_ICONS[e.kind]} ${POWER_NAMES[e.kind]}! <small>${hint}</small>`);
        }
        break;
      case 'shock':
        sfx.play('shock');
        break;
      case 'round':
        stopReplay();
        setBanner(
          `Runde ${e.round}<small>${ARENA_LABEL[e.arena] || ''}${session.view.goal === 'huegel' ? '<br>⛰️ Hügel halten!' : ''}</small>`,
          'gold',
        );
        break;
      case 'go':
        sfx.play('go');
        setBanner('LOS!', 'gold', 700);
        break;
      case 'roundEnd': {
        const w = e.winner;
        let text = 'Unentschieden!';
        let cls = 'gold';
        if (w < 2) {
          cls = w === 0 ? 'red' : 'blue';
          const myTeam = myTeamId();
          text = single && myTeam !== null ? (w === myTeam ? 'Runde gewonnen!' : 'Runde verloren') : `${w === 0 ? 'Rot' : 'Blau'} holt die Runde!`;
          sfx.play(single && myTeam !== null && w !== myTeam ? 'lose' : 'win');
        }
        setBanner(`${text}<small>${e.score[0]} : ${e.score[1]}</small>`, cls, e.replay ? 1100 : 2600);
        scheduleReplay(e.replay);
        break;
      }
      case 'matchEnd':
        clearTimeout(resultTimer);
        resultTimer = setTimeout(showResult, 1400);
        break;
      case 'left': {
        const p = session.view.players.find((pl) => pl.id === e.id);
        if (p) {
          renderer.renameLabel(e.id, p.name + ' (KI)');
          toast(`${esc(p.name)} ist weg – die KI übernimmt`);
        }
        break;
      }
      default:
    }
  }
}

function myTeamId() {
  if (session.localIds.length !== 1) return null;
  const p = session.view.players.find((pl) => pl.id === session.localIds[0]);
  return p ? p.team : null;
}

// ---------- Anzeige ----------

function buildDots(n) {
  for (const t of [0, 1]) $('#dots' + t).innerHTML = '<i></i>'.repeat(n);
}

let bannerTimer = null;
function setBanner(html, cls = '', ms = 0) {
  clearTimeout(bannerTimer);
  for (const el of $$('#banner .b')) {
    el.innerHTML = html;
    el.className = 'b ' + (el.classList.contains('b2') ? 'b2 ' : 'b1 ') + cls;
    void el.offsetWidth;
    if (html) el.classList.add('pop');
  }
  if (ms) bannerTimer = setTimeout(() => setBanner(''), ms);
}

function toast(html) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html;
  const box = $('#toasts');
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), 2500);
}

let hudCache = '';
function updateHud(v) {
  const key = `${v.score}|${v.round}`;
  if (key !== hudCache) {
    hudCache = key;
    for (const t of [0, 1]) [...$('#dots' + t).children].forEach((d, i) => d.classList.toggle('on', i < v.score[t]));
    $('#round-lbl').textContent = `Runde ${v.round}`;
  }
  const sl = $('#shrink-lbl');
  const hillBar = $('#hill-bar');
  hillBar.classList.toggle('hidden', v.goal !== 'huegel');
  if (v.goal === 'huegel') {
    for (const t of [0, 1]) hillBar.children[t].style.setProperty('--p', Math.min(1, v.hill[t] / CFG.HILL_TARGET).toFixed(3));
    const hs = v.hillState;
    sl.textContent = v.phase !== 'play' ? '' : hs === 2 ? '⚔️ umkämpft!' : hs === 0 ? '⛰️ Rot hält' : hs === 1 ? '⛰️ Blau hält' : '⛰️ Hügel frei';
    sl.classList.toggle('warn', v.phase === 'play' && hs === 2);
  } else if (v.phase === 'play') {
    const left = v.nextShrinkAt - v.phaseT;
    const more = v.outerRing > CFG.MIN_RING || v.tiles.some((t) => t.state === 0 && t.ring > 0);
    if (!more) sl.textContent = '';
    else if (left <= 3) sl.textContent = '⚠ Arena bröckelt!';
    else sl.textContent = `Bröckelt in ${Math.ceil(left)} s`;
    sl.classList.toggle('warn', more && left <= 3);
  } else {
    sl.textContent = '';
    sl.classList.remove('warn');
  }
  if (v.phase === 'countdown') {
    const n = Math.ceil(CFG.COUNTDOWN - v.phaseT);
    if (n !== lastCount && n > 0 && n <= 3) {
      lastCount = n;
      sfx.play('count');
      setBanner(String(n), 'gold');
    }
  } else lastCount = 0;
  session.localIds.forEach((id, slot) => {
    const p = v.players.find((pl) => pl.id === id);
    if (!p) return;
    const full = p.turboT > 0 ? CFG.TURBO_COOL : CFG.DASH_COOL;
    const charge = p.charging ? Math.min(1, p.charge / CFG.CHARGE_MAX) : 0;
    controls.setCooldown(slot, p.doomed || p.out ? 1 : p.cool / full, p.heavyT > 0, charge);
  });
}

function showResult() {
  const v = session.view;
  const w = v.matchWinner;
  const myTeam = myTeamId();
  const title = $('#result-title');
  const tour = session.kind === 'tour';
  const lastStage = tour && session.tourStage === STAGES.length - 1;
  if (tour) {
    const won = w === myTeam;
    title.textContent = won ? (lastStage ? '🏆 TURNIERSIEGER!' : '✅ Gegner besiegt!') : 'Knapp verloren…';
    title.className = won ? 'win' : 'lose';
    sfx.play(won ? 'win' : 'lose');
    const next = won ? (lastStage ? 0 : session.tourStage + 1) : session.tourStage;
    store.set('tour', JSON.stringify({ stage: next }));
  } else if (myTeam !== null) {
    title.textContent = w === myTeam ? '🏆 SIEG!' : 'NIEDERLAGE';
    title.className = w === myTeam ? 'win' : 'lose';
    sfx.play(w === myTeam ? 'win' : 'lose');
  } else {
    title.textContent = `${w === 0 ? 'ROT' : 'BLAU'} GEWINNT!`;
    title.className = 'win';
    sfx.play('win');
  }
  $('#result-sub').textContent = `Endstand ${v.score[0]} : ${v.score[1]}`;
  // Eigene Statistik fortschreiben und neu Freigeschaltetes zeigen
  const unlockBox = $('#result-unlocks');
  unlockBox.innerHTML = '';
  const me = myTeam !== null && v.players.find((p) => p.id === session.localIds[0]);
  if (me && session.kind !== 'local') {
    const won = w === me.team;
    const before = loadStats();
    const after = {
      ...before,
      games: before.games + 1,
      wins: before.wins + (won ? 1 : 0),
      kos: before.kos + me.stats.ko,
      hardWins: before.hardWins + (won && (session.kind === 'ai' || tour) && session.diff === 'hard' ? 1 : 0),
      flawless: before.flawless + (won && me.stats.falls === 0 ? 1 : 0),
      tourney: before.tourney + (won && lastStage ? 1 : 0),
    };
    store.set('stats', JSON.stringify(after));
    const fresh = newlyUnlocked(before, after);
    if (fresh.length) {
      unlockBox.innerHTML =
        '<div class="unlock-title">Neu freigeschaltet!</div>' +
        fresh.map((it) => `<span class="unlock">${it.icon} ${esc(it.name)}</span>`).join('') +
        '<div class="hint small">Anziehen unter „Deine Figur“ im Menü</div>';
    }
  }
  const rows = [...v.players].sort((a, b) => a.team - b.team || b.stats.ko - a.stats.ko);
  $('#result-stats').innerHTML = rows
    .map((p) => `<tr class="team${p.team}"><td>${esc(p.name)}${session.localIds.includes(p.id) && session.localIds.length === 1 ? ' (Du)' : ''}</td><td>${p.stats.ko}</td><td>${p.stats.falls}</td></tr>`)
    .join('');
  const again = $('#btn-again');
  const back = $('#btn-result-menu');
  if (session.kind === 'client') {
    again.disabled = true;
    again.textContent = 'Warte auf Gastgeber…';
    back.textContent = 'Raum verlassen';
  } else if (tour) {
    const won = w === myTeam;
    again.disabled = false;
    again.textContent = !won ? 'Nochmal versuchen' : lastStage ? 'Neues Turnier' : `Weiter: ${STAGES[session.tourStage + 1].name} ▶`;
    back.textContent = 'Turnier-Übersicht';
  } else {
    again.disabled = false;
    again.textContent = 'Revanche';
    back.textContent = session.kind === 'host' ? 'Zur Lobby' : 'Menü';
  }
  show('scr-result');
}

// Stürze kennt der Mitspieler nicht (nur K.O.s werden übertragen) – für ihn aus Ereignissen zählen
function countFalls(events) {
  if (!session || session.kind !== 'client') return;
  for (const e of events) {
    if (e.type !== 'fall') continue;
    const p = session.view.players.find((pl) => pl.id === e.id);
    if (p) p.stats.falls++;
  }
}

$('#btn-again').addEventListener('click', () => {
  sfx.play('click');
  if (session.kind === 'host') net.send({ t: 'rematch' });
  else if (session.kind === 'tour') startTour(tourState().stage);
  else if (session.kind === 'ai' || session.kind === 'local') {
    session.start();
    setSession(session, { playing: true });
  }
});
$('#btn-result-menu').addEventListener('click', () => {
  sfx.play('click');
  if (session.kind === 'host') net.send({ t: 'lobby' });
  else if (session.kind === 'tour') {
    toMenu('scr-tour');
  } else toMenu();
});

function quit() {
  if (!session || session.kind === 'demo') return;
  if (session.kind === 'host' || session.kind === 'client') {
    if (!confirm('Online-Spiel wirklich verlassen?')) return;
  }
  toMenu();
}
$('#btn-quit').addEventListener('click', quit);
$('#btn-mute').addEventListener('click', () => {
  sfx.unlock();
  $('#btn-mute').textContent = sfx.toggle() ? '🔇' : '🔊';
});
$('#btn-mute').textContent = sfx.muted ? '🔇' : '🔊';
window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (e.code === 'Escape') quit();
  if (e.code === 'KeyM') $('#btn-mute').click();
});

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {
    wakeLock = null;
  }
}
function releaseWakeLock() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session && session.kind !== 'demo') requestWakeLock();
});

// ---------- Menüs ----------

// Namensfeld gibt es im Hauptmenü und im Online-Bildschirm (für Einladungslinks) – beide synchron halten
for (const el of $$('.name-in')) {
  el.value = store.get('name', '');
  el.addEventListener('input', () => {
    for (const other of $$('.name-in')) if (other !== el) other.value = el.value;
    store.set('name', el.value.trim());
  });
}

for (const b of $$('[data-go]')) {
  b.addEventListener('click', () => {
    sfx.unlock();
    sfx.play('click');
    show(b.dataset.go);
  });
}

function syncSegs() {
  for (const seg of $$('[data-set]')) {
    for (const b of seg.children) b.classList.toggle('on', b.dataset.v === settings[seg.dataset.set]);
  }
  for (const el of $$('[data-show]')) {
    const [k, v] = el.dataset.show.split('=');
    el.classList.toggle('hidden', settings[k] !== v);
  }
}
for (const seg of $$('[data-set]')) {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    sfx.play('click');
    settings[seg.dataset.set] = b.dataset.v;
    store.set(seg.dataset.set, b.dataset.v);
    syncSegs();
  });
}
syncSegs();

$('#btn-ai-start').addEventListener('click', startAi);
$('#btn-local-start').addEventListener('click', startLocal);

// ---------- Online ----------

function onlineStatus(text) {
  $('#online-status').textContent = text;
}

function setOnlineBusy(busy) {
  for (const id of ['#btn-create', '#btn-join']) $(id).disabled = busy;
}

$('#btn-create').addEventListener('click', async () => {
  sfx.unlock();
  setOnlineBusy(true);
  onlineStatus('Raum wird erstellt…');
  try {
    await net.create();
    onlineStatus('');
  } catch (e) {
    onlineStatus(e.message || 'Fehler beim Erstellen.');
  }
  setOnlineBusy(false);
});

async function join(code) {
  sfx.unlock();
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 4) return onlineStatus('Der Code hat 4 Zeichen.');
  setOnlineBusy(true);
  onlineStatus('Verbinde…');
  try {
    await net.join(code);
    onlineStatus('');
  } catch (e) {
    onlineStatus(e.message || 'Beitreten fehlgeschlagen.');
  }
  setOnlineBusy(false);
}
$('#btn-join').addEventListener('click', () => join($('#in-code').value));
$('#in-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join($('#in-code').value);
});

net.on('room', (msg) => {
  room = msg;
  const inMatch = session && (session.kind === 'host' || session.kind === 'client');
  if (inMatch) return;
  renderLobby();
  show('scr-lobby');
  if (msg.state === 'match') $('#lobby-info').textContent = 'Die Partie läuft gerade – du schaust gleich zu.';
});

net.on('start', (msg) => {
  $('#toasts').innerHTML = '';
  if (net.isHost) setSession(new HostSession(), { playing: true });
  else setSession(new ClientSession(msg), { playing: true });
  if (session.kind === 'client' && !session.isPlayer) toast('Du schaust zu – in der nächsten Partie spielst du mit.');
});

net.on('s', (msg) => {
  if (session && session.kind === 'client') session.onSnap(msg);
});

net.on('lobby', () => {
  setSession(demoSession(), { playing: false });
  if (room) renderLobby();
  show('scr-lobby');
});

net.on('toast', (msg) => {
  if (!$('#scr-lobby').classList.contains('hidden')) $('#lobby-info').textContent = msg.msg;
  else toast(esc(msg.msg));
});

net.on('hostlost', () => {
  toMenu('scr-msg');
  $('#msg-text').textContent = 'Die Verbindung zum Gastgeber ist abgebrochen.';
});
$('#btn-msg-ok').addEventListener('click', () => show('scr-menu'));

function hatIcon(look) {
  const hat = look && HATS.find((h) => h.id === look.hat);
  return hat && hat.id !== 'none' ? hat.icon : '';
}

function renderLobby() {
  if (!room) return;
  const size = teamSizeOf(room.mode);
  const isHost = room.hostId === net.id;
  $('#lobby-code').textContent = room.code;
  for (const team of [0, 1]) {
    const members = room.players.filter((p) => p.team === team);
    let html = members
      .map(
        (p) =>
          `<li>${p.id === room.hostId ? '⭐ ' : ''}${esc(p.name)} ${hatIcon(p.look)}${p.id === net.id ? '<span class="tag">DU</span>' : ''}</li>`,
      )
      .join('');
    for (let k = members.length; k < size; k++) html += room.fill ? '<li class="bot">🤖 KI</li>' : '<li class="empty">frei</li>';
    $('#team' + team).innerHTML = html;
    const me = room.players.find((p) => p.id === net.id);
    const btn = $(`[data-team="${team}"]`);
    btn.disabled = room.state !== 'lobby' || !me || me.team === team || members.length >= size;
  }
  for (const seg of $$('[data-room]')) {
    const val = String(room[seg.dataset.room]);
    for (const b of seg.children) b.classList.toggle('on', b.dataset.v === val);
    seg.classList.toggle('locked', !isHost);
  }
  $('#btn-start').classList.toggle('hidden', !isHost);
  $('#btn-start').disabled = !!room.problem || room.state !== 'lobby';
  let info = '';
  if (room.problem) info = room.problem;
  else if (!isHost) info = 'Warte, bis der Gastgeber startet…';
  else if (room.players.length === 1) info = 'Lade Freunde mit dem Code oder dem Link ein – oder starte gleich gegen die KI.';
  else info = 'Alle bereit? Dann los!';
  $('#lobby-info').textContent = info;
}

for (const b of $$('[data-team]')) {
  b.addEventListener('click', () => {
    sfx.play('click');
    net.send({ t: 'team', team: +b.dataset.team });
  });
}
for (const seg of $$('[data-room]')) {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !room || room.hostId !== net.id) return;
    sfx.play('click');
    const key = seg.dataset.room;
    const value = key === 'fill' ? b.dataset.v === 'true' : b.dataset.v;
    net.send({ t: 'settings', [key]: value });
  });
}
$('#btn-start').addEventListener('click', () => {
  sfx.unlock();
  net.send({ t: 'start' });
});
$('#btn-leave').addEventListener('click', () => {
  sfx.play('click');
  toMenu('scr-online');
});
$('#btn-share').addEventListener('click', async () => {
  if (!room) return;
  const url = `${location.origin}${location.pathname}?room=${room.code}`;
  const text = `Komm zu Sumo Smash! Raumcode: ${room.code}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Sumo Smash', text, url });
      return;
    }
  } catch {
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    $('#lobby-info').textContent = 'Link kopiert – schick ihn deinen Freunden!';
  } catch {
    $('#lobby-info').textContent = url;
  }
});

// ---------- Deine Figur ----------

let preview = null;

function openLookScreen() {
  if (!preview) {
    try {
      preview = new Preview($('#look-canvas'));
    } catch {
      preview = null;
    }
  }
  renderLookScreen();
  if (preview) preview.start();
}

function renderLookScreen() {
  const stats = loadStats();
  const look = myLook();
  const grid = (items, key) =>
    items
      .map((it) => {
        const open = isUnlocked(it, stats);
        const on = look[key] === it.id;
        return `<button class="look-item${on ? ' on' : ''}${open ? '' : ' locked'}" data-key="${key}" data-id="${it.id}">
          <span class="li-icon">${open ? it.icon : '🔒'}</span><span class="li-name">${esc(it.name)}</span></button>`;
      })
      .join('');
  $('#hat-grid').innerHTML = grid(HATS, 'hat');
  $('#extra-grid').innerHTML = grid(EXTRAS, 'extra');
  $('#look-stats').textContent = `Siege: ${stats.wins} · K.O.s: ${stats.kos} · Partien: ${stats.games}`;
  if (preview) preview.setLook(look, 0);
}

for (const id of ['#hat-grid', '#extra-grid']) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('.look-item');
    if (!b) return;
    sfx.play('click');
    const list = b.dataset.key === 'hat' ? HATS : EXTRAS;
    const item = list.find((it) => it.id === b.dataset.id);
    if (!isUnlocked(item, loadStats())) {
      $('#look-hint').textContent = `🔒 ${item.name}: ${item.hint}`;
      return;
    }
    $('#look-hint').textContent = '';
    const look = myLook();
    look[b.dataset.key] = item.id;
    store.set('look', JSON.stringify(look));
    renderLookScreen();
  });
}

// ---------- Start ----------

// Für Tests und Fehlersuche in der Browser-Konsole
window.sumoSmash = {
  get session() {
    return session;
  },
  net,
};

setSession(demoSession(), { playing: false });
const invite = new URLSearchParams(location.search).get('room');
if (invite) {
  $('#in-code').value = invite.toUpperCase().slice(0, 4);
  show('scr-online');
  onlineStatus('Du wurdest eingeladen – tippe auf „Beitreten“.');
} else show('scr-menu');
