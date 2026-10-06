// Conditie en records, berekend uit je eigen activiteiten. Geen DOM en geen opslag.
import { isoDate, addDays, isSession } from './stats.js';

// Standaardwaarden uit je COROS-profiel; aanpasbaar bij Instellingen.
export const DEFAULT_ZONES = { max: 198, rest: 49, lt: 167 };

// De zes COROS-zones als fractie van je drempelhartslag (zo komen 134/150/159/170/177 uit bij een drempel van 167).
const ZONE_BOUNDS = [0.8, 0.9, 0.955, 1.02, 1.06];
export const ZONE_NAMES = ['Herstel', 'Aerobe duur', 'Aeroob vermogen', 'Drempel', 'Anaerobe duur', 'Anaeroob vermogen'];
export function zoneRange(z, zone) {
  const b = ZONE_BOUNDS.map((f) => Math.round(z.lt * f));
  if (zone === 1) return `onder ${b[0]}`;
  if (zone === 6) return `boven ${b[4]}`;
  return `${b[zone - 2]}–${b[zone - 1]}`;
}

export const median = (values) => {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  return v.length ? (v[(v.length - 1) >> 1] + v[v.length >> 1]) / 2 : null;
};

// Prestatie-index volgens Daniels & Gilbert (1979): wat een wedstrijdtijd waard is, uitgedrukt als VO2max.
export function vdot(distanceM, timeS) {
  const t = timeS / 60, v = distanceM / t;
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
  return vo2 / pct;
}

// Zuurstofverbruik bij lopen op vlak terrein in ml/kg/min (Léger & Mercier, 1984).
const runVo2 = (kmh) => 2.209 + 3.163 * kmh + 0.000525542 * kmh ** 3;
function kmhForVo2(vo2) {
  let kmh = (vo2 - 2.209) / 3.163;
  for (let i = 0; i < 4; i++) kmh -= (runVo2(kmh) - vo2) / (3.163 + 3 * 0.000525542 * kmh * kmh);
  return kmh;
}

// Alleen gewone lopen van minstens 20 minuten met een bruikbare hartslag; trail valt weg door de hoogtemeters.
function steadyRun(a, z) {
  if (a.sport !== 'lopen' || a.sportType === 102 || a.durationS < 1200 || !a.avgHr || !a.distanceM) return null;
  const kmh = a.distanceM / a.durationS * 3.6;
  const frac = (a.avgHr - z.rest) / (z.max - z.rest);
  return kmh >= 6 && kmh <= 22 && frac >= 0.6 && frac <= 1 ? { kmh, frac } : null;
}

// VO2max uit één loop: het aandeel van je hartslagreserve komt ongeveer overeen met het aandeel van je VO2-reserve (Swain, 1994).
export function vo2maxFromRun(a, z) {
  const r = steadyRun(a, z);
  return r ? 3.5 + (runVo2(r.kmh) - 3.5) / r.frac : null;
}

// Tempo (s/km) dat je bij hartslag `hr` zou lopen, omgerekend uit het tempo en de hartslag van deze loop.
export function paceAtHr(a, z, hr) {
  const r = steadyRun(a, z);
  if (!r) return null;
  const vo2 = 3.5 + (runVo2(r.kmh) - 3.5) * ((hr - z.rest) / (z.max - z.rest)) / r.frac;
  return 3600 / kmhForVo2(vo2);
}

// Mediaan per maand over de laatste `n` maanden; een maand telt vanaf 2 bruikbare lopen.
export function monthly(activities, fn, n = 24, today = isoDate()) {
  const groups = {};
  for (const a of activities) {
    const v = fn(a);
    if (v != null) (groups[a.date.slice(0, 7)] ||= []).push(v);
  }
  const out = [];
  const d = new Date(today.slice(0, 7) + '-15T12:00:00');
  d.setMonth(d.getMonth() - n + 1);
  for (let i = 0; i < n; i++, d.setMonth(d.getMonth() + 1)) {
    const month = isoDate(d).slice(0, 7);
    out.push({ month, v: (groups[month] || []).length >= 2 ? median(groups[month]) : null, n: (groups[month] || []).length });
  }
  return out;
}

// De huidige waarde: mediaan van de lopen in de laatste 60 dagen (minstens 2), anders niets.
export function current(activities, fn, today = isoDate()) {
  const since = addDays(today, -60);
  const v = activities.filter((a) => a.date >= since).map(fn).filter((x) => x != null);
  return v.length >= 2 ? { value: median(v), n: v.length } : { value: null, n: v.length };
}

