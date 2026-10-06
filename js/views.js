// De schermen van het dashboard. Elk scherm krijgt `data` = { activities, days, meta } en `actions`, en geeft een element terug.
import { chart, sparkline, rings, donut } from './charts.js';
import * as st from './stats.js';
import * as ph from './physio.js';
import * as pl from './plan.js';
import * as nm from './norms.js';
import * as fd from './food.js';
import { insights } from './insights.js';

const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.flat(2).filter((k) => k != null && k !== false));
  return n;
};
const btn = (className, text, onclick, props = {}) => Object.assign(el('button', { className, textContent: text, ...props }), { onclick });

// Kleur per sport en per domein. De sportkleuren zijn gevalideerd op onderscheid bij kleurenblindheid.
const C = { lopen: '#2a78d6', fietsen: '#eb6834', zwemmen: '#1baf7a', andere: '#898781', slaap: '#4a3aa7', hrv: '#008300', hart: '#e34948', stappen: '#2a78d6', fitheid: '#2a78d6', vermoeidheid: '#eb6834', diep: '#4a3aa7', rem: '#2a78d6', licht: '#1baf7a' };
const TONES = { bad: '#d03b3b', poor: '#ec835a', fair: '#fab219', good: '#0ca30c', top: '#006300' };
const SPORT_NAMES = { lopen: 'Lopen', fietsen: 'Fietsen', zwemmen: 'Zwemmen', andere: 'Andere', wandelen: 'Wandelen', kracht: 'Kracht', triatlon: 'Triatlon' };
const LEVELS = {
  'Moderate training recommended': 'matige training kan', 'Fully recovered': 'volledig hersteld', 'Rest recommended': 'rust aangeraden',
  'Easy training recommended': 'rustige training kan', 'Ready for high intensity training': 'klaar voor een zware training',
};

