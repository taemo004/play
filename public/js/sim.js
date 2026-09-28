// Spiellogik von Sumo Smash – ohne Grafik, läuft im Browser und in Node (Tests).
// Koordinaten: Boden ist die x/z-Ebene, y zeigt nach oben. Einheiten: Meter und Sekunden.

export const CFG = {
  TILE: 1, // Sechseck-Größe (Mitte bis Ecke)
  PR: 0.7, // Radius eines Spielers
  SPEED: 5.6,
  CONTROL: 8, // wie schnell die Bewegung dem Stick folgt
  STUN_DAMP: 2.2, // Abbremsen nach einem Treffer (man rutscht weit)
  STUN_CONTROL: 0.7,
  DASH_SPEED: 15.5,
  DASH_TIME: 0.2,
  DASH_COOL: 1.25,
  TURBO_COOL: 0.45,
  DASH_BUFFER: 0.15, // Tippen kurz vor Ende der Abklingzeit zählt trotzdem
  DASH_KNOCK: 11,
  CLASH_KNOCK: 8.5,
  BUMP_E: 0.5,
  STUN_TIME: 0.5,
  STUN_DASH_OK: 0.2, // gegen Ende der Betäubung darf man sich schon wieder retten
  GRAVITY: 30,
  DOOM_Y: -0.35, // ab hier ist ein Sturz nicht mehr zu retten
  LAVA_Y: -6,
  OUT_Y: -9,
  COUNTDOWN: 3,
  ROUND_END: 3,
  REPLAY_EXTRA: 2, // Runde endet durch K.O.: etwas länger Pause für die Zeitlupen-Wiederholung
  SPIN_RAMP: 8, // so lange dauert es, bis das Karussell volle Fahrt hat
  CENTRIFUGAL: 2.5,
  ROUND_LIMIT: 100, // Sicherheitsnetz: danach Unentschieden
  SHRINK_START: 12,
  SHRINK_EVERY: 8,
  CRUMBLE_TIME: 2,
  MIN_RING: 1,
  POWER_FIRST: 6,
  POWER_EVERY: 9,
  POWER_LIFE: 12,
  HEAVY_TIME: 7,
  HEAVY_MASS: 2.4,
  HEAVY_SCALE: 1.35,
  TURBO_TIME: 6,
  SHOCK_RADIUS: 4.5,
  SHOCK_KNOCK: 12,
  KO_WINDOW: 4, // so lange nach einem Treffer zählt ein Sturz als K.O. für den Angreifer
  CHARGE_MAX: 0.9, // so lange lädt das Rammen maximal auf
  CHARGE_SLOW: 0.35, // beim Aufladen läuft man langsamer
  CHARGE_KNOCK: 0.8, // voll geladen: +80 % Wucht
  CHARGE_SPEED: 0.3, // voll geladen: +30 % Sprint-Tempo
  HILL_RING: 1, // Hügel = Mittelfeld und der Ring darum
  HILL_TARGET: 12, // Sekunden auf dem Hügel für den Rundensieg
  RESPAWN: 2.5, // Hügel-Modus: so lange dauert es bis zur Rückkehr
  DROP_Y: 6, // Rückkehr fällt vom Himmel
};

export const GOALS = { sumo: 'Runterschubsen', huegel: 'Hügel halten' };

export const PHASES = ['countdown', 'play', 'roundEnd', 'matchEnd'];

// Arenen: gleiche Steuerung, anderes Fahrgefühl
export const ARENAS = {
  lava: { name: 'Vulkan', control: 8, stunDamp: 2.2, stunControl: 0.7, knock: 1, spin: 0 },
  eis: { name: 'Gletscher', control: 2.3, stunDamp: 1.6, stunControl: 0.35, knock: 0.75, spin: 0 },
  dreh: { name: 'Karussell', control: 8, stunDamp: 2.2, stunControl: 0.7, knock: 1, spin: 0.42 },
};
export const ARENA_IDS = Object.keys(ARENAS);
export const ARENA_MODES = [...ARENA_IDS, 'mix']; // mix: jede Runde eine andere Arena
export const POWER_TYPES = ['heavy', 'turbo', 'shock'];
export const TEAM_NAMES = ['Rot', 'Blau'];

const SQRT3 = Math.sqrt(3);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Sechseck-Raster ----------

export function hexToPoint(q, r) {
  return { x: CFG.TILE * SQRT3 * (q + r / 2), z: CFG.TILE * 1.5 * r };
}

export function pointToHex(x, z) {
  const qf = ((SQRT3 / 3) * x - z / 3) / CFG.TILE;
  const rf = ((2 / 3) * z) / CFG.TILE;
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q: q || 0, r: r || 0 }; // kein -0
}

