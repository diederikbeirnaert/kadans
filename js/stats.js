// Berekeningen op de opgeslagen data. Geen DOM en geen opslag hier, zodat alles los te testen is.

export const DAY = 864e5;
export const isoDate = (t = Date.now()) => {
  const d = new Date(t);
  return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
};
export const addDays = (date, n) => isoDate(Date.parse(date + 'T12:00:00') + n * DAY);
export const weekStart = (date) => addDays(date, -((new Date(date + 'T12:00:00').getDay() + 6) % 7));

export const SPORTS = ['lopen', 'fietsen', 'zwemmen', 'andere'];
export const sportBucket = (a) => (SPORTS.includes(a.sport) ? a.sport : 'andere');
// Een sessie telt vanaf 10 minuten; zo vallen per ongeluk gestarte opnames weg.
export const isSession = (a) => (a.durationS || 0) >= 600;

export const mean = (values) => {
  const v = values.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

// Eén rij per week (maandag tot zondag), oudste eerst. Zonder `n` vanaf de eerste activiteit.
export function weeks(activities, n, today = isoDate()) {
  const sessions = activities.filter(isSession);
  const last = weekStart(today);
  const first = n ? addDays(last, -7 * (n - 1)) : weekStart(sessions.reduce((min, a) => (a.date < min ? a.date : min), today));
  const rows = new Map();
  for (let w = first; w <= last; w = addDays(w, 7)) {
    rows.set(w, { week: w, sessions: 0, hours: Object.fromEntries(SPORTS.map((s) => [s, 0])), km: 0 });
  }
  for (const a of sessions) {
    const row = rows.get(weekStart(a.date));
    if (!row) continue;
    row.sessions++;
    row.hours[sportBucket(a)] += a.durationS / 3600;
    row.km += (a.distanceM || 0) / 1000;
  }
  return [...rows.values()];
}

// Aantal weken op rij met minstens `goal` sessies. De lopende week breekt de reeks niet zolang ze bezig is.
export function streak(allWeeks, goal) {
  const done = allWeeks.slice(0, -1), current = allWeeks.at(-1);
  let run = 0, best = 0;
  for (const w of done) {
    run = w.sessions >= goal ? run + 1 : 0;
    best = Math.max(best, run);
  }
  if (current && current.sessions >= goal) run++;
  return { current: run, best: Math.max(best, run), thisWeek: current?.sessions || 0 };
}

// Fitheid (gemiddelde belasting over 42 dagen), vermoeidheid (7 dagen) en vorm (het verschil),
// het model van Banister zoals TrainingPeaks het gebruikt. De belasting per training komt van COROS.
export function loadSeries(activities, n, today = isoDate()) {
  const perDay = {};
  for (const a of activities) {
    if (a.detail?.load) perDay[a.date] = (perDay[a.date] || 0) + a.detail.load;
  }
  const dates = Object.keys(perDay).sort();
  if (!dates.length) return [];
  const out = [];
  let fitness = 0, fatigue = 0;
  for (let d = dates[0]; d <= today; d = addDays(d, 1)) {
    const load = perDay[d] || 0;
    fitness += (load - fitness) / 42;
    fatigue += (load - fatigue) / 7;
    out.push({ date: d, load, fitness, fatigue, form: fitness - fatigue });
  }
  return out.slice(-n);
}

// De laatste `n` dagen van één waarde, met null waar niets gemeten is.
export function daySeries(days, n, get, today = isoDate()) {
  const map = new Map(days.map((d) => [d.date, d]));
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const day = map.get(date);
    out.push({ date, v: day ? get(day) ?? null : null });
  }
  return out;
}

// Voortschrijdend gemiddelde over `window` punten; null zolang er te weinig metingen zijn.
export function rolling(values, window) {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1).filter((x) => x != null);
    return slice.length >= Math.ceil(window / 2) ? mean(slice) : null;
  });
}

// De recentste meting en het gemiddelde van de `n` dagen ervoor.
export function latest(series, n = 30) {
  const i = series.findLastIndex((p) => p.v != null);
  if (i < 0) return { value: null, date: null, baseline: null };
  return { value: series[i].v, date: series[i].date, baseline: mean(series.slice(Math.max(0, i - n), i).map((p) => p.v)) };
}

// Monotonie van de laatste 7 dagen (Foster, 1998): gemiddelde dagbelasting gedeeld door de standaardafwijking.
export function monotony(load) {
  const week = load.slice(-7).map((p) => p.load);
  if (week.length < 7 || !week.some(Boolean)) return null;
  const m = mean(week), sd = Math.sqrt(mean(week.map((x) => (x - m) ** 2)));
  return sd ? m / sd : null;
}