const nf = (v, d = 0) => v.toLocaleString('nl-BE', { minimumFractionDigits: d, maximumFractionDigits: d });
const day = (date, opts) => new Date(date + 'T12:00:00').toLocaleDateString('nl-BE', opts);
const shortDay = (date) => day(date, { day: 'numeric', month: 'short' });
const longDay = (date) => day(date, { weekday: 'long', day: 'numeric', month: 'long' });
const fullDay = (date) => `${shortDay(date)} ${date.slice(0, 4)}`;
const hm = (min) => `${Math.floor(min / 60)}u${String(Math.round(min % 60)).padStart(2, '0')}`;
const clock = (sec) => {
  const t = Math.round(sec), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const hours = (v) => (v >= 10 ? `${nf(v)} u` : `${nf(v, 1)} u`);
const zonesOf = (meta) => ({ ...ph.DEFAULT_ZONES, ...meta.zones });

// Tempo of snelheid in de eenheid die bij de sport hoort.
function pace(a) {
  if (!a.distanceM || !a.durationS) return null;
  if (a.sport === 'zwemmen') return `${clock(a.durationS / (a.distanceM / 100))} /100 m`;
  if (a.sport === 'lopen') return `${clock(a.durationS / (a.distanceM / 1000))} /km`;
  return `${nf(a.distanceM / a.durationS * 3.6, 1)} km/u`;
}
const distance = (a) => (a.distanceM ? (a.sport === 'zwemmen' ? `${nf(a.distanceM)} m` : `${nf(a.distanceM / 1000, a.distanceM < 100000 ? 2 : 1)} km`) : null);

const card = (title, ...kids) => el('section', { className: 'card' }, title ? el('h2', { textContent: title }) : null, ...kids);
const empty = (text) => el('p', { className: 'muted', textContent: text });
const head = (title, sub) => el('header', { className: 'view-head' }, el('h1', { textContent: title }), sub ? el('p', { className: 'muted', textContent: sub }) : null);

// --- Duiding: oordeel, schaal en uitleg ---

// Oordeel als bolletje met label; de tekst blijft zwart, zodat het nooit alleen op kleur steunt.
const verdict = (band) => (band ? el('span', { className: 'verdict' }, el('i', { style: `background:${TONES[band.tone]}` }), band.label) : null);

// Schaal met alle banden en een wijzer op jouw waarde.
function meter(value, scale, min, max, fmt = (v) => nf(v)) {
  if (value == null) return null;
  const pos = (v) => Math.max(0, Math.min(100, (v - min) / (max - min) * 100));
  const active = nm.rate(value, scale);
  let from = min;
  const segments = scale.map((b) => {
    const to = Math.min(b.to, max), width = pos(to) - pos(from);
    const seg = el('div', { className: b === active ? 'on' : '', style: `width:${width}%;background:${TONES[b.tone]}`, title: b.label });
    from = to;
    return seg;
  });
  const limits = scale.slice(0, -1).filter((b) => b.to > min && b.to < max).map((b) => el('span', { style: `left:${pos(b.to)}%`, textContent: fmt(b.to) }));
  return el('div', { className: 'meter' },
    el('div', { className: 'meter-bar' }, segments, el('b', { style: `left:${pos(value)}%` })),
    el('div', { className: 'meter-limits' }, limits));
}

const explain = (key) => el('details', { className: 'explain' }, el('summary', { textContent: 'Wat betekent dit?' }), el('p', { textContent: nm.EXPLAIN[key] }));

// Een cijfer met oordeel, schaal en uitleg.
function figure({ label, value, unit, band, note, scale, raw, min, max, fmt, key }) {
  return el('div', { className: 'figure' },
    el('div', { className: 'tile-label', textContent: label }),
    el('div', { className: 'tile-value' }, value ?? '–', unit && value != null ? el('small', { textContent: ' ' + unit }) : null),
    verdict(band),
    scale ? meter(raw, scale, min, max, fmt) : null,
    note ? el('div', { className: 'tile-note', textContent: note }) : null,
    key ? explain(key) : null);
}

// Tegel op Vandaag: label, waarde, oordeel, een regel uitleg en een trendlijntje.
function tile({ label, value, unit, note, series, color, band, href }) {
  return el(href ? 'a' : 'div', { className: 'tile', ...(href && { href }) },
    el('div', { className: 'tile-label' }, el('i', { style: `background:${color}` }), label),
    el('div', { className: 'tile-value' }, value ?? '–', unit && value != null ? el('small', { textContent: ' ' + unit }) : null),
    verdict(band),
    el('div', { className: 'tile-note', textContent: note || '' }),
    series ? sparkline(series, color) : null);
}

function activityRow(a) {
  const bits = [distance(a), clock(a.durationS), pace(a), a.avgHr ? `${a.avgHr} bpm` : null, a.detail?.load ? `belasting ${a.detail.load}` : null].filter(Boolean);
  return el('a', { className: 'activity', href: `#activiteit/${a.id}` },
    el('i', { className: 'sport', style: `background:${C[st.sportBucket(a)]}` }),
    el('div', {},
      el('div', { className: 'activity-title' }, SPORT_NAMES[a.sport] || a.name, el('span', { className: 'muted', textContent: ' · ' + longDay(a.date) })),
      el('div', { className: 'muted', textContent: bits.join(' · ') })));
}

// --- Periodekeuze ---

// De gekozen periode per grafiek, onthouden op dit toestel.
const periods = (() => { try { return JSON.parse(localStorage.getItem('kadans.periodes')) || {}; } catch { return {}; } })();
const DAYS = [[30, '30 dagen'], [90, '90 dagen'], [180, '6 maanden'], [365, '1 jaar']];
function period(id, options, fallback, actions) {
  const value = options.some(([v]) => v === periods[id]) ? periods[id] : fallback;
  const control = el('div', { className: 'seg', role: 'group', ariaLabel: 'Periode' }, options.map(([v, label]) => btn(v === value ? 'on' : '', label, () => {
    periods[id] = v;
    try { localStorage.setItem('kadans.periodes', JSON.stringify(periods)); } catch { /* privévenster */ }
    actions.render();
  })));
  return { value, control, name: options.find(([v]) => v === value)[1] };
}

// Een dagreeks voor een grafiek: per dag tot 120 dagen, daarboven een gemiddelde per week.
function spanned(days, n, get) {
  const raw = st.daySeries(days, n, get);
  const weekly = n > 120;
  const pts = weekly ? st.bucket(raw, 7) : raw;
  const step = Math.ceil(pts.length / 5);
  return { raw, pts, weekly, values: pts.map((p) => p.v), labels: pts.map((p) => (weekly ? `Week van ${fullDay(p.date)}` : longDay(p.date))), tick: (i) => (i % step === Math.floor(step / 2) ? shortDay(pts[i].date) : '') };
}
const cardHead = (title, control) => el('div', { className: 'card-head' }, el('h2', { textContent: title }), control);

// --- Vandaag ---

export function today({ activities, days, meta }, actions) {
  const now = st.isoDate();
  const goal = meta.weekGoal || 3;
  const allWeeks = st.weeks(activities);
  const streak = st.streak(allWeeks, goal);
  const recent = allWeeks.slice(-12);
  const left = Math.max(0, goal - streak.thisWeek);
  const thisWeek = allWeeks.at(-1), lastWeek = allWeeks.at(-2);
  const minutes = (w) => (w ? Object.values(w.hours).reduce((t, h) => t + h * 60, 0) : 0);
  const sleep7 = st.daySeries(days, 7, (d) => d.sleep?.totalMin).filter((p) => p.v != null);
  const sleepAvg = st.mean(sleep7.map((p) => p.v));
  const RING = { sessies: '#eb6834', minuten: '#1baf7a', slaap: '#2a78d6' };
  const ringRow = (color, label, value, target, note) => el('div', { className: 'ring-row' }, el('i', { style: `background:${color}` }),
    el('div', {}, el('div', { className: 'ring-label', textContent: label }), el('div', {}, el('strong', { textContent: value }), el('span', { className: 'muted', textContent: ` / ${target}` })), note ? el('div', { className: 'muted small', textContent: note }) : null));

  const weekCard = card(null,
    el('div', { className: 'card-head' }, el('h2', { textContent: 'Deze week' }),
      el('div', { className: 'stepper' }, 'Weekdoel',
        btn('', '−', () => actions.save({ weekGoal: goal - 1 }), { disabled: goal <= 1, ariaLabel: 'Eén sessie minder' }),
        el('strong', { textContent: `${goal} ${goal === 1 ? 'sessie' : 'sessies'}` }),
        btn('', '+', () => actions.save({ weekGoal: goal + 1 }), { disabled: goal >= 7, ariaLabel: 'Eén sessie meer' }))),
    el('div', { className: 'ring-block' },
      rings([{ frac: streak.thisWeek / goal, color: RING.sessies }, { frac: minutes(thisWeek) / 150, color: RING.minuten }, { frac: sleepAvg ? sleepAvg / 480 : 0, color: RING.slaap }]),
      el('div', { className: 'ring-rows' },
        ringRow(RING.sessies, 'Sessies', String(streak.thisWeek), String(goal), left ? `nog ${left} te gaan` : 'weekdoel gehaald'),
        ringRow(RING.minuten, 'Minuten bewegen', nf(minutes(thisWeek)), '150', lastWeek ? `vorige week ${nf(minutes(lastWeek))} · richtlijn van de WHO` : 'richtlijn van de WHO'),
        ringRow(RING.slaap, 'Slaap per nacht', sleepAvg ? hm(sleepAvg) : '–', '8u00', sleep7.length ? `gemiddelde van de laatste ${sleep7.length} nachten` : null))),
    el('div', { className: 'streak' },
      el('div', {}, el('div', { className: 'hero-value' }, String(streak.current), el('small', { textContent: streak.current === 1 ? ' week op rij' : ' weken op rij' })),
        el('p', { className: 'muted small', textContent: `Weken na elkaar met je weekdoel gehaald · langste reeks ooit: ${streak.best}` })),
      el('div', { className: 'weeks' }, recent.map((w) => el('div', { className: 'week', title: `Week van ${shortDay(w.week)}: ${w.sessions} sessies` },
        el('i', { className: w.sessions >= goal ? 'on' : w.sessions ? 'part' : '' }), el('span', { textContent: String(w.sessions) }))))));

  const found = insights({ activities, days, meta });
  const notable = card('Opvallend vandaag',
    found.length ? found.map((f) => el('a', { className: 'insight', href: f.href }, el('i', { style: `background:${TONES[f.tone]}` }), el('span', { textContent: f.text })))
      : empty('Niets opvallends: je cijfers liggen binnen je normale bereik.'));

  const sleepS = st.daySeries(days, 44, (d) => d.sleep?.totalMin);
  const hrvS = st.daySeries(days, 44, (d) => d.hrv?.avg);
  const rhrS = st.daySeries(days, 44, (d) => d.rhr);
  const stepS = st.daySeries(days, 44, (d) => d.steps);
  const sleep = st.latest(sleepS), hrv = st.latest(hrvS), rhr = st.latest(rhrS), steps = st.latest(stepS);
  const dayOf = (date) => days.find((d) => d.date === date);
  const load = st.loadSeries(activities, 44);
  const form = load.at(-1), ratio = form?.fitness > 1 ? form.fatigue / form.fitness : null;
  const rec = meta.recovery;
  const when = (date) => (date && date !== now ? shortDay(date) : null);
  const last14 = (s) => s.slice(-14).map((p) => p.v);
  const join = (...parts) => parts.filter(Boolean).join(' · ');
  const delta = rhr.baseline != null && Math.abs(rhr.value - rhr.baseline) >= 1 ? `${nf(Math.abs(rhr.value - rhr.baseline))} ${rhr.value < rhr.baseline ? 'lager' : 'hoger'} dan je gemiddelde` : rhr.baseline != null ? 'gelijk aan je gemiddelde' : null;
  const z = zonesOf(meta);
  const vo2 = ph.current(activities, (a) => ph.vo2maxFromRun(a, z));
  const vo2Months = ph.monthly(activities, (a) => ph.vo2maxFromRun(a, z), 12);
  const stress = st.latest(st.daySeries(days, 44, (d) => d.stress));

  const tiles = el('div', { className: 'tiles' },
    tile({ label: 'Herstel', value: rec?.percent != null ? nf(rec.percent) : null, unit: '%', band: nm.rate(rec?.percent, nm.RECOVERY), note: rec ? LEVELS[rec.level] || rec.level : 'nog geen meting', color: C.hrv, href: '#herstel' }),
    tile({ label: 'Slaap', value: sleep.value != null ? hm(sleep.value) : null, color: C.slaap, series: last14(sleepS), band: nm.rate(sleep.value != null ? sleep.value / 60 : null, nm.SLEEP_HOURS), href: '#herstel',
      note: join(when(sleep.date), dayOf(sleep.date)?.sleep?.score != null ? `score ${dayOf(sleep.date).sleep.score}` : null, sleep.baseline ? `gemiddeld ${hm(sleep.baseline)}` : null) }),
    tile({ label: 'HRV', value: hrv.value != null ? nf(hrv.value) : null, unit: 'ms', color: C.hrv, series: last14(hrvS), band: nm.rateHrv(dayOf(hrv.date)?.hrv), href: '#herstel',
      note: join(when(hrv.date), dayOf(hrv.date)?.hrv?.low != null ? `normaal ${dayOf(hrv.date).hrv.low}–${dayOf(hrv.date).hrv.high}` : null) }),
    tile({ label: 'Rusthartslag', value: rhr.value != null ? nf(rhr.value) : null, unit: 'bpm', color: C.hart, series: last14(rhrS), band: nm.rate(rhr.value, nm.RHR), note: join(when(rhr.date), delta), href: '#herstel' }),
    tile({ label: 'Stappen', value: steps.value != null ? nf(steps.value) : null, color: C.stappen, series: last14(stepS), band: nm.rate(steps.value, nm.STEPS), href: '#herstel',
      note: join(when(steps.date), steps.baseline ? `gemiddeld ${nf(steps.baseline)}` : null) }),
    tile({ label: 'Belasting', value: ratio != null ? nf(ratio, 2) : null, color: C.fitheid, series: load.slice(-14).map((p) => (p.fitness > 1 ? p.fatigue / p.fitness : null)), band: nm.rate(ratio, nm.ACWR), href: '#training',
      note: form ? `vermoeidheid ${nf(form.fatigue)} tegenover fitheid ${nf(form.fitness)}` : 'nog geen trainingsbelasting' }),
    tile({ label: 'VO2max', value: vo2.value != null ? nf(vo2.value) : null, color: C.fitheid, series: vo2Months.map((m) => m.v), band: nm.rate(vo2.value, nm.vo2Scale(meta.profile || {}).scale), href: '#progressie',
      note: vo2.value != null ? `uit ${vo2.n} lopen in 60 dagen` : 'minstens 2 lopen in 60 dagen nodig' }),
    stress.value != null ? tile({ label: 'Stress', value: nf(stress.value), color: C.vermoeidheid, series: st.daySeries(days, 14, (d) => d.stress).map((p) => p.v), href: '#herstel',
      band: stress.baseline == null ? null : stress.value > stress.baseline + 8 ? { label: 'Hoger dan normaal', tone: 'fair' } : stress.value < stress.baseline - 8 ? { label: 'Lager dan normaal', tone: 'good' } : { label: 'Normaal voor jou', tone: 'good' },
      note: join(when(stress.date), stress.baseline ? `gemiddeld ${nf(stress.baseline)}` : null) }) : null);

  const ytd = st.yearToDate(activities);
  const change = (a, b) => (b ? `${a >= b ? '+' : '−'}${nf(Math.abs(a - b) / b * 100)}% tegenover ${ytd.year - 1}` : `geen data over ${ytd.year - 1}`);
  const yearStat = (label, a, b, unit, d = 0) => el('div', { className: 'figure' }, el('div', { className: 'tile-label', textContent: label }), el('div', { className: 'tile-value' }, nf(a, d), unit ? el('small', { textContent: ' ' + unit }) : null),
    verdict(b ? (a >= b ? { label: 'Voor op vorig jaar', tone: 'good' } : { label: 'Achter op vorig jaar', tone: 'fair' }) : null), el('div', { className: 'tile-note', textContent: change(a, b) }));
  const yearCard = card(`${ytd.year} tot vandaag`,
    el('div', { className: 'figures' }, yearStat('Sessies', ytd.now.sessions, ytd.before.sessions), yearStat('Uren', ytd.now.hours, ytd.before.hours, 'u'),
      ytd.now.lopen || ytd.before.lopen ? yearStat('Gelopen', ytd.now.lopen, ytd.before.lopen, 'km') : null, ytd.now.fietsen || ytd.before.fietsen ? yearStat('Gefietst', ytd.now.fietsen, ytd.before.fietsen, 'km') : null,
      ytd.now.zwemmen || ytd.before.zwemmen ? yearStat('Gezwommen', ytd.now.zwemmen, ytd.before.zwemmen, 'km', 1) : null),
    el('p', { className: 'muted small', textContent: `Vergeleken met ${ytd.year - 1} tot en met dezelfde dag.` }));

  const upcoming = nextMilestones(activities, goal).slice(0, 3);
  const milestoneCard = upcoming.length ? card('Volgende mijlpalen', upcoming.map(milestoneBar), el('a', { className: 'link', href: '#progressie', textContent: 'Alle mijlpalen' })) : null;

  const lastActs = [...activities].sort((a, b) => b.start - a.start).slice(0, 5);
  return el('div', { className: 'view' }, head('Vandaag', longDay(now)), weekCard, program({ activities, days, meta }), notable, tiles, yearCard, milestoneCard,
    card('Laatste activiteiten', lastActs.length ? lastActs.map(activityRow) : empty('Nog geen activiteiten.')));
}

// Per soort mijlpaal de eerstvolgende, dichtst bij het doel eerst.
function nextMilestones(activities, goal) {
  const open = st.milestones(activities, goal).filter((m) => !m.date && m.target);
  return [...new Map(open.reverse().map((m) => [m.group, m])).values()].sort((a, b) => b.done / b.target - a.done / a.target);
}
const milestoneBar = (m) => el('div', { className: 'goalbar' },
  el('div', {}, el('strong', { textContent: m.title }), el('span', { className: 'muted', textContent: `nog ${nf(Math.ceil(m.target - m.done))} ${m.unit}` })),
  el('div', { className: 'track' }, el('i', { style: `width:${Math.min(100, m.done / m.target * 100)}%` })));

// Wat er vandaag gepland staat, met advies op basis van slaap, HRV en herstel.
function program({ activities, days, meta }) {
  if (!meta.goal || !meta.plan) return card('Op het programma', el('p', { className: 'muted' }, 'Nog geen doel gekozen. ', el('a', { href: '#schema', textContent: 'Kies een doel' }), ' en Kadans maakt een schema op jouw maat.'));
  const now = st.isoDate();
  const all = meta.plan.weeks.flatMap((w) => w.sessions);
  const todays = all.filter((s) => s.date === now);
  const next = all.find((s) => s.date > now);
  const flags = pl.readiness(days, meta);
  const hard = todays.some((s) => ['tempo', 'interval', 'long', 'race'].includes(s.kind));
  const advice = !todays.length || todays.every((s) => pl.status(s, activities) === 'gedaan') ? null
    : !flags.length ? 'Je cijfers zien er goed uit voor deze sessie.'
    : flags.length > 1 && hard ? `Opgelet: ${flags.join(' en ')}. Vervang deze sessie door een rustige van 30 minuten, of neem rust.`
    : `Opgelet: ${flags.join(' en ')}. Doe het vandaag rustiger aan dan gepland.`;
  return card('Op het programma',
    todays.length ? todays.map((s) => sessionRow(s, activities, meta)) : el('p', { className: 'muted', textContent: 'Vandaag is een rustdag.' }),
    advice ? el('p', { className: flags.length ? 'advice warn' : 'advice', textContent: advice }) : null,
    !todays.length && next ? el('p', { className: 'muted small', textContent: `Volgende sessie: ${longDay(next.date)} · ${next.title}${next.minutes ? ` · ${next.minutes} min` : ''}` }) : null);
}

// --- Training ---

export function training({ activities, meta }, actions) {
  const now = st.isoDate();
  const volP = period('volume', [[12, '12 weken'], [26, '26 weken'], [52, '1 jaar'], [104, '2 jaar']], 26, actions);
  const wk = st.weeks(activities, volP.value);
  const wkStep = Math.ceil(wk.length / 6);
  const keys = st.SPORTS.map((k) => ({ key: k, label: SPORT_NAMES[k], color: C[k] }));
  const total = (w) => st.SPORTS.reduce((t, k) => t + w.hours[k], 0);
  const last4 = st.mean(wk.slice(-5, -1).map(total)), prev4 = st.mean(wk.slice(-9, -5).map(total));
  const volume = card(null, cardHead('Trainingsuren per week', volP.control),
    el('div', { className: 'figures' }, figure({ label: 'Gemiddeld per week, laatste 4 weken', value: last4 != null ? nf(last4 * 60) : null, unit: 'min', raw: last4 * 60, band: nm.rate(last4 * 60, nm.WEEK_MINUTES), scale: nm.WEEK_MINUTES, min: 0, max: 450,
      note: `De WHO raadt 150 tot 300 minuten beweging per week aan.${prev4 ? ` In de 4 weken daarvoor deed je ${nf(prev4 * 60)} minuten.` : ''}` })),
    chart({ title: 'Trainingsuren per week', labels: wk.map((w) => `Week van ${shortDay(w.week)} · ${hours(total(w))} · ${w.sessions} sessies`),
      tick: (i) => (i % wkStep === Math.floor(wkStep / 2) ? shortDay(wk[i].week) : ''), stacks: { keys, rows: wk.map((w) => w.hours) }, fmt: (v) => hours(v), tickFmt: (v) => `${nf(v)} u` }));

  const loadP = period('belasting', [[90, '90 dagen'], [180, '6 maanden'], [365, '1 jaar'], [730, '2 jaar']], 180, actions);
  const load = st.loadSeries(activities, loadP.value);
  const loadStep = Math.ceil(load.length / 6);
  const cur = load.at(-1), before = load.at(-29);
  const ratio = cur?.fitness > 1 ? cur.fatigue / cur.fitness : null;
  const mono = st.monotony(load);
  const change = cur && before ? cur.fitness - before.fitness : null;
  const withLoad = activities.filter((a) => a.detail?.load).length, sessions = activities.filter(st.isSession).length;
  const status = card(null, cardHead('Belasting nu', loadP.control),
    load.length > 1 ? el('div', { className: 'figures' },
      figure({ label: 'Vermoeidheid tegenover fitheid', value: ratio != null ? nf(ratio, 2) : null, raw: ratio, band: nm.rate(ratio, nm.ACWR), scale: nm.ACWR, min: 0, max: 2, fmt: (v) => nf(v, 1), key: 'form',
        note: ratio == null ? 'Te weinig training om te beoordelen.' : ratio < 0.8 ? 'Je doet minder dan je gewend bent. Goed om te herstellen, maar te lang zo en je verliest conditie.' : ratio <= 1.3 ? 'Je traint in lijn met wat je lichaam gewend is.' : 'Je deed deze week veel meer dan je gewend bent. Plan rust in.' }),
      figure({ label: 'Fitheid', value: nf(cur.fitness), key: 'fitness', band: change == null ? null : change > 1 ? { label: 'In opbouw', tone: 'good' } : change < -1 ? { label: 'Dalend', tone: 'fair' } : { label: 'Stabiel', tone: 'good' },
        note: change != null ? `${change >= 0 ? '+' : '−'}${nf(Math.abs(change))} tegenover 4 weken geleden. Je hoogste waarde in deze periode was ${nf(Math.max(...load.map((p) => p.fitness)))}.` : null }),
      figure({ label: 'Monotonie deze week', value: mono != null ? nf(mono, 1) : null, raw: mono, band: nm.rate(mono, nm.MONOTONY), scale: nm.MONOTONY, min: 0, max: 3, fmt: (v) => nf(v, 1), key: 'monotony', note: mono == null ? 'Geen training in de laatste 7 dagen.' : null }))
      : empty('Nog geen trainingsbelasting. Die komt mee met de details van je activiteiten.'),
    load.length > 1 ? chart({ title: 'Fitheid en vermoeidheid', labels: load.map((p) => longDay(p.date)), tick: (i) => (i % loadStep === Math.floor(loadStep / 2) ? shortDay(load[i].date) : ''),
      lines: [{ values: load.map((p) => p.fitness), color: C.fitheid, label: 'Fitheid' }, { values: load.map((p) => p.fatigue), color: C.vermoeidheid, label: 'Vermoeidheid' }], zero: true }) : null,
    withLoad < sessions ? el('p', { className: 'muted small', textContent: `Gebaseerd op ${withLoad} van ${sessions} activiteiten; van de rest zijn de details nog niet opgehaald.` }) : null);

  const z = zonesOf(meta);
  const zoneP = period('zones', [[28, '4 weken'], [56, '8 weken'], [182, '6 maanden'], [365, '1 jaar']], 56, actions);
  const zm = st.zoneMinutes(activities, z.lt, st.addDays(now, -zoneP.value));
  const zt = zm.reduce((a, b) => a + b, 0);
  const easy = zt ? (zm[0] + zm[1]) / zt * 100 : null, hard = zt ? (zm[3] + zm[4] + zm[5]) / zt * 100 : null;
  const zoneBand = easy == null ? null : easy >= 75 ? { label: 'Goed verdeeld', tone: 'good' } : easy >= 60 ? { label: 'Iets te veel stevig werk', tone: 'fair' } : { label: 'Te weinig rustig werk', tone: 'poor' };
  const zones = card(null, cardHead('Intensiteit', zoneP.control),
    zt ? [
      el('p', {}, verdict(zoneBand), el('span', { className: 'muted', textContent: ` ${nf(easy)}% rustig (zone 1–2), ${nf(100 - easy - hard)}% in het midden (zone 3), ${nf(hard)}% stevig (zone 4–6). Richtwaarde: ongeveer 80% rustig.` })),
      el('div', { className: 'hbars' }, zm.map((min, i) => el('div', { className: 'hbar' },
        el('span', { textContent: `Zone ${i + 1} · ${ph.ZONE_NAMES[i]}` }), el('div', {}, el('i', { style: `width:${min / Math.max(...zm) * 100}%` })), el('b', { textContent: `${nf(min / zt * 100)}%` }), el('small', { textContent: `${ph.zoneRange(z, i + 1)} bpm · ${hm(min)}` })))),
      explain('zones')] : empty('Geen trainingen met hartslag in deze periode.'));

  const cells = st.calendar(activities);
  const shade = (min) => (min >= 120 ? 4 : min >= 60 ? 3 : min >= 30 ? 2 : min > 0 ? 1 : 0);
  const active = cells.filter((c) => c.min > 0).length;
  const cal = card('Het laatste jaar',
    el('p', { className: 'muted', textContent: `${active} actieve dagen op ${cells.length}. Elke kolom is een week, van maandag tot zondag.` }),
    el('div', { className: 'cal-wrap' }, el('div', { className: 'cal' }, cells.map((c) => el('i', { className: `s${shade(c.min)}`, title: `${fullDay(c.date)}: ${c.min ? `${nf(c.min)} min` : 'rust'}` })))),
    el('div', { className: 'legend' }, ['Rust', 'Tot 30 min', '30–60 min', '1–2 uur', 'Meer dan 2 uur'].map((t, i) => el('span', {}, el('i', { className: `sq s${i}` }), t))));

  const list = [...activities].sort((a, b) => b.start - a.start).slice(0, 30);
  const view = el('div', { className: 'view' }, head('Training'), status, volume, zones, cal, card('Recente activiteiten', list.length ? list.map(activityRow) : empty('Nog geen activiteiten.')));
  requestAnimationFrame(() => { const w = view.querySelector('.cal-wrap'); if (w) w.scrollLeft = w.scrollWidth; });
  return view;
}

// --- Eén activiteit ---

export function activity({ activities, meta }, id) {
  const a = activities.find((x) => x.id === id);
  if (!a) return el('div', { className: 'view' }, head('Activiteit'), card(null, empty('Deze activiteit is niet gevonden.')));
  const d = a.detail || {}, z = zonesOf(meta);
  const zone = a.avgHr ? [0.8, 0.9, 0.955, 1.02, 1.06].filter((f) => a.avgHr >= z.lt * f).length + 1 : null;
  const stat = (label, value, note) => (value == null ? null : el('div', { className: 'figure' }, el('div', { className: 'tile-label', textContent: label }), el('div', { className: 'tile-value', textContent: value }), note ? el('div', { className: 'tile-note', textContent: note }) : null));
  const vo2 = ph.vo2maxFromRun(a, z);
  const stats = card(null, el('div', { className: 'figures' },
    stat('Afstand', distance(a)), stat('Duur', clock(a.durationS), d.elapsedS > a.durationS + 60 ? `${clock(d.elapsedS)} met pauzes` : null),
    stat(a.sport === 'lopen' || a.sport === 'zwemmen' ? 'Tempo' : 'Snelheid', pace(a), d.bestKmS ? `snelste kilometer ${clock(d.bestKmS)}` : d.maxSpeedKmh ? `maximum ${nf(d.maxSpeedKmh, 1)} km/u` : null),
    stat('Gemiddelde hartslag', a.avgHr ? `${a.avgHr} bpm` : null, zone ? `zone ${zone} · ${ph.ZONE_NAMES[zone - 1].toLowerCase()}` : null),
    stat('Hoogtemeters', d.elevGain != null ? `${nf(d.elevGain)} m` : null), stat('Cadans', d.cadence ? `${nf(d.cadence)} /min` : null, a.sport === 'lopen' && d.cadence ? (d.cadence >= 170 ? 'vlot, weinig impact per pas' : d.cadence >= 160 ? 'gemiddeld' : 'laag; kortere, snellere passen belasten je gewrichten minder') : null),
    stat('Paslengte', d.strideM ? `${nf(d.strideM, 2)} m` : null), stat('Vermogen', d.power ? `${nf(d.power)} W` : null, 'geschat door het horloge'),
    stat('Calorieën', a.calories ? `${nf(a.calories)} kcal` : null), stat('Banen', d.lengths ? nf(d.lengths) : null),
    stat('SWOLF', d.swolf ? nf(d.swolf) : null, 'tijd plus slagen per baan; lager is efficiënter'), stat('Sets', d.sets ? nf(d.sets) : null),
    stat('VO2max uit deze loop', vo2 ? nf(vo2) : null, 'uit je tempo en hartslag')));

  const effect = d.aerobicTE != null ? card('Wat deed deze training?',
    el('div', { className: 'figures' },
      figure({ label: 'Aeroob trainingseffect', value: nf(d.aerobicTE, 1), raw: d.aerobicTE, band: nm.rate(d.aerobicTE, nm.TRAINING_EFFECT), scale: nm.TRAINING_EFFECT, min: 0, max: 5.5 }),
      figure({ label: 'Anaeroob trainingseffect', value: nf(d.anaerobicTE ?? 0, 1), raw: d.anaerobicTE ?? 0, band: nm.rate(d.anaerobicTE ?? 0, nm.TRAINING_EFFECT), scale: nm.TRAINING_EFFECT, min: 0, max: 5.5 }),
      stat('Trainingsbelasting', d.load != null ? nf(d.load) : null, 'telt mee in je fitheid en vermoeidheid')),
    explain('te')) : null;

  const km = a.laps?.find((g) => g.lapDistanceM === 1000)?.laps || [];
  const run = a.sport === 'lopen';
  const speed = (l) => (run ? (l.avgPace || l.time / (l.distanceM / 1000)) : l.speedKmh);
  const kmTick = (i) => ((i + 1) % Math.ceil(km.length / 10) === 0 ? String(i + 1) : '');
  const laps = km.length > 1 ? card('Per kilometer',
    el('h3', { textContent: run ? 'Tempo' : 'Snelheid' }),
    chart({ title: run ? 'Tempo per kilometer' : 'Snelheid per kilometer', height: 170, labels: km.map((l, i) => `Kilometer ${i + 1}`), tick: kmTick, invert: run,
      lines: [{ values: km.map(speed), color: C[st.sportBucket(a)], label: run ? 'Tempo' : 'Snelheid' }], fmt: (v) => (run ? `${clock(v)} /km` : `${nf(v, 1)} km/u`), tickFmt: (v) => (run ? clock(v) : nf(v)) }),
    km.some((l) => l.avgHr) ? el('h3', { textContent: 'Hartslag' }) : null,
    km.some((l) => l.avgHr) ? chart({ title: 'Hartslag per kilometer', height: 150, labels: km.map((l, i) => `Kilometer ${i + 1}`), tick: kmTick,
      lines: [{ values: km.map((l) => l.avgHr || null), color: C.hart, label: 'Hartslag' }], fmt: (v) => `${nf(v)} bpm`, tickFmt: (v) => nf(v) }) : null,
    el('div', { className: 'table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Km', 'Tijd', run ? 'Tempo' : 'Snelheid', 'Hartslag', run ? 'Cadans' : null, 'Stijging'].filter(Boolean).map((t) => el('th', { textContent: t })))),
      el('tbody', {}, km.map((l, i) => el('tr', {}, [l.distanceM >= 999 ? i + 1 : `${nf(l.distanceM / 1000, 2)}`, clock(l.time), run ? clock(speed(l)) : nf(l.speedKmh, 1), l.avgHr || '–', run ? l.avgCadence || '–' : null, l.elevGain ? `${l.elevGain} m` : '–'].filter((x) => x != null).map((t) => el('td', { textContent: t })))))))) : null;

  const lengths = a.sport === 'zwemmen' ? a.laps?.[0]?.laps.filter((l) => l.strokes > 0) || [] : [];
  const swim = lengths.length > 1 ? card('Per baan',
    chart({ title: 'Tempo per baan', height: 170, labels: lengths.map((l, i) => `Baan ${i + 1}`), tick: (i) => ((i + 1) % 5 === 0 ? String(i + 1) : ''), invert: true,
      lines: [{ values: lengths.map((l) => l.avgPace), color: C.zwemmen, label: 'Tempo' }], fmt: (v) => `${clock(v)} /100 m`, tickFmt: (v) => clock(v) })) : null;

  return el('div', { className: 'view' },
    el('header', { className: 'view-head' }, el('a', { className: 'link', href: '#training', textContent: '‹ Training' }), el('h1', { textContent: SPORT_NAMES[a.sport] || a.name }),
      el('p', { className: 'muted', textContent: [longDay(a.date) + ' ' + a.date.slice(0, 4), a.location].filter(Boolean).join(' · ') })),
    stats, effect, laps, swim, a.detail ? null : card(null, empty('De details van deze activiteit zijn nog niet opgehaald.')));
}