const tileKey = (q, r) => (q + 64) * 128 + (r + 64);

export function buildTiles(rings) {
  const tiles = [];
  for (let q = -rings; q <= rings; q++) {
    for (let r = Math.max(-rings, -q - rings); r <= Math.min(rings, -q + rings); r++) {
      const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      const { x, z } = hexToPoint(q, r);
      tiles.push({ i: tiles.length, q, r, ring, x, z, state: 0, t: 0 });
    }
  }
  return tiles;
}

export function tileAt(m, x, z) {
  if (m.angle) {
    // Weltpunkt in das (gedrehte) Arena-Koordinatensystem zurückdrehen
    const c = Math.cos(m.angle);
    const s = Math.sin(m.angle);
    const ax = x * c + z * s;
    const az = -x * s + z * c;
    x = ax;
    z = az;
  }
  const { q, r } = pointToHex(x, z);
  return m.tileIndex.get(tileKey(q, r)) || null;
}

export function isSolid(m, x, z) {
  const t = tileAt(m, x, z);
  return !!t && t.state !== 2;
}

// Radius, bis zu dem die Arena sicher ist (Innenkreis der noch festen Ringe)
export function safeRadius(m) {
  return (m.outerRing + 0.5) * SQRT3 * CFG.TILE * 0.95;
}

// ---------- Spiel anlegen ----------

// roster: [{ id, name, team (0|1), bot?: 'easy'|'normal'|'hard' }]
export function createMatch({ roster, rings, winRounds = 3, arena = 'lava', goal = 'sumo', startAt = null, seed = (Math.random() * 2 ** 32) >>> 0 }) {
  const teamSize = Math.max(...[0, 1].map((t) => roster.filter((p) => p.team === t).length));
  rings = rings || (teamSize > 1 ? 5 : 4);
  const tiles = buildTiles(rings);
  const rng = mulberry32(seed);
  const mode = ARENA_MODES.includes(arena) ? arena : 'lava';
  const order = [...ARENA_IDS].sort(() => rng() - 0.5);
  const m = {
    rings,
    winRounds,
    seed,
    rng,
    arenaMode: mode,
    goal: GOALS[goal] ? goal : 'sumo',
    hill: [0, 0],
    hillState: -1, // -1 frei, 0/1 Team hält ihn, 2 umkämpft
    arenaOrder: order,
    arena: mode === 'mix' ? order[0] : mode,
    angle: 0,
    spin: 0,
    spinDir: 1,
    roundEndLen: CFG.ROUND_END,
    replay: null,
    time: 0,
    phase: 'countdown',
    phaseT: 0,
    round: 0,
    score: [0, 0],
    roundWinner: -1, // -1 noch offen, 0/1 Team, 2 Unentschieden
    matchWinner: -1,
    players: roster.map((r, slot) => makePlayer(r, slot)),
    tiles,
    tileIndex: new Map(tiles.map((t) => [tileKey(t.q, t.r), t])),
    tilesVersion: 0,
    outerRing: rings,
    nextShrinkAt: CFG.SHRINK_START,
    powerups: [],
    powerSeq: 0,
    nextPowerAt: CFG.POWER_FIRST,
    events: [],
  };
  // Fortsetzen nach Gastgeber-Wechsel: Spielstand übernehmen, die abgebrochene Runde startet neu
  if (startAt) {
    m.score = [startAt.score[0] | 0, startAt.score[1] | 0];
    m.round = Math.max(0, (startAt.round | 0) - 1);
  }
  startRound(m);
  return m;
}

function makePlayer(r, slot) {
  return {
    id: r.id,
    name: r.name || 'Spieler',
    team: r.team === 1 ? 1 : 0,
    bot: r.bot || null,
    look: r.look || { hat: 'none', extra: 'none' },
    slot,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    fx: 0,
    fz: -1,
    dashT: 0,
    dashBuf: 0,
    cool: 0,
    stunT: 0,
    heavyT: 0,
    turboT: 0,
    baseMass: r.mass > 0 ? r.mass : 1,
    baseRadius: CFG.PR * (r.size > 0 ? r.size : 1),
    mass: r.mass > 0 ? r.mass : 1,
    radius: CFG.PR * (r.size > 0 ? r.size : 1),
    charge: 0,
    charging: false,
    dashPower: 1,
    respawnT: 0,
    drop: false,
    sx: 0,
    sz: 0,
    falling: false,
    doomed: false,
    out: false,
    splashed: false,
    lastHitBy: null,
    lastHitT: -99,
    stats: { ko: 0, falls: 0, hits: 0 },
  };
}

