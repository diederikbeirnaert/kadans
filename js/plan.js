// Het trainingsschema: regels, geen AI. Bouwt op vanaf wat je de laatste weken echt deed,
// groeit geleidelijk (zo'n 10% per week), neemt elke vierde week gas terug en bouwt af voor een wedstrijd.
import { addDays, weekStart, isoDate, weeks as weekRows, sportBucket, mean } from './stats.js';

// cap: gemiddelde minuten per sessie waar het schema naartoe groeit; long: langste sessie die het doel vraagt.
export const RACES = {
  '5k': { label: '5 km', cap: 45, long: 45, taper: 1 },
  '10k': { label: '10 km', cap: 55, long: 70, taper: 1 },
  hm: { label: 'Halve marathon', cap: 70, long: 120, taper: 2 },
  marathon: { label: 'Marathon', cap: 90, long: 180, taper: 2 },
  'tri-sprint': { label: 'Triatlon (sprint)', tri: true, cap: 55, long: 75, taper: 1 },
  'tri-olympic': { label: 'Triatlon (kwart)', tri: true, cap: 70, long: 120, taper: 2 },
  'tri-703': { label: 'Triatlon (halve, 70.3)', tri: true, cap: 100, long: 180, taper: 2 },
};
export const FOCUS = {
  regelmaat: { label: 'Regelmaat inbouwen', cap: 35, long: 45, quality: null, growth: 1.03 },
  fitter: { label: 'Fitter worden', cap: 50, long: 75, quality: 'tempo', growth: 1.06 },
  sneller: { label: 'Sneller worden', cap: 55, long: 75, quality: 'interval', growth: 1.06 },
  afvallen: { label: 'Afvallen', cap: 60, long: 90, quality: null, growth: 1.07 },
  blessurepreventie: { label: 'Blessurepreventie', cap: 45, long: 60, quality: null, growth: 1.04 },
};
export const goalLabel = (g) => (g.kind === 'race' ? RACES[g.race].label : FOCUS[g.focus].label);

