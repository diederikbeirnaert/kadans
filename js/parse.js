// Zet de tekstantwoorden van COROS om naar gewone objecten.
// COROS geeft opgemaakte tekst terug, geen JSON; elke parser hier hoort bij één tool.
// Ontbrekende waarden worden null. COROS gebruikt daarvoor zelf -1, 655.35 of "No data".

const num = (s) => {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const valid = (n) => (n == null || n === -1 || n === 655.35 ? null : n);
const pick = (text, re) => text.match(re)?.[1] ?? null;

// "7h 1min", "46 min" → minuten
export function minutes(s) {
  if (!s) return null;
  const h = s.match(/(\d+)\s*h/), m = s.match(/(\d+)\s*min/);
  return h || m ? (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) : null;
}

// "21:16", "7:03:42" → seconden
export function seconds(s) {
  if (!s || !/^\d+(:\d+)+/.test(s.trim())) return null;
  return s.trim().split(/[^\d:]/)[0].split(':').reduce((t, p) => t * 60 + +p, 0);
}

export function sportGroup(code) {
  if ([100, 101, 102, 103].includes(code)) return 'lopen';
  if ([104, 105, 106, 900].includes(code)) return 'wandelen';
  if (code >= 200 && code < 300) return 'fietsen';
  if (code >= 300 && code < 400) return 'zwemmen';
  if (code === 402) return 'kracht';
  if (code === 10000) return 'triatlon';
  return 'andere';
}

// Blokken die beginnen met een datum aan het begin van een regel: { '2026-10-06': 'rest van het blok' }
function byDate(text) {
  const out = {};
  let date = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2}):?\s*(.*)$/);
    if (m) { date = m[1]; out[date] = m[2]; } else if (date) out[date] += '\n' + line;
  }
  return out;
}