// --- Slaap en herstel ---

export function health({ days, meta }, actions) {
  if (!days.length) return el('div', { className: 'view' }, head('Slaap en herstel'), card(null, empty('Nog geen gezondheidsdata.')));
  const now = st.isoDate();
  const within = (v, lo, hi) => (v == null ? null : v < lo ? { label: 'Onder het typische bereik', tone: 'fair' } : v > hi ? { label: 'Boven het typische bereik', tone: 'good' } : { label: 'Typisch', tone: 'good' });
  const toHours = (v) => (v == null ? null : v / 60);

  const sleepP = period('slaap', DAYS, 30, actions);
  const sl = spanned(days, sleepP.value, (d) => d.sleep?.totalMin);
  const avg = st.mean(sl.raw.map((p) => p.v));
  const score = st.mean(st.daySeries(days, sleepP.value, (d) => d.sleep?.score).map((p) => p.v));
  const avg7 = st.rolling(st.daySeries(days, sleepP.value + 6, (d) => d.sleep?.totalMin).map((p) => p.v), 7).slice(-sleepP.value);
  const bed = st.bedtimeSpread(days);
  const week = sl.raw.slice(-7).filter((p) => p.v != null);
  const debt = week.reduce((t, p) => t + Math.max(0, 480 - p.v), 0);
  const short = sl.raw.filter((p) => p.v != null && p.v < 360).length, measured = sl.raw.filter((p) => p.v != null).length;
  const sleep = card(null, cardHead('Slaap', sleepP.control),
    el('div', { className: 'figures' },
      figure({ label: `Gemiddeld per nacht, ${sleepP.name}`, value: avg ? hm(avg) : null, raw: avg / 60, band: nm.rate(avg ? avg / 60 : null, nm.SLEEP_HOURS), scale: nm.SLEEP_HOURS, min: 4, max: 10, fmt: (v) => `${v} u`, key: 'sleep',
        note: measured ? `Dutjes inbegrepen. ${short} van de ${measured} nachten sliep je minder dan 6 uur.` : null }),
      figure({ label: `Slaapscore, ${sleepP.name}`, value: score ? nf(score) : null, raw: score, band: nm.rate(score, nm.SLEEP_SCORE), scale: nm.SLEEP_SCORE, min: 30, max: 100, note: 'De score van COROS weegt duur, fases en onderbrekingen.' }),
      figure({ label: 'Regelmaat van je bedtijd', value: bed ? `± ${nf(bed.spread)}` : null, unit: 'min', raw: bed?.spread, band: nm.rate(bed?.spread, nm.BEDTIME_SPREAD), scale: nm.BEDTIME_SPREAD, min: 0, max: 120, key: 'bedtime',
        note: bed ? `Gemiddeld ga je slapen om ${String(Math.floor(bed.average / 60)).padStart(2, '0')}:${String(Math.round(bed.average % 60)).padStart(2, '0')} (laatste ${bed.nights} nachten).` : 'Minstens 5 nachten nodig.' }),
      figure({ label: 'Slaaptekort, laatste 7 nachten', value: week.length ? hm(debt) : null, band: !week.length ? null : debt < 120 ? { label: 'Verwaarloosbaar', tone: 'good' } : debt < 300 ? { label: 'Merkbaar', tone: 'fair' } : { label: 'Groot', tone: 'poor' },
        note: 'Opgeteld tekort tegenover 8 uur per nacht. Inhalen lukt maar deels: enkele vroegere avonden werken beter dan één lange uitslaapdag.' })),
    chart({ title: 'Slaapduur', labels: sl.labels, tick: sl.tick,
      bars: { values: sl.values.map(toHours), color: C.slaap, label: sl.weekly ? 'Gemiddelde slaap per week' : 'Slaap' },
      lines: sl.weekly ? [] : [{ values: avg7.map(toHours), color: '#0b0b0b', label: 'Gemiddelde over 7 nachten' }], fmt: (v) => hm(v * 60), tickFmt: (v) => `${nf(v)} u` }));

  const stageP = period('fases', DAYS, 30, actions);
  const stage = (k) => spanned(days, stageP.value, (d) => d.sleepStages?.[k]);
  const dp = stage('deepMin'), rm = stage('remMin'), lt = stage('lightMin');
  const tot = (k) => st.mean(st.daySeries(days, stageP.value, (d) => (d.sleepStages?.deepMin != null ? d.sleepStages[k] / (d.sleepStages.deepMin + d.sleepStages.lightMin + d.sleepStages.remMin) * 100 : null)).map((p) => p.v));
  const deep = tot('deepMin'), rem = tot('remMin');
  const lastNight = days.filter((d) => d.sleepStages?.deepMin != null && d.date <= now).sort((a, b) => b.date.localeCompare(a.date))[0];
  const ls = lastNight?.sleepStages;
  const nightDonut = ls ? el('div', { className: 'donut-block' },
    donut([{ value: ls.deepMin, color: C.diep, label: 'Diep' }, { value: ls.remMin, color: C.rem, label: 'Rem' }, { value: ls.lightMin, color: C.licht, label: 'Licht' }],
      [el('strong', { textContent: hm(ls.deepMin + ls.remMin + ls.lightMin) }), el('span', { textContent: lastNight.date === now ? 'vannacht' : shortDay(lastNight.date) })]),
    el('div', { className: 'ring-rows' }, [['Diep', ls.deepMin, C.diep], ['Rem', ls.remMin, C.rem], ['Licht', ls.lightMin, C.licht]].map(([label, min, color]) => el('div', { className: 'ring-row' }, el('i', { style: `background:${color}` }),
      el('div', {}, el('div', { className: 'ring-label', textContent: label }), el('div', {}, el('strong', { textContent: hm(min) }), el('span', { className: 'muted', textContent: ` · ${nf(min / (ls.deepMin + ls.remMin + ls.lightMin) * 100)}%` }))))),
      ls.awakeMin ? el('div', { className: 'muted small', textContent: `Daarnaast ${nf(ls.awakeMin)} minuten wakker.` }) : null)) : null;
  const stages = deep != null ? card(null, cardHead('Slaapfases', stageP.control), nightDonut,
    el('div', { className: 'figures' },
      figure({ label: `Diepe slaap, ${stageP.name}`, value: nf(deep), unit: '%', band: within(deep, 13, 23), note: 'Typisch is 13 tot 23% van je slaap.' }),
      figure({ label: `Remslaap, ${stageP.name}`, value: nf(rem), unit: '%', band: within(rem, 20, 25), note: 'Typisch is 20 tot 25% van je slaap.' })),
    chart({ title: 'Slaapfases', labels: dp.labels, tick: dp.tick,
      stacks: { keys: [{ key: 'deep', label: 'Diep', color: C.diep }, { key: 'rem', label: 'Rem', color: C.rem }, { key: 'light', label: 'Licht', color: C.licht }],
        rows: dp.values.map((v, i) => ({ deep: (v || 0) / 60, rem: (rm.values[i] || 0) / 60, light: (lt.values[i] || 0) / 60 })) }, fmt: (v) => hm(v * 60), tickFmt: (v) => `${nf(v)} u` }),
    explain('stages')) : null;

  const hrvP = period('hrv', DAYS, 90, actions);
  const hv = spanned(days, hrvP.value, (d) => d.hrv?.avg);
  const fill = (values) => { let last = null; return values.map((v) => (last = v ?? last)); };
  const lows = fill(spanned(days, hrvP.value, (d) => d.hrv?.low).values), highs = fill(spanned(days, hrvP.value, (d) => d.hrv?.high).values);
  const lastHrv = days.filter((d) => d.hrv && d.date <= now).sort((a, b) => b.date.localeCompare(a.date))[0]?.hrv;
  const hrv7 = st.mean(hv.raw.slice(-7).map((p) => p.v));
  const rawLows = fill(st.daySeries(days, hrvP.value, (d) => d.hrv?.low).map((p) => p.v));
  const below = hv.raw.filter((p, i) => p.v != null && rawLows[i] != null && p.v < rawLows[i]).length, nights = hv.raw.filter((p) => p.v != null).length;
  const hrv = card(null, cardHead('HRV tijdens de slaap', hrvP.control),
    el('div', { className: 'figures' },
      figure({ label: 'Laatste nacht', value: lastHrv ? nf(lastHrv.avg) : null, unit: 'ms', band: nm.rateHrv(lastHrv), key: 'hrv', note: lastHrv?.low != null ? `Je normale bereik is ${lastHrv.low} tot ${lastHrv.high} ms.` : null }),
      figure({ label: 'Gemiddelde over 7 nachten', value: hrv7 ? nf(hrv7) : null, unit: 'ms', band: lastHrv?.baseline && hrv7 ? (hrv7 >= lastHrv.baseline - 2 ? { label: 'Op of boven je basislijn', tone: 'good' } : { label: 'Onder je basislijn', tone: 'fair' }) : null,
        note: lastHrv?.baseline ? `Je basislijn is ${lastHrv.baseline} ms.` : null }),
      figure({ label: `Nachten onder je bereik, ${hrvP.name}`, value: nights ? `${below} van ${nights}` : null, band: !nights ? null : below / nights <= 0.1 ? { label: 'Zelden', tone: 'good' } : below / nights <= 0.25 ? { label: 'Af en toe', tone: 'fair' } : { label: 'Vaak', tone: 'poor' },
        note: 'Meerdere lage nachten na elkaar zijn een signaal om gas terug te nemen.' })),
    chart({ title: 'HRV tijdens de slaap', labels: hv.labels, tick: hv.tick,
      band: { low: lows, high: highs, label: 'Normaal bereik' }, lines: [{ values: hv.values, color: C.hrv, label: hv.weekly ? 'HRV, gemiddelde per week' : 'HRV' }], fmt: (v) => `${nf(v)} ms`, tickFmt: (v) => nf(v) }));

  const rhrP = period('rhr', DAYS, 90, actions);
  const rh = spanned(days, rhrP.value, (d) => d.rhr);
  const rhrAvg = st.rolling(st.daySeries(days, rhrP.value + 6, (d) => d.rhr).map((p) => p.v), 7).slice(-rhrP.value);
  const rhr7 = st.mean(rh.raw.slice(-7).map((p) => p.v)), rhrOld = st.mean(rh.raw.slice(0, Math.min(30, Math.floor(rhrP.value / 3))).map((p) => p.v));
  const rhrLow = Math.min(...rh.raw.map((p) => p.v ?? Infinity));
  const rhr = card(null, cardHead('Rusthartslag', rhrP.control),
    el('div', { className: 'figures' },
      figure({ label: 'Gemiddelde over 7 dagen', value: rhr7 ? nf(rhr7) : null, unit: 'bpm', raw: rhr7, band: nm.rate(rhr7, nm.RHR), scale: nm.RHR, min: 40, max: 90, key: 'rhr',
        note: rhr7 && rhrOld ? `${Math.abs(rhr7 - rhrOld) < 1 ? 'Gelijk aan' : `${nf(Math.abs(rhr7 - rhrOld))} ${rhr7 < rhrOld ? 'lager' : 'hoger'} dan`} het begin van deze periode (${nf(rhrOld)}). Dalen is een teken van betere conditie.` : null }),
      figure({ label: `Laagste waarde, ${rhrP.name}`, value: Number.isFinite(rhrLow) ? nf(rhrLow) : null, unit: 'bpm', raw: Number.isFinite(rhrLow) ? rhrLow : null, band: nm.rate(Number.isFinite(rhrLow) ? rhrLow : null, nm.RHR), note: 'Je laagste dag toont waar je hart toe in staat is als je goed hersteld bent.' })),
    chart({ title: 'Rusthartslag', labels: rh.labels, tick: rh.tick,
      lines: rh.weekly ? [{ values: rh.values, color: C.hart, label: 'Gemiddelde per week' }] : [{ values: rh.values, color: '#f1a4a4', label: 'Per dag' }, { values: rhrAvg, color: C.hart, label: 'Gemiddelde over 7 dagen' }], fmt: (v) => `${nf(v)} bpm`, tickFmt: (v) => nf(v) }));

  const stepP = period('stappen', DAYS, 30, actions);
  const sp = spanned(days, stepP.value, (d) => d.steps);
  const stepAvg = st.mean(sp.raw.map((p) => p.v)), stepDays = sp.raw.filter((p) => p.v != null).length;
  const steps = card(null, cardHead('Stappen', stepP.control),
    el('div', { className: 'figures' }, figure({ label: `Gemiddeld per dag, ${stepP.name}`, value: stepAvg ? nf(stepAvg) : null, raw: stepAvg, band: nm.rate(stepAvg, nm.STEPS), scale: nm.STEPS, min: 0, max: 15000, key: 'steps',
      note: stepAvg ? `Op ${sp.raw.filter((p) => p.v >= 7500).length} van de ${stepDays} dagen haalde je 7.500 stappen.` : null })),
    chart({ title: 'Stappen', labels: sp.labels, tick: sp.tick, bars: { values: sp.values, color: C.stappen, label: sp.weekly ? 'Gemiddelde per dag, per week' : 'Stappen' }, fmt: (v) => nf(v), tickFmt: (v) => `${nf(v / 1000)}k` }));

  const rec = meta.recovery;
  const recovery = rec?.percent != null ? card('Herstel', el('div', { className: 'figures' }, figure({ label: 'Nu volgens COROS', value: nf(rec.percent), unit: '%', raw: rec.percent, band: nm.rate(rec.percent, nm.RECOVERY), scale: nm.RECOVERY, min: 0, max: 100, key: 'recovery',
    note: rec.hoursToFull ? `Volledig hersteld over ongeveer ${rec.hoursToFull} uur.` : null }))) : null;

  return el('div', { className: 'view' }, head('Slaap en herstel'), recovery, sleep, stages, hrv, rhr, steps);
}