// Trainingsdagen per aantal sessies, geteld vanaf maandag (0). De lange sessie valt op zaterdag (5).
const DAYS = { 1: [5], 2: [1, 5], 3: [1, 3, 5], 4: [1, 3, 5, 6], 5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 3, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const TRI = ['zwemmen', 'fietsen', 'lopen', 'lopen', 'fietsen', 'zwemmen', 'lopen'];
const round5 = (m) => Math.max(20, Math.round(m / 5) * 5);
const key = (goal, n) => JSON.stringify([goal, n]);

function sportsFor(goal, n, w) {
  if (goal.kind === 'race' && RACES[goal.race].tri) return n >= 3 ? TRI.slice(0, n) : Array.from({ length: n }, (_, i) => TRI[(i + w) % 3]);
  if (goal.kind === 'race') return Array.from({ length: n }, (_, i) => (i === 4 ? 'fietsen' : 'lopen'));
  const sports = goal.sports?.length ? goal.sports : ['lopen'];
  return Array.from({ length: n }, (_, i) => sports[i % sports.length]);
}

// Stappen van een sessie: { type: warmup|work|recover|cooldown, min, zone } of { repeat, steps }.
function steps(kind, min) {
  const warm = min >= 40 ? 10 : 5, cool = 5, room = min - warm - cool;
  const block = { strides: [1, 2, 4], tempo: [8, 3, 4], interval: [3, 2, 5] }[kind];
  if (!block || room < 12) return [{ type: 'work', min, zone: 2 }];
  const [on, off, zone] = block;
  const repeat = Math.max(2, Math.min(kind === 'tempo' ? 4 : 8, Math.floor(room / (on + off))));
  const rest = room - repeat * (on + off);
  return [
    { type: 'warmup', min: warm + rest, zone: 2 },
    { repeat, steps: [{ type: 'work', min: on, zone }, { type: 'recover', min: off, zone: 1 }] },
    { type: 'cooldown', min: cool, zone: 1 },
  ];
}

const TITLES = {
  easy: { lopen: 'Rustige duurloop', fietsen: 'Rustige rit', zwemmen: 'Zwemmen: techniek en duur' },
  long: { lopen: 'Lange duurloop', fietsen: 'Lange rit', zwemmen: 'Lange zwemtraining' },
  strides: { lopen: 'Duurloop met versnellingen', fietsen: 'Rit met versnellingen' },
  tempo: { lopen: 'Tempoloop', fietsen: 'Temporit' },
  interval: { lopen: 'Intervaltraining', fietsen: 'Intervalrit' },
};
const WHY = {
  easy: 'Rustig genoeg om te blijven praten. Deze sessies bouwen je basis op zonder je uit te putten.',
  long: 'Rustig tempo, het gaat om de duur. Hiermee groeit je uithoudingsvermogen.',
  strides: 'Rustig lopen met korte, vlotte versnellingen. Zo wen je aan snelheid zonder zware belasting.',
  tempo: 'Blokken op een tempo dat stevig maar vol te houden is. Dit verschuift je drempel.',
  interval: 'Korte, harde blokken met rust ertussen. Dit verhoogt je maximale zuurstofopname.',
};

function session(date, sport, kind, min) {
  const k = TITLES[kind][sport] ? kind : 'easy';
  return { id: `${date}-${sport}`, date, sport, kind: k, minutes: min, title: TITLES[k][sport], why: WHY[k], steps: sport === 'zwemmen' ? [] : steps(k, min) };
}

/**
 * Maakt een schema vanaf de week van `today`.
 * ctx: { n: sessies per week, activities, previous: het vorige schema (of null) }
 */
export function generate(goal, { n, activities, previous }, today = isoDate()) {
  const race = goal.kind === 'race' ? RACES[goal.race] : null;
  const cfg = race || FOCUS[goal.focus];
  const start = weekStart(today);
  const raceWeek = race && goal.date >= today ? weekStart(goal.date) : null;
  const total = raceWeek ? Math.min(24, Math.round((Date.parse(raceWeek) - Date.parse(start)) / 6048e5) + 1) : 8;
  const growth = race ? 1.1 : cfg.growth;
  const floor = n * 25, ceiling = n * cfg.cap;

  // Vertrekpunt: wat je de laatste 3 volledige weken gemiddeld deed. Loopt een schema al, dan volgt dat,
  // maar nooit meer dan een kwart boven wat je werkelijk aankon.
  const done = weekRows(activities, 4, today).slice(0, 3).map((w) => Object.values(w.hours).reduce((t, h) => t + h * 60, 0));
  const actual = mean(done) || 0;
  const planned = previous?.key === key(goal, n) ? previous.weeks.find((w) => w.start === start)?.minutes ?? null : null;
  let base = Math.min(ceiling, Math.max(floor, planned != null ? Math.min(planned, actual * 1.25 + 20) : actual * 1.1));

  const frozen = new Map((previous?.weeks || []).flatMap((w) => w.sessions).filter((s) => s.pushed).map((s) => [s.id, s]));
  const weeks = [];
  for (let w = 0; w < total; w++) {
    const weekStartDate = addDays(start, 7 * w);
    const left = total - 1 - w;                                 // weken tot de wedstrijdweek
    const isRace = raceWeek && left === 0, taper = raceWeek && left > 0 && left <= race.taper;
    const deload = !isRace && !taper && (w + 1) % 4 === 0;
    const phase = isRace ? 'Wedstrijdweek' : taper ? 'Afbouw' : deload ? 'Herstelweek' : w < (total - (race?.taper || 0)) / 2 ? 'Basis' : 'Opbouw';
    const minutes = base * (isRace ? 0.4 : taper ? 0.7 : deload ? 0.75 : 1);

    const days = DAYS[n], sports = sportsFor(goal, n, w);
    // De lange sessie krijgt de zaterdag; bij triatlon wisselt ze tussen fietsen en lopen.
    const longSport = race?.tri ? (w % 2 ? 'lopen' : 'fietsen') : sports[0];
    const li = sports.indexOf(longSport), si = days.indexOf(5);
    if (li >= 0 && si >= 0) [sports[li], sports[si]] = [sports[si], sports[li]];
    const quality = isRace || taper || deload || n < 3 || w === 0 ? null : race ? (phase === 'Basis' ? 'strides' : w % 2 ? 'tempo' : 'interval') : cfg.quality && (w < 3 ? 'strides' : cfg.quality);
    const qi = quality ? sports.findIndex((s, i) => i !== si && s !== 'zwemmen') : -1;
    const kinds = sports.map((s, i) => (i === si && !isRace ? 'long' : i === qi ? quality : 'easy'));
    const weight = (k, s) => (s === 'zwemmen' ? 0.8 : k === 'long' ? 1.5 : k === 'easy' ? 1 : 1.15);
    const sum = kinds.reduce((t, k, i) => t + weight(k, sports[i]), 0);

    let sessions = days.map((d, i) => {
      const date = addDays(weekStartDate, d);
      const min = Math.min(kinds[i] === 'long' ? cfg.long : 1e9, round5(minutes * weight(kinds[i], sports[i]) / sum));
      return session(date, sports[i], kinds[i], min);
    });
    if (isRace) {
      sessions = sessions.filter((s) => s.date < addDays(goal.date, -1)).slice(0, 2);
      sessions.push({ id: `${goal.date}-wedstrijd`, date: goal.date, sport: race.tri ? 'triatlon' : 'lopen', kind: 'race', minutes: 0, title: `Wedstrijd: ${race.label}`, why: 'Waar je naartoe gewerkt hebt. Start rustig en geniet ervan.', steps: [] });
    }
    sessions = sessions.map((s) => frozen.get(s.id) || s);   // wat al op je horloge staat, blijft ongewijzigd
    weeks.push({ start: weekStartDate, phase, minutes: Math.round(sessions.reduce((t, s) => t + s.minutes, 0)), sessions });
    // Bij weinig volume is 10% bijna niets; daarom groeit een wedstrijdschema minstens 5 minuten per sessie per week.
    if (!deload && !taper && !isRace) base = Math.min(ceiling, base + Math.max(base * (growth - 1), race ? 5 * n : 5));
  }

  const peak = Math.max(...weeks.flatMap((w) => w.sessions).filter((s) => s.kind === 'long').map((s) => s.minutes), 0);
  let warning = null;
  if (race && goal.date < today) warning = 'De wedstrijddatum is voorbij. Kies een nieuw doel.';
  else if (race && peak < race.long * 0.75) warning = `Er is te weinig tijd om veilig op te bouwen naar ${race.label.toLowerCase()}: je langste sessie komt uit op ${peak} minuten, terwijl dit doel er ongeveer ${race.long} vraagt. Het schema bouwt zo snel op als verantwoord is; overweeg een latere datum of meer sessies per week.`;
  return { key: key(goal, n), created: today, start, weeks, warning };
}

// Gedaan als er die dag een activiteit van dezelfde sport is van minstens 60% van de geplande duur.
export function status(s, activities, today = isoDate()) {
  const match = activities.some((a) => a.date === s.date && (a.sport === s.sport || a.sport === 'triatlon' || sportBucket(a) === s.sport) && a.durationS >= s.minutes * 36);
  return match ? 'gedaan' : s.date < today ? 'gemist' : s.date === today ? 'vandaag' : 'gepland';
}

// Signalen dat je lichaam vandaag minder aankan. Geeft een lijst met redenen terug (leeg = alles goed).
export function readiness(days, meta, today = isoDate()) {
  const day = days.find((d) => d.date === today);
  const flags = [];
  if (day?.hrv?.status === 'Low' || day?.hrv?.status === 'Below normal') flags.push('je HRV lag vannacht onder je normale bereik');
  if (day?.sleep?.totalMin != null && day.sleep.totalMin < 360) flags.push('je sliep minder dan 6 uur');
  const rhr = days.filter((d) => d.rhr && d.date < today && d.date >= addDays(today, -30)).map((d) => d.rhr);
  if (day?.rhr && rhr.length >= 7 && day.rhr > mean(rhr) + 5) flags.push('je rusthartslag ligt duidelijk hoger dan normaal');
  if (meta.recovery?.percent != null && Date.now() - (meta.recovery.at || 0) < 12 * 36e5 && meta.recovery.percent < 40) flags.push(`je herstel staat op ${meta.recovery.percent}%`);
  return flags;
}

// Zet een sessie om naar het formaat dat COROS verwacht (alleen lopen en fietsen, sturing op hartslagzone).
export function toCourse(s) {
  const TYPES = { warmup: 1, work: 2, recover: 3, cooldown: 4 };
  const plain = (st) => ({ sectionType: TYPES[st.type], targetType: 2, targetValue: st.min * 60, intensityType: 1, sectionIntensity: st.zone });
  return {
    sportType: s.sport === 'fietsen' ? 2 : 1, courseName: s.title, courseDescription: s.why,
    sections: s.steps.map((st) => (st.repeat ? { intervalGroup: true, repeats: st.repeat, sets: st.steps.map(plain) } : plain(st))),
  };
}
export const canPush = (s) => (s.sport === 'lopen' || s.sport === 'fietsen') && s.steps.length > 0 && !s.pushed;