function emit(m, type, data) {
  m.events.push({ t: m.time, ...data, type });
}

export function startRound(m) {
  m.round++;
  m.phase = 'countdown';
  m.phaseT = 0;
  m.roundWinner = -1;
  if (m.arenaMode === 'mix') m.arena = m.arenaOrder[(m.round - 1) % m.arenaOrder.length];
  m.angle = 0;
  m.spin = 0;
  m.spinDir = m.round % 2 ? 1 : -1;
  m.roundEndLen = CFG.ROUND_END;
  m.replay = null;
  for (const t of m.tiles) {
    t.state = 0;
    t.t = 0;
  }
  m.tilesVersion++;
  m.outerRing = m.rings;
  m.nextShrinkAt = CFG.SHRINK_START;
  m.powerups = [];
  m.nextPowerAt = CFG.POWER_FIRST;
  m.hill = [0, 0];
  m.hillState = -1;
  const spawnD = CFG.TILE * 1.5 * Math.ceil(m.rings * 0.6);
  for (const team of [0, 1]) {
    const members = m.players.filter((p) => p.team === team);
    const side = team === 0 ? 1 : -1; // Team Rot startet unten (+z), Blau oben (-z)
    members.forEach((p, k) => {
      const offset = (k - (members.length - 1) / 2) * 3.2;
      p.sx = offset * side;
      p.sz = spawnD * side;
      Object.assign(p, {
        x: p.sx,
        z: p.sz,
        y: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        fx: 0,
        fz: -side,
        dashT: 0,
        dashBuf: 0,
        cool: 0,
        stunT: 0,
        heavyT: 0,
        turboT: 0,
        mass: p.baseMass,
        radius: p.baseRadius,
        charge: 0,
        charging: false,
        dashPower: 1,
        respawnT: 0,
        drop: false,
        falling: false,
        doomed: false,
        out: false,
        splashed: false,
        lastHitBy: null,
        lastHitT: -99,
      });
    });
  }
  emit(m, 'round', { round: m.round, arena: m.arena });
}

// ---------- Simulation ----------

// inputs: Map id -> { x, z, dash } (x/z in Weltkoordinaten, Länge ≤ 1; dash = in diesem Schritt getippt)
export function stepMatch(m, dt, inputs) {
  m.time += dt;
  m.phaseT += dt;
  const frozen = m.phase === 'countdown';
  if (m.phase === 'countdown' && m.phaseT >= CFG.COUNTDOWN) {
    m.phase = 'play';
    m.phaseT = 0;
    emit(m, 'go', {});
  }
  if (m.phase === 'play') {
    if (m.goal !== 'huegel') updateShrink(m, dt); // beim Hügel-Modus bleibt die Arena ganz
    updatePowerups(m, dt);
  }
  updateSpin(m, dt);
  updateTiles(m, dt);
  updatePlayers(m, dt, inputs, frozen);
  collide(m);
  updateSupport(m, dt);
  if (m.phase === 'play') {
    pickupPowerups(m);
    if (m.goal === 'huegel') updateHill(m, dt);
    checkRoundEnd(m);
  } else if (m.phase === 'roundEnd' && m.phaseT >= m.roundEndLen) {
    if (m.matchWinner >= 0) {
      m.phase = 'matchEnd';
      m.phaseT = 0;
      emit(m, 'matchEnd', { winner: m.matchWinner });
    } else startRound(m);
  }
}

// Karussell: Arena dreht sich immer schneller und nimmt alle mit, die darauf stehen
function updateSpin(m, dt) {
  const arena = ARENAS[m.arena];
  if (!arena.spin || m.phase === 'countdown') return;
  const target = m.phase === 'play' ? arena.spin * Math.min(1, m.phaseT / CFG.SPIN_RAMP) * m.spinDir : m.spin;
  m.spin = target;
  const da = m.spin * dt;
  if (!da) return;
  m.angle += da;
  const c = Math.cos(da);
  const s = Math.sin(da);
  const turn = (o) => {
    const x = o.x * c - o.z * s;
    o.z = o.x * s + o.z * c;
    o.x = x;
  };
  for (const p of m.players) {
    if (p.out || p.falling) continue;
    turn(p);
    // Fliehkraft zieht nach außen
    const f = CFG.CENTRIFUGAL * m.spin * m.spin * dt;
    p.vx += p.x * f;
    p.vz += p.z * f;
  }
  for (const pu of m.powerups) turn(pu);
}