// --- Progressie ---

// De tijden die bij een prestatie-index horen, als leesbare zin.
const equivalents = (v) => [['5 km', 5000], ['10 km', 10000], ['een halve marathon', 21097.5]].map(([label, d]) => `${label} in ${clock(nm.timeForVdot(v, d))}`).join(', ');

// Hoe zwaar een soort sessie weegt tegenover je gemiddelde training: rustig werk levert per minuut minder belasting op dan intervallen.
const KIND_WEIGHT = { easy: 0.85, long: 0.85, strides: 1, tempo: 1.2, interval: 1.3, race: 1.4 };

// Vooruitblik: je fitheid doorgerekend langs je trainingsschema, met je eigen belasting per minuut.
function outlookCard({ activities, meta }, vo2) {
  const now = st.isoDate();
  const rate = st.loadPerMinute(activities);
  const history = st.loadSeries(activities, 5000);
  const cur = history.at(-1);
  if (!rate || !cur) return null;
  const goal = meta.weekGoal || 3;
  const fromPlan = !!meta.plan;
  // Zonder schema: je weekdoel aan 30 minuten per sessie, gelijk verdeeld over de week.
  const pattern = st.spread(goal), dow = (new Date(now + 'T12:00:00').getDay() + 6) % 7;
  const sessions = fromPlan
    ? meta.plan.weeks.flatMap((w) => w.sessions).filter((x) => x.date >= now && pl.status(x, activities) !== 'gedaan')
    : Array.from({ length: 42 }, (_, i) => i).filter((i) => pattern[(dow + i + 1) % 7]).map((i) => ({ date: st.addDays(now, i + 1), minutes: 30, kind: 'easy', title: 'Sessie van 30 minuten' }));
  const lastDate = sessions.at(-1)?.date || now;
  const horizon = Math.max(28, Math.min(84, Math.round((Date.parse(lastDate) - Date.parse(now)) / st.DAY)));
  const future = Array.from({ length: horizon }, (_, i) => st.addDays(now, i + 1));
  const inRange = sessions.filter((x) => x.date <= future.at(-1));
  const loadOf = (x) => (x.kind === 'race' ? rate * 60 * KIND_WEIGHT.race : x.minutes * rate * (KIND_WEIGHT[x.kind] || 1));
  const perDay = (list) => { const m = new Map(); for (const x of list) m.set(x.date, (m.get(x.date) || 0) + loadOf(x)); return m; };
  const run = (list, startToday) => { const m = perDay(list); return st.projectFitness(startToday ? st.projectFitness(cur, [m.get(now) || 0]).at(-1) : cur, future.map((d) => m.get(d) || 0)); };
  // Vandaag zit al in de huidige stand; een sessie van vandaag die nog moet gebeuren tellen we er eerst bij.
  const todays = inRange.filter((x) => x.date === now);
  const full = run(inRange, todays.length > 0);
  const partial = run(inRange.filter((_, i) => i % 3 !== 2), todays.length > 0);
  const idle = st.projectFitness(cur, future.map(() => 0));

  const next = inRange[0];
  const gain = next ? loadOf(next) / 42 : null;
  const end = full.at(-1).fitness, pct = cur.fitness > 0 ? (end - cur.fitness) / cur.fitness * 100 : null;
  const peak = Math.max(...full.map((p) => p.fitness)), peakAt = future[full.findIndex((p) => p.fitness === peak)];
  const lastTime = history.slice(0, -7).findLast((p) => p.fitness >= peak);
  const best180 = Math.max(...history.slice(-180).map((p) => p.fitness));
  const passes = full.findIndex((p) => p.fitness > best180);
  const minutes = inRange.reduce((t, x) => t + x.minutes, 0);
  const longest = Math.max(0, ...inRange.map((x) => x.minutes));
  const weeksCount = Math.ceil(horizon / 7);
  const stop = idle.at(-1).fitness, rising = end > cur.fitness + 1;
  const low = full.reduce((m, p, i) => (p.fitness < full[m].fitness ? i : m), 0);   // het dal: vanaf hier stijgt je fitheid weer
  const past = history.slice(-28);
  const pad = (arr) => [...past.map((p, i) => (i === past.length - 1 ? p.fitness : null)), ...arr.map((p) => p.fitness)];
  const until = fromPlan && meta.goal.kind === 'race' && meta.goal.date <= future.at(-1) ? `tot je ${pl.goalLabel(meta.goal).toLowerCase()} op ${shortDay(meta.goal.date)}` : `de komende ${weeksCount} weken`;
  const step = Math.ceil((past.length + horizon) / 6);

  return card('Vooruitblik',
    el('p', { className: 'muted' }, fromPlan
      ? `Waar je schema voor ${pl.goalLabel(meta.goal).toLowerCase()} je brengt, doorgerekend met je eigen belasting per minuut. Rustige sessies tellen lichter dan tempo en intervallen.`
      : ['Nog geen schema: dit rekent met je weekdoel aan 30 minuten per sessie. ', el('a', { href: '#schema', textContent: 'Kies een doel' }), ' voor een vooruitblik op maat.']),
    el('div', { className: 'figures' },
      next ? figure({ label: `Je volgende sessie: ${next.title.toLowerCase()}`, value: `+${nf(gain, 1)}`, band: { label: 'Fitheid stijgt', tone: 'good' },
        note: `${next.date === now ? 'Vandaag' : longDay(next.date)}${next.minutes ? `, ${next.minutes} minuten` : ''}. Elke dag zonder training zakt je fitheid met ongeveer ${nf(cur.fitness / 42, 1)}; deze sessie maakt ${nf(gain / (cur.fitness / 42 || 1), 1)} van zulke dagen goed.` }) : null,
      figure({ label: `${fromPlan ? 'Je schema volgen' : `${goal}× 30 minuten per week`}, ${until}`, value: nf(end),
        band: end > cur.fitness + 1 ? { label: 'Opbouw', tone: 'good' } : end >= cur.fitness * 0.85 ? { label: 'Behoud', tone: 'good' } : { label: 'Zakt, maar veel minder dan bij stoppen', tone: 'fair' },
        note: `${pct != null ? `${pct >= 0 ? '+' : '−'}${nf(Math.abs(pct))}% tegenover nu (${nf(cur.fitness)}), en ${nf(end - stop)} punten meer dan wanneer je stopt. ` : ''}${rising
          ? (lastTime ? `Zo fit was je voor het laatst op ${fullDay(lastTime.date)}.` : 'Zo fit was je nog nooit volgens je data.')
          : 'Je fitheid telt nu nog een recente drukke periode mee. Het schema start bewust rustig en bouwt daarna op.'}${rising && peak > end + 1 && peakAt > st.addDays(now, 14) ? ` Je piek van ${nf(peak)} valt rond ${shortDay(peakAt)}, vlak voor de afbouw.` : ''}` }),
      figure({ label: 'Als je 2 van de 3 sessies haalt', value: nf(partial.at(-1).fitness), band: partial.at(-1).fitness > cur.fitness + 1 ? { label: 'Nog altijd opbouw', tone: 'good' } : { label: 'Het meeste blijft overeind', tone: 'good' },
        note: `Een gemiste sessie is geen ramp: je houdt ${nf((partial.at(-1).fitness - stop) / Math.max(0.1, end - stop) * 100)}% van het effect van je schema over. Regelmaat telt meer dan perfectie.` }),
      figure({ label: 'Als je stopt', value: nf(stop), band: { label: 'Verlies', tone: 'poor' },
        note: `Na ${weeksCount} weken blijft ${nf(stop / (cur.fitness || 1) * 100)}% van je fitheid over. Na ongeveer 4 weken stilzitten is de helft weg.` })),
    chart({ title: 'Vooruitblik op je fitheid', labels: [...past.map((p) => longDay(p.date)), ...future.map(longDay)], tick: (i) => (i % step === Math.floor(step / 2) ? shortDay(i < past.length ? past[i].date : future[i - past.length]) : ''), zero: true,
      lines: [{ values: [...past.map((p) => p.fitness), ...future.map(() => null)], color: '#0b0b0b', label: 'Tot nu' }, { values: pad(idle), color: '#898781', label: 'Stoppen' },
        { values: pad(partial), color: C.vermoeidheid, label: '2 van de 3 sessies' }, { values: pad(full), color: C.fitheid, label: fromPlan ? 'Je schema' : `${goal}× 30 min per week` }], fmt: (v) => nf(v, 1), tickFmt: (v) => nf(v) }),
    el('div', { className: 'figures' },
      figure({ label: 'Wat je dan gedaan hebt', value: `${inRange.length}`, unit: inRange.length === 1 ? 'sessie' : 'sessies', note: `Samen ${hours(minutes / 60)} training in ${weeksCount} weken, met een langste sessie van ${longest} minuten.` }),
      figure({ label: 'Je reeks', value: `${weeksCount}`, unit: 'weken op rij', note: `Haal je elke week je doel, dan staat je reeks op ${weeksCount} weken. Je langste ooit is ${st.streak(st.weeks(activities), goal).best}.` }),
      !rising && low > 0 && low < full.length - 7 && end > full[low].fitness + 0.5 ? figure({ label: 'Het keerpunt', value: shortDay(future[low]), band: { label: 'Vanaf dan stijgt je fitheid', tone: 'good' },
        note: `Tot dan weegt je recente drukke periode nog door. Daarna wint het schema: van ${nf(full[low].fitness)} naar ${nf(end)}.` }) : null,
      passes >= 0 ? figure({ label: 'Fitter dan in het laatste halfjaar', value: shortDay(future[passes]), band: { label: 'Binnen bereik', tone: 'top' }, note: `Rond die dag passeer je ${nf(best180)}, je hoogste fitheid van de laatste 6 maanden.` })
        : figure({ label: 'Je hoogste fitheid van het laatste halfjaar', value: nf(best180), note: `Dit schema brengt je tot ${nf(Math.max(end, rising ? peak : end))}. ${best180 - peak > 1 ? 'Dat verschil haal je in met meer sessies per week of een langer schema; forceren heeft geen zin.' : 'Daar zit je dan weer vlakbij.'}` })),
    vo2.value != null ? el('p', { className: 'muted small', textContent: `Je VO2max voorspellen kan niet per persoon. Uit onderzoek: wie 3 keer per week traint, wint in 8 tot 12 weken doorgaans 5 tot 15%; voor jou zou dat ${nf(vo2.value * 1.05)} tot ${nf(vo2.value * 1.15)} zijn. Wie minder getraind is, wint het snelst.` }) : null);
}