// Minuten per hartslagzone over een periode. Per kilometerronde als die er zijn, anders de hele activiteit op haar gemiddelde hartslag.
export function zoneMinutes(activities, lt, since, until = isoDate()) {
  const bounds = [0.8, 0.9, 0.955, 1.02, 1.06].map((f) => lt * f);
  const zone = (hr) => bounds.filter((b) => hr >= b).length;
  const out = [0, 0, 0, 0, 0, 0];
  for (const a of activities) {
    if (a.date < since || a.date > until || !isSession(a)) continue;
    const laps = a.laps?.find((g) => g.lapDistanceM === 1000)?.laps.filter((l) => l.avgHr > 0 && l.time > 0);
    if (laps?.length) for (const l of laps) out[zone(l.avgHr)] += l.time / 60;
    else if (a.avgHr) out[zone(a.avgHr)] += a.durationS / 60;
  }
  return out;
}

// Minuten training per dag voor het laatste jaar, voor de kalender.
export function calendar(activities, today = isoDate()) {
  const perDay = {};
  for (const a of activities.filter(isSession)) perDay[a.date] = (perDay[a.date] || 0) + a.durationS / 60;
  const start = weekStart(addDays(today, -364));
  const cells = [];
  for (let d = start; d <= today; d = addDays(d, 1)) cells.push({ date: d, min: perDay[d] || 0 });
  return cells;
}

// Spreiding van je bedtijd (standaardafwijking in minuten) over de laatste `n` nachten.
export function bedtimeSpread(days, n = 14, today = isoDate()) {
  const since = addDays(today, -n);
  const mins = days.filter((d) => d.date > since && d.sleep?.start).map((d) => {
    const [h, m] = d.sleep.start.slice(11).split(':').map(Number);
    return ((h + 12) % 24) * 60 + m;   // geteld vanaf de middag, zodat 23:30 en 00:30 naast elkaar liggen
  });
  if (mins.length < 5) return null;
  const m = mean(mins);
  return { spread: Math.sqrt(mean(mins.map((x) => (x - m) ** 2))), average: (m + 720) % 1440, nights: mins.length };
}

// Mijlpalen: wat je al bereikte en wat de volgende is. Elke mijlpaal heeft een datum zodra ze gehaald is.
// Mijlpalen met een teller hebben `done`, `target`, `unit` en een `group` (per groep is er telkens één eerstvolgende).
export function milestones(activities, goal = 3) {
  const sorted = activities.filter(isSession).sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  const nl = (n) => n.toLocaleString('nl-BE');
  const single = (title, test) => out.push({ title, date: sorted.find(test)?.date || null });
  // `amount(a)` is wat één activiteit bijdraagt; `filter` beperkt tot een sport.
  const total = (title, group, unit, target, amount, filter = () => true) => {
    let sum = 0, date = null;
    for (const a of sorted) {
      if (!filter(a)) continue;
      sum += amount(a);
      if (sum >= target) { date = a.date; break; }
    }
    out.push({ title, date, group, unit, done: sum, target, progress: date ? null : `${nl(Math.round(sum))} van ${nl(target)} ${unit}` });
  };
  const km = (a) => (a.distanceM || 0) / 1000;
  const is = (sport) => (a) => a.sport === sport;
  const far = (sport, m) => (a) => a.sport === sport && a.distanceM >= m;
  const long = (sport, h) => (a) => a.sport === sport && a.durationS >= h * 3600;
  const tri = (min, max) => (a) => a.sport === 'triatlon' && a.distanceM >= min * 1000 && a.distanceM <= max * 1000;

  single('Eerste 5 km gelopen', far('lopen', 5000));
  single('Eerste 10 km gelopen', far('lopen', 10000));
  single('Eerste 15 km gelopen', far('lopen', 15000));
  single('Eerste halve marathon', far('lopen', 21097));
  single('Eerste 30 km gelopen', far('lopen', 30000));
  single('Eerste marathon', far('lopen', 42195));
  single('Eerste loop van een uur', long('lopen', 1));
  single('Eerste loop van twee uur', long('lopen', 2));
  single('Eerste rit van 50 km', far('fietsen', 50000));
  single('Eerste rit van 100 km', far('fietsen', 100000));
  single('Eerste rit van 150 km', far('fietsen', 150000));
  single('Eerste rit van 200 km', far('fietsen', 200000));
  single('Eerste rit van drie uur', long('fietsen', 3));
  single('Eerste kilometer gezwommen', far('zwemmen', 1000));
  single('Eerste 2 km gezwommen', far('zwemmen', 2000));
  single('Eerste 3,8 km gezwommen', far('zwemmen', 3800));
  single('Eerste triatlon', is('triatlon'));
  single('Eerste sprinttriatlon', tri(20, 35));
  single('Eerste kwarttriatlon', tri(40, 65));
  single('Eerste halve triatlon', tri(100, 125));
  single('Eerste volledige triatlon', tri(200, 240));
  for (const n of [100, 250, 500, 1000, 2500, 5000]) total(`${nl(n)} km gelopen`, 'lopen', 'km', n, km, is('lopen'));
  for (const n of [1000, 2500, 5000, 10000, 25000]) total(`${nl(n)} km gefietst`, 'fietsen', 'km', n, km, is('fietsen'));
  for (const n of [10, 25, 50, 100, 250]) total(`${n} km gezwommen`, 'zwemmen', 'km', n, km, is('zwemmen'));
  for (const n of [50, 100, 250, 500, 1000]) total(`${nl(n)} sessies`, 'sessies', 'sessies', n, () => 1);
  for (const n of [100, 250, 500, 1000]) total(`${nl(n)} uur getraind`, 'uren', 'uur', n, (a) => a.durationS / 3600);

  // Reeksen: weken na elkaar met je weekdoel gehaald. De datum is de zondag van de week waarin je de reeks haalde.
  const rows = weeks(activities).slice(0, -1);
  for (const n of [4, 8, 12, 26, 52]) {
    let run = 0, best = 0, date = null;
    for (const w of rows) {
      run = w.sessions >= goal ? run + 1 : 0;
      best = Math.max(best, run);
      if (run >= n) { date = addDays(w.week, 6); break; }
    }
    out.push({ title: `Reeks van ${n} weken`, date, group: 'reeks', unit: 'weken', done: best, target: n, progress: date ? null : `${best} van ${n} weken` });
  }
  return out;
}