function updateShrink(m, dt) {
  if (m.phaseT < m.nextShrinkAt) return;
  m.nextShrinkAt += CFG.SHRINK_EVERY;
  if (m.outerRing > CFG.MIN_RING) {
    const ring = m.outerRing;
    for (const t of m.tiles) {
      if (t.ring === ring && t.state === 0) crumble(m, t, m.rng() * 0.9);
    }
    m.outerRing--;
    emit(m, 'shrink', { ring });
  } else {
    // Verlängerung: einzelne Felder brechen weg, bis nur noch die Mitte übrig ist
    const left = m.tiles.filter((t) => t.state === 0 && t.ring > 0);
    if (left.length) {
      crumble(m, left[Math.floor(m.rng() * left.length)], 0);
      emit(m, 'shrink', { ring: 1 });
    }
  }
}

function crumble(m, t, extra) {
  t.state = 1;
  t.t = CFG.CRUMBLE_TIME + extra;
  m.tilesVersion++;
}

function updateTiles(m, dt) {
  for (const t of m.tiles) {
    if (t.state !== 1) continue;
    t.t -= dt;
    if (t.t <= 0) {
      t.state = 2;
      m.tilesVersion++;
    }
  }
}

function updatePowerups(m, dt) {
  for (const pu of m.powerups) pu.life -= dt;
  const before = m.powerups.length;
  m.powerups = m.powerups.filter((pu) => {
    const tile = tileAt(m, pu.x, pu.z);
    const ok = pu.life > 0 && tile && tile.state === 0;
    if (!ok) emit(m, 'pvanish', { pid: pu.id, x: pu.x, z: pu.z });
    return ok;
  });
  if (m.powerups.length < before) m.nextPowerAt = Math.max(m.nextPowerAt, m.phaseT + 3);
  if (m.powerups.length || m.phaseT < m.nextPowerAt) return;
  m.nextPowerAt = m.phaseT + CFG.POWER_EVERY;
  const maxRing = Math.max(0, m.outerRing - 1);
  const spots = m.tiles.filter(
    (t) =>
      t.state === 0 &&
      t.ring <= maxRing &&
      m.players.every((p) => p.out || Math.hypot(p.x - t.x, p.z - t.z) > 2.2),
  );
  if (!spots.length) return;
  const t = spots[Math.floor(m.rng() * spots.length)];
  const type = POWER_TYPES[Math.floor(m.rng() * POWER_TYPES.length)];
  const pu = { id: ++m.powerSeq, type, x: t.x, z: t.z, life: CFG.POWER_LIFE };
  m.powerups.push(pu);
  emit(m, 'pspawn', { pid: pu.id, kind: type, x: pu.x, z: pu.z });
}

function pickupPowerups(m) {
  for (const pu of [...m.powerups]) {
    for (const p of m.players) {
      if (p.out || p.falling) continue;
      if (Math.hypot(p.x - pu.x, p.z - pu.z) > p.radius + 0.55) continue;
      m.powerups = m.powerups.filter((o) => o !== pu);
      m.nextPowerAt = m.phaseT + CFG.POWER_EVERY;
      emit(m, 'power', { id: p.id, kind: pu.type, x: pu.x, z: pu.z });
      applyPower(m, p, pu.type);
      break;
    }
  }
}

function applyPower(m, p, type) {
  if (type === 'heavy') {
    p.heavyT = CFG.HEAVY_TIME;
    p.mass = p.baseMass * CFG.HEAVY_MASS;
    p.radius = p.baseRadius * CFG.HEAVY_SCALE;
  } else if (type === 'turbo') {
    p.turboT = CFG.TURBO_TIME;
    p.cool = Math.min(p.cool, CFG.TURBO_COOL);
  } else if (type === 'shock') {
    emit(m, 'shock', { id: p.id, x: p.x, z: p.z });
    for (const o of m.players) {
      if (o.team === p.team || o.out || o.falling) continue;
      const dx = o.x - p.x;
      const dz = o.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > CFG.SHOCK_RADIUS || d < 1e-6) continue;
      const s = (CFG.SHOCK_KNOCK * (1 - (d / CFG.SHOCK_RADIUS) * 0.5)) / o.mass;
      o.vx += (dx / d) * s;
      o.vz += (dz / d) * s;
      o.dashT = 0;
      stun(m, o, p, CFG.STUN_TIME);
    }
  }
}

function stun(m, victim, by, time) {
  victim.stunT = Math.max(victim.stunT, time * (victim.heavyT > 0 ? 0.6 : 1));
  if (by && by.team !== victim.team) {
    victim.lastHitBy = by.id;
    victim.lastHitT = m.time;
  }
}

