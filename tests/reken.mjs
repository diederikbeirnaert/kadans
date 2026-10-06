// Controleert de rekenlaag: `node tests/reken.mjs`
import assert from 'node:assert/strict';
import * as ph from '../js/physio.js';
import * as pl from '../js/plan.js';
import { demo } from './demo.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);
near(ph.vdot(5000, 19 * 60 + 57), 50, 0.3);          // tabel van Daniels: VDOT 50 = 19:57 op de 5 km
near(ph.vdot(42195, 3 * 3600 + 10 * 60 + 49), 50, 0.3); // en 3:10:49 op de marathon
near(ph.vdot(5000, 28 * 60 + 51), 32.3, 0.6);

const z = ph.DEFAULT_ZONES;
const run = { sport: 'lopen', sportType: 100, durationS: 1276, distanceM: 3130, avgHr: 163, date: '2026-10-06' };
near(ph.vo2maxFromRun(run, z), 38.8, 0.6);
near(ph.paceAtHr(run, z, 163), 1276 / 3.13, 1);       // bij de eigen hartslag komt het eigen tempo terug
assert.ok(ph.paceAtHr(run, z, 150) > 1276 / 3.13);
assert.equal(ph.zoneRange(z, 2), '134–150');
assert.equal(ph.zoneRange(z, 4), '159–170');

const laps = [{ type: 2, lapDistanceM: 1000, laps: [400, 380, 360, 390, 420, 300].map((time, i) => ({ time, distanceM: i === 5 ? 700 : 1000 })) }];
const best = ph.bestEfforts([{ sport: 'lopen', date: '2026-01-01', id: 'a', durationS: 2250, distanceM: 5700, laps }]);
assert.equal(best[0].timeS, 360);
assert.equal(best[1].timeS, 1950);
assert.equal(best[2].timeS, undefined);

const { activities } = demo();
const today = '2026-10-06';
for (const [goal, n] of [
  [{ kind: 'general', focus: 'regelmaat', sports: ['lopen'] }, 3],
  [{ kind: 'general', focus: 'sneller', sports: ['lopen', 'fietsen', 'zwemmen'] }, 4],
  [{ kind: 'race', race: '10k', date: '2026-12-13' }, 3],
  [{ kind: 'race', race: 'marathon', date: '2026-11-08' }, 4],
  [{ kind: 'race', race: 'tri-703', date: '2027-03-21' }, 5],
  [{ kind: 'race', race: '5k', date: '2026-10-10' }, 2],
  [{ kind: 'race', race: 'tri-sprint', date: '2026-12-20' }, 1],
]) {
  const plan = pl.generate(goal, { n, activities: [], previous: null }, today);
  const mins = plan.weeks.map((w) => w.minutes);
  for (const w of plan.weeks) {
    assert.ok(w.sessions.length <= n + 1 && w.sessions.every((s) => s.title && s.date >= w.start && s.date <= '2027-12-31'), JSON.stringify(w));
    for (const s of w.sessions.filter(pl.canPush)) {
      const c = pl.toCourse(s);
      const flat = c.sections.flatMap((x) => (x.intervalGroup ? x.sets : [x]));
      assert.ok(flat.every((x) => x.targetValue > 0 && x.sectionIntensity >= 1 && x.sectionIntensity <= 6 && x.sectionType));
      near(flat.reduce((t, x) => t + x.targetValue, 0) / 60 + c.sections.filter((x) => x.intervalGroup).reduce((t, g) => t + (g.repeats - 1) * g.sets.reduce((u, x) => u + x.targetValue, 0), 0) / 60, s.minutes, 0.01);
    }
  }
  for (let i = 1; i < mins.length; i++) assert.ok(mins[i] <= Math.max(...mins.slice(Math.max(0, i - 2), i)) * 1.2 + 5 * n, `te snelle groei: ${mins}`);
  console.log(pl.goalLabel(goal).padEnd(24), `${n}×/week`, '| weken:', plan.weeks.length, '| minuten:', mins.join(' '), plan.warning ? '| ⚠' : '');
}
const g = { kind: 'race', race: '10k', date: '2026-12-13' };
const p1 = pl.generate(g, { n: 3, activities, previous: null }, today);
p1.weeks[1].sessions[0].pushed = '123';
const p2 = pl.generate(g, { n: 3, activities, previous: p1 }, '2026-10-13');
assert.equal(p2.weeks[0].sessions[0].pushed, '123');
assert.equal(p2.start, '2026-10-12');
console.log('Rekenlaag in orde.');