export function progress({ activities, meta }, actions) {
  if (!activities.length) return el('div', { className: 'view' }, head('Progressie'), card(null, empty('Nog geen activiteiten.')));
  const z = zonesOf(meta);
  const now = st.isoDate();
  const refHr = Math.round((z.rest + 0.68 * (z.max - z.rest)) / 5) * 5;
  const vo2 = ph.current(activities, (a) => ph.vo2maxFromRun(a, z));
  const year = ph.bestEfforts(activities, st.addDays(now, -365));
  const vd = year.filter((e) => e.timeS && e.dist >= 5000).map((e) => ({ ...e, vdot: ph.vdot(e.dist, e.timeS) })).sort((a, b) => b.vdot - a.vdot)[0];
  const first = activities.reduce((min, a) => (a.date < min ? a.date : min), now);
  const allMonths = (new Date(now).getFullYear() - +first.slice(0, 4)) * 12 + new Date(now).getMonth() - +first.slice(5, 7) + 2;
  const condP = period('conditie', [[12, '1 jaar'], [24, '2 jaar'], [Math.max(36, allMonths), 'Alles']], 24, actions);
  const months = ph.monthly(activities, (a) => ph.vo2maxFromRun(a, z), condP.value);
  const mStep = Math.ceil(condP.value / 8);
  const monthName = (m) => day(m + '-15', { month: 'short', year: '2-digit' });
  const { scale, group } = nm.vo2Scale(meta.profile || {});
  const seen = months.filter((m) => m.v != null);
  const trend = seen.length >= 2 ? seen.at(-1).v - seen[0].v : null;
  const coros = meta.fitness?.vo2max;

  const fitness = card(null, cardHead('Conditie', condP.control),
    el('div', { className: 'figures' },
      figure({ label: 'VO2max volgens Kadans', value: vo2.value != null ? nf(vo2.value) : null, raw: vo2.value, band: nm.rate(vo2.value, scale), scale, min: 25, max: 60, key: 'vo2max',
        note: vo2.value != null ? `Uit hartslag en tempo van ${vo2.n} lopen in de laatste 60 dagen. Schaal voor ${group}.${trend != null ? ` ${trend >= 0 ? '+' : '−'}${nf(Math.abs(trend), 1)} sinds ${monthName(seen[0].month)}.` : ''}` : 'Minstens 2 lopen van 20 minuten in 60 dagen nodig.' }),
      figure({ label: 'Prestatie-index', value: vd ? nf(vd.vdot) : null, key: 'vdot',
        note: vd ? `Uit je beste ${vd.label.toLowerCase()} van het laatste jaar (${clock(vd.timeS)}). Dat is evenveel waard als ${equivalents(vd.vdot)}.` : 'Nog geen loop van 5 km of meer in het laatste jaar.' }),
      figure({ label: 'VO2max volgens COROS', value: coros != null ? nf(coros) : null, raw: coros, band: nm.rate(coros, scale), scale, min: 25, max: 60,
        note: coros != null && vo2.value != null ? `${Math.abs(coros - vo2.value) < 1 ? 'COROS en Kadans komen op hetzelfde uit.' : `COROS zit ${nf(Math.abs(coros - vo2.value))} punten ${coros > vo2.value ? 'hoger' : 'lager'} dan Kadans.`}${meta.fitness?.pred5k ? ` Tegelijk voorspelt COROS een 5 km in ${clock(meta.fitness.pred5k)}, wat een prestatie-index van ${nf(ph.vdot(5000, meta.fitness.pred5k))} is.` : ''}` : 'Ter vergelijking.' })),
    el('p', { className: 'muted', textContent: `Kadans rekent uit hoeveel zuurstof je tempo kost en bij welk deel van je hartslagreserve je dat liep (maximum ${z.max}, rust ${z.rest}). Je zones en je trainingen zijn met dezelfde polsmeting gemeten, dus het verloop in de tijd is betrouwbaar; het absolute getal blijft een schatting.` }),
    seen.length ? chart({ title: 'VO2max per maand', labels: months.map((m) => `${monthName(m.month)} · ${m.n} lopen`), tick: (i) => (i % mStep === mStep - 1 ? monthName(months[i].month) : ''),
      lines: [{ values: months.map((m) => m.v), color: C.fitheid, label: 'VO2max volgens Kadans' }], fmt: (v) => nf(v, 1), tickFmt: (v) => nf(v) }) : empty('Nog te weinig lopen om een verloop te tonen.'));

  const paces = ph.monthly(activities, (a) => ph.paceAtHr(a, z, refHr), condP.value);
  const pSeen = paces.filter((m) => m.v != null);
  const pDiff = pSeen.length >= 2 ? pSeen[0].v - pSeen.at(-1).v : null;
  const paceCard = card(`Tempo bij ${refHr} slagen`,
    pSeen.length ? el('div', { className: 'figures' }, figure({ label: `Nu, bij ${refHr} slagen`, value: `${clock(pSeen.at(-1).v)} /km`,
      band: pDiff == null ? null : pDiff > 5 ? { label: 'Sneller geworden', tone: 'good' } : pDiff < -5 ? { label: 'Trager geworden', tone: 'fair' } : { label: 'Gelijk gebleven', tone: 'good' },
      note: pDiff != null ? `${nf(Math.abs(pDiff))} seconden per kilometer ${pDiff >= 0 ? 'sneller' : 'trager'} dan in ${monthName(pSeen[0].month)}.` : null })) : null,
    el('p', { className: 'muted', textContent: 'Hoe snel je loopt bij eenzelfde hartslag, per maand. Stijgt de lijn, dan loop je sneller voor dezelfde inspanning: dat is je conditie die verbetert, ook als je nooit voluit gaat.' }),
    pSeen.length ? chart({ title: 'Tempo bij vaste hartslag', labels: paces.map((m) => `${monthName(m.month)} · ${m.n} lopen`), tick: (i) => (i % mStep === mStep - 1 ? monthName(paces[i].month) : ''), invert: true,
      lines: [{ values: paces.map((m) => m.v), color: C.lopen, label: `Tempo bij ${refHr} slagen` }], fmt: (v) => `${clock(v)} /km`, tickFmt: (v) => clock(v) }) : empty('Nog te weinig lopen om een verloop te tonen.'));

  const goal = meta.weekGoal || 3;
  const outlook = outlookCard({ activities, meta }, vo2);

  // Dit jaar tegenover vorig jaar, regelmaat en verdeling over de sporten.
  const ytd = st.yearToDate(activities);
  const cons = st.consistency(activities, goal);
  const run52 = st.streak(st.weeks(activities), goal);
  const yearActs = activities.filter((a) => st.isSession(a) && a.date.startsWith(String(ytd.year)));
  const mix = st.SPORTS.map((k) => ({ label: SPORT_NAMES[k], color: C[k], value: yearActs.filter((a) => st.sportBucket(a) === k).reduce((t, a) => t + a.durationS / 3600, 0) }));
  const mixTotal = mix.reduce((t, m) => t + m.value, 0);
  const diff = (a, b) => (b ? `${a >= b ? '+' : '−'}${nf(Math.abs(a - b) / b * 100)}% tegenover ${ytd.year - 1}` : `geen data over ${ytd.year - 1}`);
  const ahead = (a, b) => (b ? (a >= b ? { label: 'Voor op vorig jaar', tone: 'good' } : { label: 'Achter op vorig jaar', tone: 'fair' }) : null);
  const mh = st.monthlyHours(activities, condP.value);
  const bestMonth = mh.reduce((b, m) => { const t = st.SPORTS.reduce((x, k) => x + m[k], 0); return t > b.t ? { t, month: m.month } : b; }, { t: 0, month: null });
  const yearCard = card(`${ytd.year} tegenover ${ytd.year - 1}`,
    el('div', { className: 'donut-block' },
      mixTotal ? donut(mix, [el('strong', { textContent: `${nf(mixTotal)} u` }), el('span', { textContent: `in ${ytd.year}` })]) : null,
      el('div', { className: 'ring-rows' }, mix.filter((m) => m.value > 0).map((m) => el('div', { className: 'ring-row' }, el('i', { style: `background:${m.color}` }),
        el('div', {}, el('div', { className: 'ring-label', textContent: m.label }), el('div', {}, el('strong', { textContent: hours(m.value) }), el('span', { className: 'muted', textContent: ` · ${nf(m.value / mixTotal * 100)}%` }))))))),
    el('div', { className: 'figures' },
      figure({ label: 'Sessies tot vandaag', value: nf(ytd.now.sessions), band: ahead(ytd.now.sessions, ytd.before.sessions), note: `${diff(ytd.now.sessions, ytd.before.sessions)} op dezelfde dag (${nf(ytd.before.sessions)}).` }),
      figure({ label: 'Uren tot vandaag', value: nf(ytd.now.hours), unit: 'u', band: ahead(ytd.now.hours, ytd.before.hours), note: `${diff(ytd.now.hours, ytd.before.hours)} (${nf(ytd.before.hours)} u).` }),
      ...[['Gelopen', 'lopen', 0], ['Gefietst', 'fietsen', 0], ['Gezwommen', 'zwemmen', 1]].filter(([, k]) => ytd.now[k] || ytd.before[k]).map(([label, k, d]) =>
        figure({ label, value: nf(ytd.now[k], d), unit: 'km', band: ahead(ytd.now[k], ytd.before[k]), note: `${diff(ytd.now[k], ytd.before[k])} (${nf(ytd.before[k], d)} km).` }))));

  const regular = card(null, cardHead('Regelmaat en volume', condP.control),
    el('div', { className: 'figures' },
      figure({ label: 'Weken met training, laatste jaar', value: `${cons.active} van ${cons.weeks}`, raw: cons.active / cons.weeks * 100, min: 0, max: 100, fmt: (v) => `${v}%`,
        scale: [{ to: 50, label: 'Onregelmatig', tone: 'poor' }, { to: 75, label: 'Redelijk regelmatig', tone: 'fair' }, { to: 90, label: 'Regelmatig', tone: 'good' }, { to: Infinity, label: 'Zeer regelmatig', tone: 'top' }],
        band: nm.rate(cons.active / cons.weeks * 100, [{ to: 50, label: 'Onregelmatig', tone: 'poor' }, { to: 75, label: 'Redelijk regelmatig', tone: 'fair' }, { to: 90, label: 'Regelmatig', tone: 'good' }, { to: Infinity, label: 'Zeer regelmatig', tone: 'top' }]),
        note: `In ${cons.onGoal} van die weken haalde je je weekdoel van ${goal}. Regelmaat weegt zwaarder dan losse zware weken.` }),
      figure({ label: 'Sessies per week, laatste jaar', value: nf(cons.average, 1), band: cons.average >= goal ? { label: 'Op je weekdoel', tone: 'good' } : cons.average >= goal * 0.6 ? { label: 'Onder je weekdoel', tone: 'fair' } : { label: 'Ver onder je weekdoel', tone: 'poor' }, note: `Je weekdoel is ${goal}.` }),
      figure({ label: 'Reeks', value: `${run52.current}`, unit: run52.current === 1 ? 'week' : 'weken', band: run52.current >= 4 ? { label: 'Sterke reeks', tone: 'top' } : run52.current >= 1 ? { label: 'Bezig', tone: 'good' } : { label: 'Nog te starten', tone: 'fair' }, note: `Je langste reeks ooit is ${run52.best} ${run52.best === 1 ? 'week' : 'weken'}.` }),
      bestMonth.month ? figure({ label: 'Beste maand in deze periode', value: nf(bestMonth.t, 1), unit: 'u', note: day(bestMonth.month + '-15', { month: 'long', year: 'numeric' }) }) : null),
    chart({ title: 'Trainingsuren per maand', labels: mh.map((m) => `${monthName(m.month)} · ${m.sessions} sessies`), tick: (i) => (i % mStep === mStep - 1 ? monthName(mh[i].month) : ''),
      stacks: { keys: st.SPORTS.map((k) => ({ key: k, label: SPORT_NAMES[k], color: C[k] })), rows: mh }, fmt: (v) => hours(v), tickFmt: (v) => `${nf(v)} u` }));

  const since = st.addDays(now, -365);
  const isNew = (date) => date >= st.addDays(now, -30);
  const recordTable = (title, rows, recent, rate, note) => {
    const cell = (e) => (e?.timeS ? el('td', {}, el('a', { href: `#activiteit/${e.id}` }, el('strong', { textContent: clock(e.timeS) })), isNew(e.date) ? el('span', { className: 'badge', textContent: 'nieuw' }) : null,
      el('div', { className: 'muted small', textContent: [fullDay(e.date), rate?.(e)].filter(Boolean).join(' · ') })) : el('td', { className: 'muted', textContent: '–' }));
    const set = rows.filter((e) => e.timeS), fresh = set.filter((e) => isNew(e.date)).length;
    return el('details', { className: 'fold' },
      el('summary', {}, el('strong', { textContent: title }), el('span', { className: 'muted', textContent: `${set.length} van ${rows.length} afstanden${fresh ? ` · ${fresh} nieuw` : ''}` })),
      el('div', { className: 'table-wrap' }, el('table', { className: 'records' }, el('thead', {}, el('tr', {}, el('th', { textContent: 'Afstand' }), el('th', { textContent: 'Beste ooit' }), el('th', { textContent: 'Laatste 12 maanden' }))),
        el('tbody', {}, rows.map((e, i) => el('tr', {}, el('td', {}, e.label, e.legs ? el('div', { className: 'muted small', textContent: `${e.legs}${e.count ? ` · ${e.count}× gedaan` : ''}` }) : null), cell(e), cell(recent[i])))))),
      note ? el('p', { className: 'muted small', textContent: note }) : null);
  };
  const has = (sport) => activities.some((a) => a.sport === sport);
  const far = [['Langste loop', 'lopen'], ['Langste rit', 'fietsen'], ['Langste zwemtraining', 'zwemmen']].map(([label, sport]) => [label, ph.longest(activities, sport)]).filter(([, a]) => a);
  const climb = activities.filter((a) => a.sport === 'fietsen' && a.detail?.elevGain).reduce((b, a) => (!b || a.detail.elevGain > b.detail.elevGain ? a : b), null);
  const records = card('Records',
    el('p', { className: 'muted', textContent: 'Je snelste aaneengesloten stuk over elke afstand, ook midden in een langere training. Ligt je tijd van de laatste 12 maanden dicht bij je beste ooit, dan zit je dicht bij je topvorm.' }),
    has('lopen') ? recordTable('Lopen', ph.bestEfforts(activities), ph.bestEfforts(activities, since), (e) => `${clock(e.timeS / e.dist * 1000)} /km`) : null,
    has('fietsen') ? recordTable('Fietsen', ph.efforts(activities, 'fietsen', ph.BIKE_DISTANCES), ph.efforts(activities, 'fietsen', ph.BIKE_DISTANCES, since), (e) => `${nf(e.dist / e.timeS * 3.6, 1)} km/u`) : null,
    has('zwemmen') ? recordTable('Zwemmen', ph.efforts(activities, 'zwemmen', ph.SWIM_DISTANCES), ph.efforts(activities, 'zwemmen', ph.SWIM_DISTANCES, since), (e) => `${clock(e.timeS / e.dist * 100)} /100 m`,
      'Zwemtijden tellen alleen de tijd dat je zwom, zonder de rustpauzes aan de kant, zoals COROS je tempo berekent.') : null,
    has('triatlon') ? recordTable('Triatlon', ph.triathlons(activities), ph.triathlons(activities, since), null, 'Ingedeeld naar de totale afstand van de wedstrijd. De tijd is de totale tijd, wissels inbegrepen.') : null,
    el('div', { className: 'figures' }, far.map(([label, a]) => el('a', { className: 'figure', href: `#activiteit/${a.id}` }, el('div', { className: 'tile-label', textContent: label }), el('div', { className: 'tile-value', textContent: distance(a) }), el('div', { className: 'tile-note', textContent: `${fullDay(a.date)} · ${clock(a.durationS)}` }))),
      climb ? el('a', { className: 'figure', href: `#activiteit/${climb.id}` }, el('div', { className: 'tile-label', textContent: 'Meeste hoogtemeters op de fiets' }), el('div', { className: 'tile-value', textContent: `${nf(climb.detail.elevGain)} m` }), el('div', { className: 'tile-note', textContent: `${fullDay(climb.date)} · ${distance(climb)}` })) : null));

  const ms = st.milestones(activities, goal);
  const earned = ms.filter((m) => m.date).sort((a, b) => b.date.localeCompare(a.date));
  const milestones = card('Mijlpalen',
    el('div', { className: 'donut-block' },
      donut([{ value: earned.length, color: '#ff375f', label: 'Behaald' }, { value: ms.length - earned.length, color: '#e5e5ea', label: 'Nog te halen' }], [el('strong', { textContent: `${earned.length}/${ms.length}` }), el('span', { textContent: 'behaald' })], 112, 16),
      el('div', { className: 'goalbars' }, nextMilestones(activities, goal).slice(0, 6).map(milestoneBar))),
    el('details', { className: 'fold' }, el('summary', {}, el('strong', { textContent: 'Behaalde mijlpalen' }), el('span', { className: 'muted', textContent: earned.length ? `laatste: ${earned[0].title}` : 'nog geen' })),
      el('div', { className: 'badges' }, earned.map((m) => el('div', { className: 'medal on' }, el('strong', { textContent: m.title }), el('span', { textContent: fullDay(m.date) }))))));

  const years = ph.yearly(activities);
  const totals = card('Per jaar',
    el('div', { className: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ['Jaar', 'Sessies', 'Uren', 'Lopen', 'Fietsen', 'Zwemmen'].map((t) => el('th', { textContent: t })))),
      el('tbody', {}, years.map((y) => el('tr', {}, [y.year, nf(y.sessions), nf(y.hours), `${nf(y.lopen)} km`, `${nf(y.fietsen)} km`, `${nf(y.zwemmen, 1)} km`].map((t) => el('td', { textContent: t }))))))));

  return el('div', { className: 'view' }, head('Progressie'), outlook, fitness, paceCard, yearCard, regular, records, milestones, totals);
}

