// Haalt alles op bij COROS en bewaart het lokaal. De eerste keer de volledige historiek,
// daarna alleen wat nieuw is sinds de vorige synchronisatie (met een paar dagen overlap).
import { callTool } from './coros.js';
import * as p from './parse.js';
import * as store from './store.js';

const DAY = 864e5;
const LIMIT = 200;
const iso = (t) => new Date(t - new Date(t).getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const compact = (date) => date.replace(/-/g, '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(tool, args = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const { data } = await callTool(tool, args);
      await wait(150);
      return typeof data === 'string' ? data : JSON.stringify(data);
    } catch (e) {
      if (attempt || /gekoppeld|verlopen/.test(e.message)) throw e;
      await wait(2000);
    }
  }
}

async function activitiesBetween(start, end) {
  const { activities } = p.parseSportRecords(await ask('querySportRecords', {
    startDate: compact(start), endDate: compact(end), sportTypeCodes: [], minDistanceKm: 0, maxDistanceKm: 0,
    minDurationMinutes: 0, maxDurationMinutes: 0, maxAveragePace: '', locationKeyword: '', limit: LIMIT,
  }));
  if (activities.length < LIMIT || start === end) return activities;
  // Het maximum per oproep is bereikt: splits de periode in twee.
  const mid = Date.parse(start) + Math.floor((Date.parse(end) - Date.parse(start)) / 2 / DAY) * DAY;
  return [...await activitiesBetween(start, iso(mid)), ...await activitiesBetween(iso(mid + DAY), end)];
}

// Loopt in blokken terug in de tijd tot er `maxEmpty` lege blokken na elkaar zijn of `floor` bereikt is.
async function backfill(since, floor, chunkDays, maxEmpty, fetch) {
  let end = Date.now(), empty = 0;
  const stop = Date.parse(since || floor);
  while (end >= stop && empty < maxEmpty) {
    const start = Math.max(stop, end - (chunkDays - 1) * DAY);
    const patches = await fetch(compact(iso(start)), compact(iso(end)));
    empty = Object.keys(patches).length ? 0 : empty + 1;
    await store.merge('days', patches);
    end = start - DAY;
  }
}

let running = null;
export function sync(onProgress = () => {}) {
  running ||= run(onProgress).finally(() => { running = null; });
  return running;
}

async function run(say) {
  const last = await store.getMeta('lastSync');
  const today = iso(Date.now());
  const since = last ? iso(Date.parse(last) - 3 * DAY) : null;
  const days = last ? Math.min(365, Math.ceil((Date.now() - Date.parse(last)) / DAY) + 3) : 365;

  say('Activiteiten ophalen…');
  const found = [];
  if (since) found.push(...await activitiesBetween(since, today));
  else {
    for (let y = new Date().getFullYear(), empty = 0; y >= 2015 && empty < 2; y--) {
      say(`Activiteiten ophalen… ${y}`);
      const list = await activitiesBetween(`${y}-01-01`, y === new Date().getFullYear() ? today : `${y}-12-31`);
      empty = list.length ? 0 : empty + 1;
      found.push(...list);
    }
  }
  await store.merge('activities', Object.fromEntries(found.map((a) => [a.id, a])));
  const activities = await store.all('activities');
  const first = activities.reduce((min, a) => (a.date < min ? a.date : min), today);
  const floor = iso(Date.parse(first) - 30 * DAY);

  say('Dagelijkse gezondheid ophalen…');
  await store.merge('days', p.parseDailyHealth(await ask('queryDailyHealthData', { days })));
  await store.merge('days', p.parseRestingHr(await ask('queryRestingHeartRate', { days })));
  await store.merge('days', p.parseStress(await ask('queryStressLevel', { days })));
  await store.merge('days', p.parseLoad(await ask('queryTrainingLoadAssessment', { days })));
  await backfill(since, floor, 365, 2, async (startDate, endDate) => p.parseAvgHr(await ask('queryAvgHeartRate', { startDate, endDate })));

  say('Slaap ophalen…');
  await backfill(since, floor, 90, 2, async (startDate, endDate) => p.parseSleep(await ask('querySleepOverview', { startDate, endDate })));
  say('HRV ophalen…');
  await backfill(since, floor, 30, 3, async (startDate, endDate) => p.parseHrv(await ask('querySleepHrv', { startDate, endDate, days: 0 })));

  say('Fitheid en herstel ophalen…');
  const fitness = p.parseFitness(await ask('queryFitnessAssessmentOverview'));
  const recovery = p.parseRecovery(await ask('queryRecoveryStatus'));
  await store.setMeta('profile', p.parseUserInfo(await ask('queryUserInfo')));
  await store.setMeta('fitness', fitness);
  await store.setMeta('recovery', { ...recovery, at: Date.now() });
  // COROS geeft alleen de waarde van vandaag; door ze per dag te bewaren bouwen we zelf een historiek op.
  await store.merge('days', { [today]: { corosFitness: fitness } });
  await store.setMeta('lastSync', new Date().toISOString());

  // Details en rondes: twee oproepen per activiteit, nieuwste eerst. Wat al opgehaald is, wordt overgeslagen.
  const todo = activities.filter((a) => !a.detail).sort((a, b) => b.start - a.start);
  let failed = 0;
  for (const [i, a] of todo.entries()) {
    say(`Details ophalen… ${i + 1} van ${todo.length}`);
    try {
      const ref = { labelId: a.id, sportType: a.sportType };
      const detail = p.parseActivityDetail(await ask('getActivityDetail', ref));
      let laps = [];
      try { laps = p.parseLaps(await ask('queryActivityLapData', ref)); } catch { /* niet elke sport heeft rondes */ }
      await store.merge('activities', { [a.id]: { detail, laps } });
    } catch (e) {
      if (/gekoppeld|verlopen/.test(e.message)) throw e;
      failed++;
    }
  }
  return { activities: activities.length, details: todo.length - failed, failed };
}