// Vat een dagreeks samen in blokken van `size` dagen (gemiddelde per blok), uitgelijnd op het einde van de reeks.
export function bucket(series, size) {
  const out = [];
  for (let end = series.length; end > 0; end -= size) {
    const part = series.slice(Math.max(0, end - size), end);
    out.unshift({ date: part[0].date, v: mean(part.map((p) => p.v)) });
  }
  return out;
}

// Gemiddelde trainingsbelasting per minuut uit je eigen recente trainingen (laatste 180 dagen, anders alles).
export function loadPerMinute(activities, today = isoDate()) {
  const rate = (list) => {
    const withLoad = list.filter((a) => a.detail?.load && a.durationS);
    const min = withLoad.reduce((t, a) => t + a.durationS / 60, 0);
    return min ? withLoad.reduce((t, a) => t + a.detail.load, 0) / min : null;
  };
  return rate(activities.filter((a) => a.date >= addDays(today, -180))) ?? rate(activities);
}

// Rekent fitheid en vermoeidheid vooruit voor een reeks toekomstige dagbelastingen.
export function projectFitness(start, loads) {
  let { fitness, fatigue } = start;
  return loads.map((load) => {
    fitness += (load - fitness) / 42;
    fatigue += (load - fatigue) / 7;
    return { fitness, fatigue };
  });
}

// `n` sessies gelijk verdeeld over een week: geeft per dag (0-6) true of false.
export const spread = (n) => Array.from({ length: 7 }, (_, i) => Math.floor((i + 1) * n / 7) > Math.floor(i * n / 7));

// Dit jaar tot vandaag tegenover vorig jaar tot dezelfde dag.
export function yearToDate(activities, today = isoDate()) {
  const year = +today.slice(0, 4), md = today.slice(4);
  const sum = (y) => {
    const out = { sessions: 0, hours: 0, lopen: 0, fietsen: 0, zwemmen: 0 };
    for (const a of activities.filter(isSession)) {
      if (!a.date.startsWith(String(y)) || a.date.slice(4) > md) continue;
      out.sessions++;
      out.hours += a.durationS / 3600;
      if (a.sport in out) out[a.sport] += (a.distanceM || 0) / 1000;
    }
    return out;
  };
  return { year, now: sum(year), before: sum(year - 1) };
}

// Regelmaat over de laatste 52 weken: aandeel weken met minstens één sessie en met het weekdoel gehaald.
export function consistency(activities, goal, today = isoDate()) {
  const rows = weeks(activities, 53, today).slice(0, 52);
  return { active: rows.filter((w) => w.sessions > 0).length, onGoal: rows.filter((w) => w.sessions >= goal).length, average: mean(rows.map((w) => w.sessions)), weeks: rows.length };
}

// Trainingsuren per maand en per sport, voor de laatste `n` maanden.
export function monthlyHours(activities, n, today = isoDate()) {
  const out = [];
  const d = new Date(today.slice(0, 7) + '-15T12:00:00');
  d.setMonth(d.getMonth() - n + 1);
  for (let i = 0; i < n; i++, d.setMonth(d.getMonth() + 1)) out.push({ month: isoDate(d).slice(0, 7), sessions: 0, ...Object.fromEntries(SPORTS.map((s) => [s, 0])) });
  const byMonth = new Map(out.map((m) => [m.month, m]));
  for (const a of activities.filter(isSession)) {
    const m = byMonth.get(a.date.slice(0, 7));
    if (m) { m[sportBucket(a)] += a.durationS / 3600; m.sessions++; }
  }
  return out;
}