// --- Voeding ---

let foodDate = null;

export function food({ days, meta }, actions) {
  const now = st.isoDate();
  foodDate ||= now;
  const dayRow = days.find((d) => d.date === foodDate) || {};
  const log = dayRow.food || {};
  const set = (key, n) => actions.saveDay(foodDate, { food: { ...log, [key]: Math.max(0, n) } });

  const counters = card(null,
    el('div', { className: 'date-nav' },
      btn('', '‹', () => { foodDate = st.addDays(foodDate, -1); actions.render(); }, { ariaLabel: 'Vorige dag' }),
      el('strong', { textContent: foodDate === now ? 'Vandaag' : foodDate === st.addDays(now, -1) ? 'Gisteren' : longDay(foodDate) }),
      btn('', '›', () => { foodDate = st.addDays(foodDate, 1); actions.render(); }, { disabled: foodDate >= now, ariaLabel: 'Volgende dag' })),
    el('p', { className: 'muted', textContent: 'Tik aan wat je at en dronk. Geen calorieën, alleen aantallen: uit het patroon over weken haalt Kadans de rest.' }),
    el('div', { className: 'counters' }, fd.ITEMS.map((item) => el('div', { className: 'counter' },
      el('div', {}, el('strong', { textContent: item.label }), el('span', { className: 'muted', textContent: ` ${item.unit}` })),
      el('div', { className: 'stepper' }, btn('', '−', () => set(item.key, (log[item.key] || 0) - 1), { disabled: !log[item.key], ariaLabel: `Minder ${item.label}` }),
        el('strong', { textContent: String(log[item.key] || 0) }), btn('', '+', () => set(item.key, (log[item.key] || 0) + 1), { ariaLabel: `Meer ${item.label}` }))))),
    dayRow.food ? null : btn('link', 'Niets van dit alles: deze dag toch meetellen', () => actions.saveDay(foodDate, { food: {} })));

  const sum = fd.summary(days);
  const pattern = card('Je patroon, laatste 30 dagen',
    sum.days < 3 ? empty(`Log minstens 3 dagen om je patroon te zien. Je hebt er ${sum.days}.`) : [
      el('p', { className: 'muted', textContent: `Gemiddelden over ${sum.days} gelogde dagen, tegenover de Belgische voedingsaanbevelingen.` }),
      sum.items.map((it) => el('details', { className: 'session' },
        el('summary', {}, el('div', { className: 'session-main' }, el('div', { className: 'activity-title', textContent: it.label }),
          el('div', { className: 'muted', textContent: `${nf(it.value, 1)} ${it.unit} ${it.per}${it.kind === 'info' ? '' : ` · richtlijn: ${it.kind === 'min' ? 'minstens' : 'hoogstens'} ${it.target}`}` })), verdict(it.rating)),
        el('p', { textContent: it.why })))]);

  const links = fd.sleepLinks(days);
  const linkCard = card('Verband met je slaap',
    links.length ? links.map((l) => el('p', {}, verdict(Math.abs(l.diff) < 2 ? { label: 'Geen verschil', tone: 'good' } : l.diff < 0 ? { label: 'Slechtere slaap', tone: 'poor' } : { label: 'Betere slaap', tone: 'good' }),
      el('span', { className: 'muted', textContent: ` Na dagen waarop je ${l.text}, was je slaapscore gemiddeld ${nf(Math.abs(l.diff))} punten ${l.diff < 0 ? 'lager' : 'hoger'} (${l.n} dagen).` })))
      : empty('Zodra je minstens 4 dagen mét en 4 dagen zonder alcohol, veel koffie of fastfood hebt gelogd, vergelijkt Kadans je slaapscore in de nacht erna.'),
    links.length ? el('p', { className: 'muted small', textContent: 'Dit is een verband in jouw data, geen bewijs van oorzaak: andere dingen kunnen meespelen.' }) : null);

  const profile = meta.profile || {};
  const wt = fd.weightTrend(days);
  const kg = wt.average ?? profile.weightKg;
  const bmi = kg && profile.heightCm ? kg / (profile.heightCm / 100) ** 2 : null;
  const pct = wt.perWeek != null && kg ? wt.perWeek / kg * 100 : null;
  const rest = fd.restingEnergy({ ...profile, weightKg: kg });
  const move = st.mean(st.daySeries(days, 30, (d) => d.calories).map((p) => p.v));
  const item = (key) => sum.items.find((i) => i.key === key)?.value || 0;
  const liquid = sum.days >= 3 ? item('frisdrank') * 105 + item('alcohol') / 7 * 110 : null;
  const input = el('input', { type: 'number', step: '0.1', min: 30, max: 250, placeholder: 'kg', value: dayRow.weight || '' });
  const weight = card('Gewicht en energie',
    el('div', { className: 'weigh' }, el('label', { textContent: `Gewicht op ${foodDate === now ? 'vandaag' : shortDay(foodDate)}` }), input, btn('btn small', 'Opslaan', () => { if (+input.value > 0) actions.saveDay(foodDate, { weight: +input.value }); })),
    el('div', { className: 'figures' },
      figure({ label: 'Gewicht', value: kg ? nf(kg, 1) : null, unit: 'kg', note: wt.points.length ? `Gemiddelde van je metingen in de laatste 7 dagen (${wt.points.length} metingen in totaal).` : 'Uit je COROS-profiel. Log je gewicht om het verloop te volgen.' }),
      figure({ label: 'BMI', value: bmi ? nf(bmi, 1) : null, raw: bmi, band: nm.rate(bmi, nm.BMI), scale: nm.BMI, min: 15, max: 35, note: 'BMI houdt geen rekening met spiermassa; bij sporters valt hij vaak wat hoog uit.' }),
      figure({ label: 'Verandering per week', value: wt.perWeek != null ? `${wt.perWeek > 0 ? '+' : '−'}${nf(Math.abs(wt.perWeek), 2)}` : null, unit: 'kg', band: nm.rate(pct, nm.WEIGHT_PACE),
        note: wt.perWeek != null ? 'Over de laatste 4 weken. Gezond afvallen is 0,25 tot 1% van je gewicht per week; sneller kost spiermassa.' : 'Minstens 4 weken metingen nodig.' }),
      figure({ label: 'Geschat verbruik per dag', value: rest ? nf(rest + (move || 0)) : null, unit: 'kcal',
        note: rest ? `Rust ${nf(rest)} kcal (formule van Mifflin-St Jeor)${move ? ` plus beweging ${nf(move)} kcal volgens COROS` : ''}. Een tekort van ongeveer 500 kcal per dag geeft zo'n halve kilo per week.` : 'Lengte, gewicht en geboortedatum uit je COROS-profiel zijn nodig.' })),
    liquid != null && liquid >= 50 ? el('p', { className: 'advice warn', textContent: `Je frisdrank en alcohol zijn samen goed voor ongeveer ${nf(liquid)} kcal per dag. Dat is de makkelijkste winst als je wilt afvallen: je merkt het niet aan je honger.` }) : null,
    wt.points.length > 1 ? chart({ title: 'Gewicht', height: 170, labels: wt.points.map((p) => longDay(p.date)), tick: (i) => (i % Math.ceil(wt.points.length / 6) === 0 ? shortDay(wt.points[i].date) : ''),
      lines: [{ values: wt.points.map((p) => p.kg), color: C.fitheid, label: 'Gewicht' }], fmt: (v) => `${nf(v, 1)} kg`, tickFmt: (v) => nf(v) }) : null);

  return el('div', { className: 'view' }, head('Voeding'), counters, pattern, linkCard, weight);
}

