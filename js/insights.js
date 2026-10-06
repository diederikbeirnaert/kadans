// Opvallend vandaag: korte, feitelijke vaststellingen uit je data, op vaste regels. Geen DOM en geen opslag.
import * as st from './stats.js';
import * as ph from './physio.js';

const clock = (sec) => {
  const t = Math.round(sec), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

// Geeft hoogstens `max` vaststellingen terug: { tone, text, href }, belangrijkste eerst.
export function insights({ activities, days, meta }, max = 5, today = st.isoDate()) {
  const out = [];
  const add = (tone, text, href) => out.push({ tone, text, href });
  const goal = meta.weekGoal || 3;
  const day = days.find((d) => d.date === today);

  const load = st.loadSeries(activities, 60, today);
  const cur = load.at(-1), before = load.at(-29);
  const ratio = cur?.fitness > 1 ? cur.fatigue / cur.fitness : null;
  if (ratio > 1.5) add('bad', 'Je deed deze week veel meer dan je gewend bent. Neem vandaag rust of houd het licht.', '#training');
  else if (ratio > 1.3) add('poor', 'Je belasting ligt hoger dan je gewend bent. Wissel af met een rustige dag.', '#training');

  if (day?.hrv?.avg != null && day.hrv.low != null && day.hrv.avg < day.hrv.low) add('poor', `Je HRV lag vannacht op ${day.hrv.avg} ms, onder je normale bereik (${day.hrv.low}–${day.hrv.high}).`, '#herstel');
  const rhr = days.filter((d) => d.rhr && d.date < today && d.date >= st.addDays(today, -30)).map((d) => d.rhr);
  if (day?.rhr && rhr.length >= 7 && day.rhr >= st.mean(rhr) + 5) add('poor', `Je rusthartslag is ${day.rhr}, ${Math.round(day.rhr - st.mean(rhr))} slagen hoger dan normaal. Dat wijst vaak op vermoeidheid of een beginnende ziekte.`, '#herstel');

  if (day?.sleep?.totalMin != null && day.sleep.totalMin < 360) add('poor', `Je sliep vannacht ${Math.floor(day.sleep.totalMin / 60)}u${String(Math.round(day.sleep.totalMin % 60)).padStart(2, '0')}. Houd een zware training vandaag liever licht.`, '#herstel');
  const nights = st.daySeries(days, 7, (d) => d.sleep?.totalMin, today).filter((p) => p.v != null);
  const sleepAvg = st.mean(nights.map((p) => p.v));
  if (nights.length >= 4 && sleepAvg < 390) add('poor', `Je sliep de laatste week gemiddeld ${Math.floor(sleepAvg / 60)}u${String(Math.round(sleepAvg % 60)).padStart(2, '0')} per nacht. Onder 7 uur herstel je trager van training.`, '#herstel');

  const week = st.weeks(activities, 1, today)[0];
  const left = goal - week.sessions, daysLeft = 7 - ((new Date(today + 'T12:00:00').getDay() + 6) % 7);
  const run = st.streak(st.weeks(activities, undefined, today), goal);
  if (left > 0 && left <= daysLeft && daysLeft <= 3) add('fair', `Nog ${left} ${left === 1 ? 'sessie' : 'sessies'} in ${daysLeft} ${daysLeft === 1 ? 'dag' : 'dagen'} om je weekdoel te halen${run.current ? ` en je reeks van ${run.current} ${run.current === 1 ? 'week' : 'weken'} te verlengen` : ''}.`, '#schema');
  else if (left <= 0) add('good', `Weekdoel gehaald: ${week.sessions} ${week.sessions === 1 ? 'sessie' : 'sessies'} deze week.`, '#training');

  const last = activities.filter(st.isSession).reduce((max, a) => (a.date > max ? a.date : max), '');
  const idle = last ? Math.round((Date.parse(today) - Date.parse(last)) / st.DAY) : null;
  if (idle >= 5) add('fair', `Je laatste training was ${idle} dagen geleden.${cur && before && cur.fitness < before.fitness - 1 ? ` Je fitheid zakte in 4 weken van ${Math.round(before.fitness)} naar ${Math.round(cur.fitness)}; één sessie keert die lijn om.` : ''}`, '#progressie');

  const since = st.addDays(today, -14);
  const fresh = [['lopen', ph.DISTANCES], ['fietsen', ph.BIKE_DISTANCES], ['zwemmen', ph.SWIM_DISTANCES]]
    .flatMap(([sport, dist]) => ph.efforts(activities, sport, dist).filter((e) => e.date >= since).map((e) => ({ ...e, sport })));
  if (fresh.length) add('top', `Nieuw record bij het ${fresh[0].sport}: ${fresh[0].label} in ${clock(fresh[0].timeS)}${fresh.length > 1 ? `, en nog ${fresh.length - 1} ${fresh.length === 2 ? 'ander record' : 'andere records'}` : ''}.`, '#progressie');

  const near = st.milestones(activities).filter((m) => !m.date && m.target && m.done / m.target >= 0.85).sort((a, b) => b.done / b.target - a.done / a.target)[0];
  if (near) add('good', `Nog ${Math.ceil(near.target - near.done).toLocaleString('nl-BE')} ${near.unit} tot de mijlpaal "${near.title}".`, '#progressie');

  const loggedLately = days.some((d) => d.food && d.date >= st.addDays(today, -7) && d.date < today);
  if (loggedLately && !day?.food) add('fair', 'Je hebt vandaag nog niets gelogd bij Voeding.', '#voeding');

  return out.slice(0, max);
}
