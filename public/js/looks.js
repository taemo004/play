// Aussehen der Figuren: Hüte und Extras, teils durch Erfolge freischaltbar.
// Die Teamfarbe bleibt immer Rot oder Blau, damit man die Teams sofort erkennt.

export const HATS = [
  { id: 'none', name: 'Kein Hut', icon: '⭕' },
  { id: 'party', name: 'Partyhut', icon: '🥳' },
  { id: 'zylinder', name: 'Zylinder', icon: '🎩', need: { wins: 1 }, hint: 'Gewinne 1 Partie' },
  { id: 'cowboy', name: 'Cowboyhut', icon: '🤠', need: { wins: 3 }, hint: 'Gewinne 3 Partien' },
  { id: 'wikinger', name: 'Wikingerhelm', icon: '⚔️', need: { kos: 15 }, hint: 'Schubs 15 Gegner raus' },
  { id: 'krone', name: 'Krone', icon: '👑', need: { hardWins: 1 }, hint: 'Besiege die KI auf „Schwer“' },
  { id: 'heiligenschein', name: 'Heiligenschein', icon: '😇', need: { flawless: 1 }, hint: 'Gewinne eine Partie, ohne selbst zu stürzen' },
];

export const EXTRAS = [
  { id: 'none', name: 'Nichts', icon: '⭕' },
  { id: 'sonnenbrille', name: 'Sonnenbrille', icon: '🕶️' },
  { id: 'schnurrbart', name: 'Schnurrbart', icon: '🥸', need: { wins: 2 }, hint: 'Gewinne 2 Partien' },
  { id: 'herzbrille', name: 'Herzbrille', icon: '😍', need: { kos: 30 }, hint: 'Schubs 30 Gegner raus' },
  { id: 'goldguertel', name: 'Goldgürtel', icon: '🥇', need: { tourney: 1 }, hint: 'Gewinne das Turnier' },
];

export const EMPTY_STATS = { games: 0, wins: 0, kos: 0, hardWins: 0, flawless: 0, tourney: 0 };

export function isUnlocked(item, stats) {
  if (!item.need) return true;
  return Object.entries(item.need).every(([k, v]) => (stats[k] || 0) >= v);
}

export function sanitizeLook(look) {
  const hat = look && HATS.some((h) => h.id === look.hat) ? look.hat : 'none';
  const extra = look && EXTRAS.some((e) => e.id === look.extra) ? look.extra : 'none';
  return { hat, extra };
}

// Die schwersten Belohnungen trägt die KI nicht – die bleiben etwas Besonderes
const RARE = new Set(['krone', 'heiligenschein', 'herzbrille', 'goldguertel']);

// KI-Gegner bekommen zufällig etwas Lustiges auf
export function randomLook(rng = Math.random) {
  const hats = HATS.filter((h) => h.id !== 'none' && !RARE.has(h.id));
  const extras = EXTRAS.filter((e) => e.id !== 'none' && !RARE.has(e.id));
  const hat = hats[Math.floor(rng() * hats.length)].id;
  const extra = rng() < 0.4 ? extras[Math.floor(rng() * extras.length)].id : 'none';
  return { hat, extra };
}

// Was wurde durch den neuen Spielstand gerade freigeschaltet?
export function newlyUnlocked(before, after) {
  return [...HATS, ...EXTRAS].filter((it) => it.need && !isUnlocked(it, before) && isUnlocked(it, after));
}