// "Sleutel: waarde" per regel
function keyValues(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([^:=]+?):\s+(.+)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

export function parseSportRecords(text) {
  const total = num(pick(text, /\((\d+) records\)/));
  const activities = [];
  for (const block of text.split(/\n(?=\d+\. \S)/)) {
    const head = block.match(/^(\d+)\. (.+?) — (\d{4}-\d{2}-\d{2})/);
    const ids = block.match(/LabelId: (\d+) \| SportType: (\d+)/);
    if (!head || !ids) continue;
    const dist = block.match(/Distance: ([\d.]+) (km|m)\b/);
    const coords = block.match(/Start Coordinates: (-?[\d.]+), (-?[\d.]+)/);
    const sportType = +ids[2];
    const durationS = seconds(pick(block, /Duration: ([\d:]+)/));
    const distanceM = dist ? Math.round(+dist[1] * (dist[2] === 'km' ? 1000 : 1)) : null;
    activities.push({
      id: ids[1], sportType, sport: sportGroup(sportType), name: head[2], date: head[3],
      location: pick(block, /Location: (.+)/),
      lat: coords ? +coords[1] : null, lon: coords ? +coords[2] : null,
      start: num(pick(block, /startTimestamp=(\d+)/)), end: num(pick(block, /endTimestamp=(\d+)/)),
      durationS, distanceM,
      // Zelf berekend: COROS zet bij zwemmen "/km" bij een tempo dat per 100 m is.
      speedKmh: durationS && distanceM ? +(distanceM / durationS * 3.6).toFixed(2) : null,
      avgHr: num(pick(block, /Avg HR: (\d+)/)), calories: num(pick(block, /Calories: (\d+)/)),
    });
  }
  return { total, activities };
}

export function parseActivityDetail(text) {
  const kv = keyValues(text);
  const elev = (kv['Elevation Gain / Loss'] || '').match(/(-?\d+) m \/ (-?\d+) m/);
  const n = (k) => valid(num(kv[k]));
  return {
    durationS: seconds(kv['Workout Time']), elapsedS: seconds(kv['Total Time']),
    distanceKm: n('Distance'), avgHr: n('Average Heart Rate'), calories: n('Calories'),
    paceS: seconds(kv['Average Pace']), adjustedPaceS: seconds(kv['Adjusted Pace']), bestKmS: seconds(kv['Best Kilometer']),
    speedKmh: n('Average Speed'), maxSpeedKmh: n('Max Speed'),
    cadence: n('Average Cadence'), strideM: n('Average Stride Length'), power: n('Average Power'),
    elevGain: elev ? +elev[1] : null, elevLoss: elev ? +elev[2] : null,
    load: n('Training Load'), aerobicTE: n('Aerobic TE'), anaerobicTE: n('Anaerobic TE'),
    focus: kv['Training Focus'] || null, effort: kv['Perceived Effort'] || null,
    lengths: n('Lengths'), swolf: n('Average SWOLF'), strokeRate: n('Average Stroke Rate'), waterTemp: n('Water Temperature'),
    sets: n('Sets'),
  };
}

// Rondes komen wel als JSON. Eenheden: afstand in cm, snelheid in km/u × 100, tempo in s/km (zwemmen: s/100 m).
export function parseLaps(data) {
  const j = typeof data === 'string' ? JSON.parse(data) : data;
  return (j.lapGroups || []).map((g) => ({
    type: g.type, lapDistanceM: g.lapDistance / 100,
    laps: (g.laps || []).map(({ distance, avgSpeedV2, maxSpeed, ...lap }) => ({
      ...lap, distanceM: distance / 100,
      ...(avgSpeedV2 != null && { speedKmh: avgSpeedV2 / 100 }),
      ...(maxSpeed != null && { maxSpeedKmh: maxSpeed / 100 }),
    })),
  }));
}

export function parseFitness(text) {
  const kv = keyValues(text);
  return {
    vo2max: num(kv.VO2max), runningLevel: num(kv['Running Level']), thresholdPaceS: seconds(kv['Threshold Pace']),
    pred5k: seconds(kv['5 km Prediction']), pred10k: seconds(kv['10 km Prediction']),
    predHalf: seconds(kv['Half Marathon Prediction']), predMarathon: seconds(kv['Marathon Prediction']),
  };
}

export function parseRecovery(text) {
  const kv = keyValues(text);
  return { percent: num(kv.Recovery), level: kv.Level || null, hoursToFull: num(kv['Estimated Full Recovery']) };
}

export function parseUserInfo(text) {
  const kv = keyValues(text);
  return { heightCm: num(kv.Height), weightKg: num(kv.Weight), birthday: kv.Birthday?.slice(0, 10) || null, gender: kv.Gender || null };
}

// De onderstaande parsers geven { 'yyyy-mm-dd': {...} } terug, klaar om per dag samen te voegen.

export function parseRestingHr(text) {
  const out = {};
  for (const [date, rest] of Object.entries(byDate(text))) {
    const rhr = num(pick(rest, /^(\d+) bpm/));
    if (rhr) out[date] = { rhr };
  }
  return out;
}

export function parseAvgHr(text) {
  const out = {};
  for (const [date, rest] of Object.entries(byDate(text))) {
    const m = rest.match(/^(\d+) bpm(?: \(Min: (\d+), Max: (\d+)\))?/);
    if (m) out[date] = { hr: { avg: +m[1], min: num(m[2]), max: num(m[3]) } };
  }
  return out;
}

export function parseStress(text) {
  const out = {};
  for (const [date, rest] of Object.entries(byDate(text))) {
    const stress = num(pick(rest, /Average Stress: (\d+)/));
    if (stress != null) out[date] = { stress };
  }
  return out;
}

export function parseLoad(text) {
  const out = {};
  for (const [date, rest] of Object.entries(byDate(text))) {
    const short = num(pick(rest, /Short-Term Load: ([\d.]+)/));
    if (short == null) continue;
    out[date] = { load: {
      short, long: num(pick(rest, /Long-Term Load: ([\d.]+)/)), ratio: num(pick(rest, /Load Ratio: ([\d.]+)/)),
      comment: pick(rest, /Comment: (.+)/),
    } };
  }
  return out;
}

export function parseSleep(text) {
  const out = {};
  for (const [date, rest] of Object.entries(byDate(text))) {
    const win = rest.match(/Main Sleep Window: (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) - (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
    const pct = (k) => num(pick(rest, new RegExp(`${k} Ratio: (\\d+)%`)));
    const sleep = {
      score: valid(num(pick(rest, /Sleep Score: (-?\d+)/))),
      totalMin: minutes(pick(rest, /^Daily Sleep: (.+)$/m)),
      mainMin: minutes(pick(rest, /^Main Sleep(?: \(asleep\))?: (.+)$/m)),
      deepPct: pct('Deep Sleep'), lightPct: pct('Light Sleep'), remPct: pct('REM'), awakePct: pct('Awake'),
      awakeMin: minutes(pick(rest, /^Awake Time: (.+)$/m)), awakeCount: num(pick(rest, /Awake Count[^:]*: (\d+)/)),
      start: win?.[1] || null, end: win?.[2] || null,
      napMin: minutes(pick(rest, /^Naps Total(?: \(asleep\))?: ([^(\n]+)/m)),
    };
    if (sleep.totalMin == null) sleep.totalMin = sleep.mainMin;
    if (sleep.totalMin != null) out[date] = { sleep };
  }
  return out;
}

export function parseDailyHealth(text) {
  const out = {};
  for (const block of text.split(/\n(?=--- \d{8} ---)/)) {
    const d = block.match(/^--- (\d{4})(\d{2})(\d{2}) ---/);
    if (!d) continue;
    const day = {
      steps: num(pick(block, /Steps: ([\d,]+)/)), calories: num(pick(block, /Calories: ([\d,]+)/)),
      exerciseMin: minutes(pick(block, /Exercise: ([^|\n]+)/)),
    };
    const stress = num(pick(block, /Stress: Avg (\d+)/));
    if (stress != null) day.stress = stress;
    const stage = (k) => minutes(pick(block, new RegExp(`${k}: ([^|\\n]+)`)));
    if (/Sleep Summary/.test(block)) {
      day.sleepStages = {
        inBedMin: stage('Total'), deepMin: stage('Deep'), lightMin: stage('Light'), remMin: stage('REM'), awakeMin: stage('Awake'),
        hrAvg: num(pick(block, /Sleep HR: Avg (\d+)/)), hrMin: num(pick(block, /Sleep HR:.*Min (\d+)/)), hrMax: num(pick(block, /Sleep HR:.*Max (\d+)/)),
      };
    }
    out[`${d[1]}-${d[2]}-${d[3]}`] = day;
  }
  return out;
}

// Het officiële nachtgemiddelde plus de spreiding van de losse metingen.
export function parseHrv(text) {
  const [assessment, series = ''] = text.split(/Sleep HRV Time Series/);
  const out = {};
  for (const [date, rest] of Object.entries(byDate(assessment))) {
    const m = rest.match(/HRV Avg: (\d+) ms(?: — (.+))?/);
    const range = rest.match(/Normal Range: (\d+) - (\d+)/);
    if (m) out[date] = { hrv: { avg: +m[1], status: m[2] || null, low: num(range?.[1]), high: num(range?.[2]), baseline: num(pick(rest, /Baseline: (\d+)/)) } };
  }
  for (const [date, rest] of Object.entries(byDate(series))) {
    const values = [...rest.matchAll(/hrv=(\d+)/g)].map((m) => +m[1]);
    if (out[date] && values.length) Object.assign(out[date].hrv, { samples: values.length, min: Math.min(...values), max: Math.max(...values) });
  }
  return out;
}