function updatePlayers(m, dt, inputs, frozen) {
  for (const p of m.players) {
    if (p.out) continue;
    p.cool = Math.max(0, p.cool - dt);
    p.dashBuf = Math.max(0, p.dashBuf - dt);
    p.stunT = Math.max(0, p.stunT - dt);
    if (p.dashT > 0) p.dashT = Math.max(0, p.dashT - dt);
    if (p.turboT > 0) p.turboT = Math.max(0, p.turboT - dt);
    if (p.heavyT > 0) {
      p.heavyT = Math.max(0, p.heavyT - dt);
      if (p.heavyT === 0) {
        p.mass = p.baseMass;
        p.radius = p.baseRadius;
      }
    }
    if (p.falling) continue;

    const inp = (inputs && inputs.get(p.id)) || null;
    let ix = inp ? +inp.x || 0 : 0;
    let iz = inp ? +inp.z || 0 : 0;
    const len = Math.hypot(ix, iz);
    if (len > 1) {
      ix /= len;
      iz /= len;
    }
    const mag = Math.min(1, len);
    if (mag > 0.15 && p.stunT <= 0) {
      // Blickrichtung dreht zum Stick
      const k = 1 - Math.exp(-14 * dt);
      const fx = p.fx + (ix / (len || 1) - p.fx) * k;
      const fz = p.fz + (iz / (len || 1) - p.fz) * k;
      const fl = Math.hypot(fx, fz) || 1;
      p.fx = fx / fl;
      p.fz = fz / fl;
    }
    if (frozen) {
      p.vx = p.vz = 0;
      continue;
    }

    if (inp && inp.dash) p.dashBuf = CFG.DASH_BUFFER;
    const holding = !!(inp && inp.hold);
    // Aufladen: Taste halten (nur wenn Rammen bereit ist); loslassen löst den Stoß aus
    if (holding && p.cool <= 0 && p.stunT <= 0 && p.dashT <= 0) {
      p.charging = true;
      p.charge = Math.min(CFG.CHARGE_MAX, p.charge + dt);
    }
    if (p.stunT > 0 || (!holding && p.dashBuf <= 0)) {
      p.charging = false;
      p.charge = 0;
    }
    if (p.dashBuf > 0 && p.cool <= 0 && p.stunT <= CFG.STUN_DASH_OK && p.dashT <= 0) {
      let dx = p.fx;
      let dz = p.fz;
      if (mag > 0.2) {
        dx = ix / (len || 1);
        dz = iz / (len || 1);
        p.fx = dx;
        p.fz = dz;
      }
      const frac = p.charge / CFG.CHARGE_MAX;
      p.dashPower = 1 + CFG.CHARGE_KNOCK * frac;
      p.charge = 0;
      p.charging = false;
      const sp = CFG.DASH_SPEED * (p.heavyT > 0 ? 0.85 : 1) * (1 + CFG.CHARGE_SPEED * frac);
      p.vx = dx * sp;
      p.vz = dz * sp;
      p.dashT = CFG.DASH_TIME;
      p.dashBuf = 0;
      p.stunT = 0;
      p.cool = p.turboT > 0 ? CFG.TURBO_COOL : CFG.DASH_COOL;
      emit(m, 'dash', { id: p.id, charge: Math.round(frac * 100) / 100 });
    }

    if (p.dashT <= 0) {
      const speed = CFG.SPEED * (p.heavyT > 0 ? 0.85 : 1) * (p.charging ? CFG.CHARGE_SLOW : 1);
      const tx = ix * speed;
      const tz = iz * speed;
      const arena = ARENAS[m.arena];
      if (p.stunT > 0) {
        const damp = Math.exp(-arena.stunDamp * dt);
        p.vx *= damp;
        p.vz *= damp;
        const k = 1 - Math.exp(-arena.stunControl * dt);
        p.vx += (tx - p.vx) * k;
        p.vz += (tz - p.vz) * k;
      } else {
        const k = 1 - Math.exp(-arena.control * dt);
        p.vx += (tx - p.vx) * k;
        p.vz += (tz - p.vz) * k;
      }
    }
    p.x += p.vx * dt;
    p.z += p.vz * dt;
  }
}