// --- Schema ---

const SPORT_OF = { lopen: 'Lopen', fietsen: 'Fietsen', zwemmen: 'Zwemmen', triatlon: 'Triatlon' };
const STEP_NAMES = { warmup: 'opwarmen', work: '', recover: 'herstel', cooldown: 'uitlopen' };

function stepLines(s, z) {
  const zone = (stp) => `zone ${stp.zone} (${ph.zoneRange(z, stp.zone)} slagen)`;
  return s.steps.map((stp) => (stp.repeat
    ? `${stp.repeat}× ${stp.steps[0].min} min in ${zone(stp.steps[0])}, telkens ${stp.steps[1].min} min herstel in zone ${stp.steps[1].zone}`
    : `${stp.min} min ${STEP_NAMES[stp.type]}${STEP_NAMES[stp.type] ? ' ' : ''}in ${zone(stp)}`));
}

function sessionRow(s, activities, meta) {
  const state = pl.status(s, activities);
  return el('details', { className: 'session' },
    el('summary', {},
      el('i', { className: 'sport', style: `background:${C[s.sport] || C.andere}` }),
      el('div', { className: 'session-main' },
        el('div', { className: 'activity-title', textContent: s.title }),
        el('div', { className: 'muted', textContent: [day(s.date, { weekday: 'long', day: 'numeric', month: 'short' }), s.minutes ? `${s.minutes} min` : null, s.pushed ? 'staat op je horloge' : null].filter(Boolean).join(' · ') })),
      el('span', { className: `chip ${state}`, textContent: state })),
    el('p', { textContent: s.why }),
    s.steps.length ? el('ul', {}, stepLines(s, zonesOf(meta)).map((t) => el('li', { textContent: t }))) : null,
    s.sport === 'zwemmen' ? el('p', { className: 'muted', textContent: 'Zwem in blokken van 200 m met 20 seconden rust en let op techniek en ademhaling. Zwemtrainingen kan Kadans niet naar je horloge sturen.' }) : null);
}