export const DISTANCES = [['1 km', 1000], ['5 km', 5000], ['10 km', 10000], ['Halve marathon', 21097.5], ['Marathon', 42195]];
export const BIKE_DISTANCES = [['10 km', 10000], ['20 km', 20000], ['40 km', 40000], ['90 km', 90000], ['100 km', 100000], ['180 km', 180000]];
export const SWIM_DISTANCES = [['100 m', 100], ['400 m', 400], ['750 m', 750], ['1.500 m', 1500], ['1.900 m', 1900], ['3.800 m', 3800]];
// Snelste geloofwaardige snelheid in m/s per sport; alles daarboven is een meetfout.
const LIMIT = { lopen: 1000 / 150, fietsen: 70 / 3.6, zwemmen: 100 / 55 };

// Snelste tijd per afstand binnen een activiteit: het snelste aaneengesloten stuk uit de rondes
// (kilometers bij lopen en fietsen, banen bij zwemmen), of het gemiddelde tempo als de rondes ontbreken.
// Bij zwemmen telt alleen de zwemtijd, zonder de rustpauzes aan de kant, net zoals COROS het tempo berekent.
export function efforts(activities, sport, distances, since = '0000') {
  return distances.map(([label, dist]) => {
    let best = null;
    const offer = (timeS, a) => {
      if (!(timeS > 0) || dist / timeS > LIMIT[sport]) return;
      if (!best || timeS < best.timeS) best = { timeS, date: a.date, id: a.id };
    };
    for (const a of activities) {
      if (a.sport !== sport || a.date < since || (a.distanceM || 0) < dist) continue;
      if (sport !== 'zwemmen') offer(a.durationS * dist / a.distanceM, a);
      else if (a.detail?.paceS) offer(a.detail.paceS * dist / 100, a);
      const group = sport === 'zwemmen' ? a.laps?.find((g) => g.lapDistanceM === 25 || g.lapDistanceM === 50) : a.laps?.find((g) => g.lapDistanceM === 1000);
      if (!group) continue;
      const unit = group.lapDistanceM;
      const times = group.laps.filter((l) => l.distanceM >= unit - 1 && l.time > (sport === 'zwemmen' ? 8 : 0)).map((l) => l.time);
      const n = Math.floor(dist / unit);
      if (n < 1 || times.length < n) continue;
      let sum = times.slice(0, n).reduce((t, x) => t + x, 0), min = sum;
      for (let i = n; i < times.length; i++) { sum += times[i] - times[i - n]; min = Math.min(min, sum); }
      offer(min * dist / (n * unit), a);
    }
    return { label, dist, ...best };
  });
}
export const bestEfforts = (activities, since) => efforts(activities, 'lopen', DISTANCES, since);

// Triatlons ingedeeld naar totale afstand; per formaat de snelste, met het aantal keer dat je het deed.
export const TRI_FORMATS = [['Sprint', '750 m · 20 km · 5 km', 20, 35], ['Kwart', '1,5 km · 40 km · 10 km', 40, 65], ['Halve', '1,9 km · 90 km · 21,1 km', 100, 125], ['Volledige', '3,8 km · 180 km · 42,2 km', 200, 240]];
export function triathlons(activities, since = '0000') {
  return TRI_FORMATS.map(([label, legs, min, max]) => {
    const done = activities.filter((a) => a.sport === 'triatlon' && a.date >= since && a.distanceM >= min * 1000 && a.distanceM <= max * 1000);
    const best = done.reduce((b, a) => (!b || a.durationS < b.durationS ? a : b), null);
    return { label, legs, count: done.length, ...(best && { timeS: best.durationS, date: best.date, id: best.id }) };
  });
}

export function longest(activities, sport) {
  return activities.filter((a) => a.sport === sport && a.distanceM).reduce((best, a) => (!best || a.distanceM > best.distanceM ? a : best), null);
}

export function yearly(activities) {
  const out = {};
  for (const a of activities.filter(isSession)) {
    const y = (out[a.date.slice(0, 4)] ||= { year: a.date.slice(0, 4), sessions: 0, hours: 0, lopen: 0, fietsen: 0, zwemmen: 0 });
    y.sessions++;
    y.hours += a.durationS / 3600;
    if (a.sport in y) y[a.sport] += (a.distanceM || 0) / 1000;
  }
  return Object.values(out).sort((a, b) => b.year.localeCompare(a.year));
}