function collide(m) {
  const ps = m.players;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i];
    if (a.out || a.y < -0.5 || a.y > 0.5) continue;
    for (let j = i + 1; j < ps.length; j++) {
      const b = ps[j];
      if (b.out || b.y < -0.5 || b.y > 0.5) continue;
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      let d = Math.hypot(dx, dz);
      const minD = a.radius + b.radius;
      if (d >= minD) continue;
      if (d < 1e-6) {
        dx = 1;
        dz = 0;
        d = 1;
      }
      const nx = dx / d;
      const nz = dz / d;
      const ima = 1 / a.mass;
      const imb = 1 / b.mass;
      const overlap = (minD - Math.min(d, minD)) / (ima + imb);
      a.x -= nx * overlap * ima;
      a.z -= nz * overlap * ima;
      b.x += nx * overlap * imb;
      b.z += nz * overlap * imb;

      const rv = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz; // > 0: sie bewegen sich aufeinander zu
      if (rv <= 0) continue;
      const aDash = a.dashT > 0;
      const bDash = b.dashT > 0;
      const x = (a.x + b.x) / 2;
      const z = (a.z + b.z) / 2;
      if (aDash && bDash) {
        const ka = CFG.CLASH_KNOCK * b.dashPower * clamp(b.mass / a.mass, 0.4, 2.5);
        const kb = CFG.CLASH_KNOCK * a.dashPower * clamp(a.mass / b.mass, 0.4, 2.5);
        a.vx = -nx * ka;
        a.vz = -nz * ka;
        b.vx = nx * kb;
        b.vz = nz * kb;
        a.dashT = b.dashT = 0;
        stun(m, a, b, CFG.STUN_TIME * 0.7);
        stun(m, b, a, CFG.STUN_TIME * 0.7);
        emit(m, 'clash', { a: a.id, b: b.id, x, z });
      } else if (aDash || bDash) {
        const atk = aDash ? a : b;
        const vic = aDash ? b : a;
        const sx = aDash ? nx : -nx;
        const sz = aDash ? nz : -nz;
        const power = CFG.DASH_KNOCK * ARENAS[m.arena].knock * atk.dashPower * clamp(atk.mass / vic.mass, 0.4, 2.5);
        // Eigenbewegung des Opfers quer zum Stoß bleibt, die Komponente in Stoßrichtung wird ersetzt
        const along = vic.vx * sx + vic.vz * sz;
        const push = power + Math.max(0, along) * 0.3;
        vic.vx += (push - along) * sx;
        vic.vz += (push - along) * sz;
        atk.vx *= 0.2;
        atk.vz *= 0.2;
        atk.dashT = 0;
        vic.dashT = 0;
        stun(m, vic, atk, CFG.STUN_TIME);
        if (atk.team !== vic.team) atk.stats.hits++;
        emit(m, 'hit', { a: atk.id, b: vic.id, x, z, power, charged: atk.dashPower > 1.5 });
      } else {
        const jn = ((1 + CFG.BUMP_E) * rv) / (ima + imb);
        a.vx -= jn * ima * nx;
        a.vz -= jn * ima * nz;
        b.vx += jn * imb * nx;
        b.vz += jn * imb * nz;
        if (rv > 2.5) {
          stun(m, a, b, 0.12);
          stun(m, b, a, 0.12);
          emit(m, 'bump', { a: a.id, b: b.id, x, z, power: rv });
        }
      }
    }
  }
}

function updateSupport(m, dt) {
  for (const p of m.players) {
    if (p.out) {
      // Hügel-Modus: nach kurzer Zeit fällt man an seinem Startplatz wieder vom Himmel
      if (m.goal === 'huegel' && m.phase === 'play' && (p.respawnT -= dt) <= 0) respawn(m, p);
      continue;
    }
    if (p.drop) {
      p.vy -= CFG.GRAVITY * 0.6 * dt;
      p.y += p.vy * dt;
      if (p.y <= 0) {
        Object.assign(p, { y: 0, vy: 0, falling: false, drop: false });
        emit(m, 'land', { id: p.id, x: p.x, z: p.z });
      }
      continue;
    }
    const supported = isSolid(m, p.x, p.z);
    if (!p.falling) {
      if (!supported) {
        p.falling = true;
        p.vy = 0;
      }
      continue;
    }
    if (supported && p.y > CFG.DOOM_Y) {
      // Gerade noch die Kante erwischt
      p.falling = false;
      p.y = 0;
      p.vy = 0;
      continue;
    }
    p.vy -= CFG.GRAVITY * dt;
    p.y += p.vy * dt;
    const damp = Math.exp(-0.6 * dt);
    p.vx *= damp;
    p.vz *= damp;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    if (!p.doomed && p.y <= CFG.DOOM_Y) {
      p.doomed = true;
      p.stats.falls++;
      const byP = m.players.find((o) => o.id === p.lastHitBy);
      const by = byP && m.time - p.lastHitT < CFG.KO_WINDOW ? byP : null;
      if (by) by.stats.ko++;
      emit(m, 'fall', { id: p.id, by: by ? by.id : null, x: p.x, z: p.z });
    }
    if (!p.splashed && p.y <= CFG.LAVA_Y) {
      p.splashed = true;
      emit(m, 'splash', { id: p.id, x: p.x, z: p.z });
    }
    if (p.y <= CFG.OUT_Y) {
      p.out = true;
      p.respawnT = CFG.RESPAWN;
    }
  }
}