let editingGoal = false;
const field = (label, control) => el('div', { className: 'field' }, el('label', { textContent: label }), control);

function goalForm(meta, actions) {
  const g = meta.goal || { kind: 'general', focus: 'regelmaat', sports: ['lopen'] };
  const option = (value, label, selected) => el('option', { value, textContent: label, selected });
  const kind = el('select', {}, option('general', 'Een algemeen doel', g.kind === 'general'), option('race', 'Een wedstrijd', g.kind === 'race'));
  const focus = el('select', {}, Object.entries(pl.FOCUS).map(([k, v]) => option(k, v.label, g.focus === k)));
  const race = el('select', {}, Object.entries(pl.RACES).map(([k, v]) => option(k, v.label, g.race === k)));
  const date = el('input', { type: 'date', value: g.date || st.addDays(st.isoDate(), 84), min: st.isoDate() });
  const sports = ['lopen', 'fietsen', 'zwemmen'].map((sp) => el('label', { className: 'check' }, el('input', { type: 'checkbox', value: sp, checked: (g.sports || ['lopen']).includes(sp) }), SPORT_OF[sp]));
  const n = el('input', { type: 'number', min: 1, max: 7, value: meta.weekGoal || 3 });
  const general = el('div', {}, field('Wat wil je bereiken?', focus), field('Met welke sporten?', el('div', { className: 'checks' }, sports)));
  const event = el('div', {}, field('Welke wedstrijd?', race), field('Wanneer?', date));
  const toggle = () => { general.hidden = kind.value !== 'general'; event.hidden = kind.value !== 'race'; };
  kind.onchange = toggle; toggle();
  const save = btn('btn', 'Schema maken', () => {
    const chosen = sports.map((l) => l.firstChild).filter((c) => c.checked).map((c) => c.value);
    const goal = kind.value === 'race' ? { kind: 'race', race: race.value, date: date.value } : { kind: 'general', focus: focus.value, sports: chosen.length ? chosen : ['lopen'] };
    editingGoal = false;
    actions.save({ goal, weekGoal: Math.max(1, Math.min(7, +n.value || 3)) });
  });
  return card('Kies je doel', el('p', { className: 'muted', textContent: 'Kadans maakt een schema dat vertrekt van wat je de laatste weken deed en geleidelijk opbouwt.' }),
    field('Ik train voor', kind), general, event, field('Sessies per week', n),
    el('div', { className: 'bar' }, save, meta.goal ? btn('btn ghost', 'Annuleren', () => { editingGoal = false; actions.render(); }) : null));
}

function settings(meta, actions) {
  const z = zonesOf(meta);
  const input = (value) => el('input', { type: 'number', min: 30, max: 240, value });
  const max = input(z.max), rest = input(z.rest), lt = input(z.lt);
  return card('Hartslag',
    el('p', { className: 'muted', textContent: 'Deze waarden bepalen je zones in het schema en de VO2max-berekening. Ze komen uit je COROS-profiel en zijn, net als je trainingen, met de polssensor gemeten. Pas ze aan als COROS ze bijwerkt.' }),
    el('div', { className: 'fields' }, field('Maximale hartslag', max), field('Rusthartslag', rest), field('Drempelhartslag', lt)),
    el('div', { className: 'hbars zones' }, ph.ZONE_NAMES.map((name, i) => el('div', { className: 'hbar' }, el('span', { textContent: `Zone ${i + 1} · ${name}` }), el('small', { textContent: `${ph.zoneRange(z, i + 1)} bpm` })))),
    el('div', { className: 'bar' }, btn('btn small', 'Opslaan', () => actions.save({ zones: { max: +max.value, rest: +rest.value, lt: +lt.value } }))));
}

export function schema({ activities, meta }, actions) {
  if (!meta.goal || !meta.plan || editingGoal) return el('div', { className: 'view' }, head('Schema'), goalForm(meta, actions), settings(meta, actions));
  const { goal, plan } = meta, now = st.isoDate();
  const weeksLeft = goal.kind === 'race' ? Math.max(0, Math.round((Date.parse(goal.date) - Date.parse(now)) / 6048e5)) : null;
  const past = plan.weeks.flatMap((w) => w.sessions).filter((s) => s.date < now && s.kind !== 'race');
  const doneCount = past.filter((s) => pl.status(s, activities) === 'gedaan').length;
  const summary = card(pl.goalLabel(goal),
    el('p', { className: 'muted', textContent: [goal.kind === 'race' ? `${longDay(goal.date)} ${goal.date.slice(0, 4)} · nog ${weeksLeft} ${weeksLeft === 1 ? 'week' : 'weken'}` : (goal.sports || []).map((sp) => SPORT_OF[sp]).join(', '), `${meta.weekGoal || 3} sessies per week`].join(' · ') }),
    past.length ? el('p', {}, verdict(doneCount / past.length >= 0.8 ? { label: 'Op schema', tone: 'good' } : doneCount / past.length >= 0.5 ? { label: 'Deels gevolgd', tone: 'fair' } : { label: 'Achter op schema', tone: 'poor' }),
      el('span', { className: 'muted', textContent: ` ${doneCount} van ${past.length} geplande sessies gedaan deze week.` })) : null,
    plan.warning ? el('p', { className: 'advice warn', textContent: plan.warning }) : null,
    chart({ title: 'Geplande minuten per week', height: 160, labels: plan.weeks.map((w) => `Week van ${shortDay(w.start)} · ${w.phase}`), tick: (i) => (i % 2 === 0 ? shortDay(plan.weeks[i].start) : ''),
      bars: { values: plan.weeks.map((w) => w.minutes), color: C.fitheid, label: 'Gepland' }, fmt: (v) => `${nf(v)} min`, tickFmt: (v) => nf(v) }),
    el('div', { className: 'bar' }, btn('btn small ghost', 'Doel wijzigen', () => { editingGoal = true; actions.render(); }), btn('btn small ghost', 'Schema herberekenen', () => actions.replan())));

  const week = (w, open) => {
    const rows = w.sessions.map((s) => sessionRow(s, activities, meta));
    return open ? card(`Deze week · ${w.phase}`, rows) : el('details', { className: 'card week-fold' }, el('summary', { textContent: `Week van ${shortDay(w.start)} · ${w.phase} · ${w.minutes} min` }), rows);
  };
  const soon = plan.weeks.flatMap((w) => w.sessions).filter((s) => s.date >= now && s.date <= st.addDays(now, 7) && pl.canPush(s));
  const watch = card('Naar je horloge',
    el('p', { className: 'muted', textContent: 'Zet de loop- en fietstrainingen van de komende 7 dagen in je COROS-agenda, met de hartslagzones per blok. Verwijderen of verplaatsen kan daarna alleen in de COROS-app.' }),
    el('div', { className: 'bar' }, btn('btn small', soon.length ? `${soon.length} ${soon.length === 1 ? 'training' : 'trainingen'} doorsturen` : 'Alles staat al op je horloge', () => actions.pushToWatch(soon), { disabled: !soon.length })));

  return el('div', { className: 'view' }, head('Schema'), summary, plan.weeks.map((w, i) => week(w, i === 0)), watch, settings(meta, actions));
}
