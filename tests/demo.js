// Verzonnen data voor ?demo: zelfde vorm als wat de synchronisatie opslaat, maar niets hiervan is echt.
import { isoDate, addDays } from '../js/stats.js';

export function demo() {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const between = (a, b) => a + rnd() * (b - a);
  const today = isoDate();
  const activities = [], days = [];

  for (let i = 420; i >= 0; i--) {
    const date = addDays(today, -i);
    const phase = Math.sin(i / 40);
    const hrv = Math.round(42 + phase * 4 + between(-7, 7));
    const deep = between(50, 100), rem = between(60, 110), light = between(180, 280);
    days.push({
      date, calories: Math.round(between(300, 800)), sleepStages: { deepMin: deep, remMin: rem, lightMin: light, awakeMin: 20 },
      ...(i < 21 && { food: { water: Math.round(between(2, 8)), koffie: Math.round(between(1, 5)), frisdrank: Math.round(between(0, 2)), alcohol: rnd() < 0.4 ? Math.round(between(1, 4)) : 0, groenten: Math.round(between(0, 3)), fruit: Math.round(between(0, 3)), gekookt: 1, brood: 1, fastfood: rnd() < 0.2 ? 1 : 0, snacks: Math.round(between(0, 2)) } }),
      ...(i < 60 && i % 3 === 0 && { weight: +(78.5 - (60 - i) * 0.02 + between(-0.4, 0.4)).toFixed(1) }),
      steps: Math.round(between(2500, 11000)), rhr: Math.round(53 + phase * 2 + between(-3, 3)), stress: Math.round(between(22, 48)),
      sleep: rnd() < 0.04 ? undefined : { score: Math.round(between(55, 92)), totalMin: Math.round(between(330, 510)), mainMin: 420, napMin: 0, start: `${addDays(date, -1)} ${rnd() < 0.7 ? '23' : '22'}:${String(Math.floor(between(0, 59))).padStart(2, '0')}` },
      hrv: rnd() < 0.08 ? undefined : { avg: hrv, low: 34, high: 48, baseline: 41, status: hrv < 34 ? 'Low' : hrv > 48 ? 'Above normal' : 'Normal' },
    });
    // Drukke en rustige periodes wisselen elkaar af; de laatste weken zijn rustig.
    const busy = i < 30 ? 0.12 : 0.28 + 0.22 * Math.sin(i / 25);
    if (rnd() > busy) continue;
    const pick = rnd();
    const sport = pick < 0.55 ? 'lopen' : pick < 0.8 ? 'fietsen' : pick < 0.93 ? 'zwemmen' : 'wandelen';
    const durationS = Math.round({ lopen: between(1500, 4200), fietsen: between(3000, 9000), zwemmen: between(1500, 2700), wandelen: between(3600, 12000) }[sport]);
    const speed = { lopen: between(8.4, 10.2), fietsen: between(23, 28), zwemmen: between(2, 2.6), wandelen: between(3, 4.5) }[sport];
    activities.push({
      id: String(1000 + i), sportType: { lopen: 100, fietsen: 200, zwemmen: 300, wandelen: 104 }[sport], sport, name: sport, date,
      start: Date.parse(date + 'T18:00:00') / 1000, durationS, distanceM: Math.round(speed * durationS / 3.6),
      avgHr: Math.round(between(128, 162)), detail: { load: Math.round(durationS / 60 * between(1.2, 2.6)), aerobicTE: +between(1.5, 4.2).toFixed(1), anaerobicTE: +between(0, 2).toFixed(1), cadence: Math.round(between(152, 172)), elevGain: Math.round(between(5, 80)) },
      laps: sport === 'lopen' || sport === 'fietsen' ? [{ type: 2, lapDistanceM: 1000, laps: Array.from({ length: Math.floor(speed * durationS / 3600) }, () => ({ distanceM: 1000, time: 3600 / speed * between(0.94, 1.06), avgHr: Math.round(between(125, 172)), avgCadence: 160, elevGain: Math.round(between(0, 8)), speedKmh: speed * between(0.94, 1.06) })) }] : [],
    });
  }
  for (const [i, km, h] of [[300, 25.75, 1.6], [150, 51.5, 3.1], [30, 113.4, 7.05]]) {
    const date = addDays(today, -i);
    activities.push({ id: `tri${i}`, sportType: 10000, sport: 'triatlon', name: 'Triatlon', date, start: Date.parse(date + 'T08:00:00') / 1000, durationS: h * 3600, distanceM: km * 1000, avgHr: 158, detail: { load: 400 } });
  }
  for (const a of activities) if (a.sport === 'zwemmen') a.detail.paceS = Math.round(a.durationS / (a.distanceM / 100) * 0.7);
  return { activities, days, meta: { weekGoal: 3, goal: { kind: 'race', race: '10k', date: addDays(today, 68) }, fitness: { vo2max: 50, pred5k: 1731 }, profile: { heightCm: 180, weightKg: 77, birthday: '1998-09-10', gender: 'Male' }, recovery: { percent: 88, level: 'Moderate training recommended', hoursToFull: 13 } } };
}