function respawn(m, p) {
  Object.assign(p, {
    x: p.sx,
    z: p.sz,
    y: CFG.DROP_Y,
    vx: 0,
    vy: 0,
    vz: 0,
    fx: 0,
    fz: p.team === 0 ? -1 : 1,
    dashT: 0,
    stunT: 0,
    heavyT: 0,
    turboT: 0,
    mass: p.baseMass,
    radius: p.baseRadius,
    charge: 0,
    charging: false,
    falling: true,
    drop: true,
    doomed: false,
    out: false,
    splashed: false,
    lastHitBy: null,
  });
  emit(m, 'respawn', { id: p.id });
}

// Wer steht auf dem Hügel? Punkte gibt es nur, wenn ein Team ihn allein hält.
function updateHill(m, dt) {
  const on = [false, false];
  for (const p of m.players) {
    if (p.out || p.falling) continue;
    const t = tileAt(m, p.x, p.z);
    if (t && t.ring <= CFG.HILL_RING && t.state !== 2) on[p.team] = true;
  }
  const state = on[0] && on[1] ? 2 : on[0] ? 0 : on[1] ? 1 : -1;
  if (state === 0 || state === 1) m.hill[state] = Math.min(CFG.HILL_TARGET, m.hill[state] + dt);
  if (state !== m.hillState) {
    m.hillState = state;
    emit(m, 'hill', { state });
  }
}

