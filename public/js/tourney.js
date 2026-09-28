// Turnier für Einzelspieler: fünf Gegner mit eigenem Stil, am Ende ein riesiger Boss.
// Jede Stufe ist ein 1-gegen-1, wer zuerst 2 Runden gewinnt.

export const STAGES = [
  {
    name: 'Knödel',
    title: 'Der Neuling',
    text: 'Gemütlich und ein bisschen tollpatschig. Zum Warmwerden.',
    diff: 'easy',
    arena: 'lava',
    goal: 'sumo',
    look: { hat: 'party', extra: 'none' },
  },
  {
    name: 'Frosti',
    title: 'Der Eisprinz',
    text: 'Liebt den Gletscher. Pass auf deinen Bremsweg auf!',
    diff: 'normal',
    arena: 'eis',
    goal: 'sumo',
    look: { hat: 'wikinger', extra: 'none' },
  },
  {
    name: 'Wirbelwind',
    title: 'Herr des Hügels',
    text: 'Auf dem Karussell geht es um den Hügel – halte die Mitte!',
    diff: 'normal',
    arena: 'dreh',
    goal: 'huegel',
    look: { hat: 'zylinder', extra: 'sonnenbrille' },
  },
  {
    name: 'Dampfwalze',
    title: 'Das Schwergewicht',
    text: 'Größer und schwerer als du. Aufgeladene Stöße helfen!',
    diff: 'normal',
    arena: 'lava',
    goal: 'sumo',
    look: { hat: 'cowboy', extra: 'schnurrbart' },
    size: 1.1,
    mass: 1.3,
  },
  {
    name: 'Yokozuna',
    title: 'Der Großmeister',
    text: 'Der Riese und Champion. Jede Runde eine andere Arena.',
    diff: 'hard',
    arena: 'mix',
    goal: 'sumo',
    look: { hat: 'krone', extra: 'none' },
    size: 1.4,
    mass: 1.3,
    boss: true,
  },
];

export const TOUR_WIN_ROUNDS = 2;

export function stageRoster(stage, me) {
  const s = STAGES[stage];
  return [
    { id: 1, name: me.name, team: 0, look: me.look },
    { id: 2, name: s.name, team: 1, bot: s.diff, look: s.look, size: s.size, mass: s.mass },
  ];
}