function checkRoundEnd(m) {
  let winner;
  if (m.goal === 'huegel') {
    const done = m.hill[0] >= CFG.HILL_TARGET || m.hill[1] >= CFG.HILL_TARGET;
    if (!done && m.phaseT < CFG.ROUND_LIMIT) return;
    winner = m.hill[0] > m.hill[1] ? 0 : m.hill[1] > m.hill[0] ? 1 : 2;
  } else {
    const standing = [0, 1].map((team) => m.players.some((p) => p.team === team && !p.doomed));
    if (standing[0] && standing[1] && m.phaseT < CFG.ROUND_LIMIT) return;
    winner = standing[0] && !standing[1] ? 0 : standing[1] && !standing[0] ? 1 : 2;
  }
  m.roundWinner = winner;
  // Entscheidender Sturz durch einen Stoß? Dann gibt es eine Zeitlupen-Wiederholung
  const decisive = m.events.filter((e) => e.type === 'fall' && e.t === m.time && e.by != null).pop();
  m.replay = winner < 2 && decisive ? { victim: decisive.id, by: decisive.by, t: m.time } : null;
  m.roundEndLen = CFG.ROUND_END + (m.replay ? CFG.REPLAY_EXTRA : 0);
  if (winner < 2) {
    m.score[winner]++;
    if (m.score[winner] >= m.winRounds) m.matchWinner = winner;
  }
  m.phase = 'roundEnd';
  m.phaseT = 0;
  emit(m, 'roundEnd', { winner, score: [...m.score], replay: m.replay });
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

// ---------- Netz-Kodierung (Gastgeber → Mitspieler) ----------

const F_DASH = 1;
const F_STUN = 2;
const F_HEAVY = 4;
const F_TURBO = 8;
const F_FALL = 16;
const F_DOOM = 32;
const F_OUT = 64;
const F_CHARGE = 128;
const r2 = (v) => Math.round(v * 100) / 100;

export function tilesString(m) {
  let s = '';
  for (const t of m.tiles) s += t.state;
  return s;
}

export function encodeSnap(m, withTiles) {
  const snap = {
    t: 's',
    ht: Math.round(m.time * 1000) / 1000,
    ph: PHASES.indexOf(m.phase),
    pt: r2(m.phaseT),
    rd: m.round,
    sc: m.score,
    rw: m.roundWinner,
    mw: m.matchWinner,
    or: m.outerRing,
    ns: r2(m.nextShrinkAt),
    ar: ARENA_IDS.indexOf(m.arena),
    an: Math.round(m.angle * 1000) / 1000,
    hl: m.hill.map((v) => Math.round(v * 10) / 10),
    hs: m.hillState,
    p: m.players.map((p) => [
      r2(p.x),
      r2(p.z),
      r2(p.y),
      r2(p.fx),
      r2(p.fz),
      (p.dashT > 0 ? F_DASH : 0) |
        (p.stunT > 0 ? F_STUN : 0) |
        (p.heavyT > 0 ? F_HEAVY : 0) |
        (p.turboT > 0 ? F_TURBO : 0) |
        (p.falling ? F_FALL : 0) |
        (p.doomed ? F_DOOM : 0) |
        (p.out ? F_OUT : 0) |
        (p.charging ? F_CHARGE : 0),
      r2(p.cool),
      r2(Math.max(p.heavyT, p.turboT)),
      p.stats.ko,
      r2(p.charge),
    ]),
    pu: m.powerups.map((pu) => [pu.id, POWER_TYPES.indexOf(pu.type), r2(pu.x), r2(pu.z)]),
  };
  if (withTiles) snap.tl = tilesString(m);
  return snap;
}

// Überträgt einen (zwischen zwei Schnappschüssen gemischten) Zustand auf die Spiegel-Partie des Mitspielers.
// only: nur diesen Spieler (Index) aktualisieren – für die eigene Figur mit kürzerer Verzögerung.
export function applySnap(m, a, b, alpha, only = null) {
  b = b || a;
  const lerp = (x, y) => x + (y - x) * alpha;
  const s = alpha < 0.5 ? a : b;
  m.players.forEach((p, i) => {
    if (only === null || only === i) applyPlayer(p, a.p[i], b.p[i], alpha, a, b);
  });
  if (only !== null) return;
  m.time = lerp(a.ht, b.ht);
  m.phase = PHASES[s.ph] || 'play';
  m.phaseT = a.ph === b.ph ? lerp(a.pt, b.pt) : s.pt;
  m.round = s.rd;
  m.score = s.sc;
  m.roundWinner = s.rw;
  m.matchWinner = s.mw;
  m.outerRing = s.or;
  m.nextShrinkAt = s.ns;
  if (ARENA_IDS[s.ar]) m.arena = ARENA_IDS[s.ar];
  if (s.hl) m.hill = s.hl;
  if (s.hs !== undefined) m.hillState = s.hs;
  m.angle = a.ar === b.ar && Number.isFinite(a.an) && Number.isFinite(b.an) ? lerp(a.an, b.an) : s.an || 0;
  m.powerups = s.pu.map(([id, type, x, z]) => ({ id, type: POWER_TYPES[type], x, z, life: 1 }));
}

function applyPlayer(p, pa, pb, alpha, a, b) {
  if (!pa || !pb) return;
  // Bei Rundenwechsel (Teleport) nicht quer über die Arena gleiten
  const jump = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) > 4;
  const k = jump ? (alpha < 0.5 ? 0 : 1) : alpha;
  const near = k < 0.5 ? pa : pb;
  p.x = pa[0] + (pb[0] - pa[0]) * k;
  p.z = pa[1] + (pb[1] - pa[1]) * k;
  p.y = pa[2] + (pb[2] - pa[2]) * k;
  const fx = pa[3] + (pb[3] - pa[3]) * k;
  const fz = pa[4] + (pb[4] - pa[4]) * k;
  const fl = Math.hypot(fx, fz) || 1;
  p.fx = fx / fl;
  p.fz = fz / fl;
  const f = near[5];
  p.dashT = f & F_DASH ? 0.1 : 0;
  p.stunT = f & F_STUN ? 0.1 : 0;
  p.heavyT = f & F_HEAVY ? near[7] : 0;
  p.turboT = f & F_TURBO ? near[7] : 0;
  p.radius = p.heavyT > 0 ? p.baseRadius * CFG.HEAVY_SCALE : p.baseRadius;
  p.charging = !!(f & F_CHARGE);
  p.charge = near[9] || 0;
  p.drop = p.falling && p.y > 0;
  p.falling = !!(f & F_FALL);
  p.doomed = !!(f & F_DOOM);
  p.out = !!(f & F_OUT);
  p.cool = pb[6];
  p.stats.ko = pb[8] || 0;
  const span = Math.max(0.001, b.ht - a.ht);
  p.vx = (pb[0] - pa[0]) / span;
  p.vz = (pb[1] - pa[1]) / span;
}

export function applyTiles(m, str) {
  if (typeof str !== 'string' || str.length !== m.tiles.length) return;
  let changed = false;
  for (let i = 0; i < m.tiles.length; i++) {
    const st = +str[i];
    if (m.tiles[i].state !== st) {
      m.tiles[i].state = st;
      changed = true;
    }
  }
  if (changed) m.tilesVersion++;
}
