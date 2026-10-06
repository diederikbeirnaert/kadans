// Voeding zonder calorieën tellen: je tikt per dag aan hoeveel je van elk at of dronk.
// De richtwaarden komen uit de voedingsaanbevelingen van de Hoge Gezondheidsraad (2019),
// de WHO (suiker) en de EFSA (cafeïne). Geen DOM en geen opslag hier.
import { addDays, isoDate, mean } from './stats.js';

// kind: 'min' = minstens zoveel per dag, 'max' = hoogstens zoveel per dag, 'weekMax' = hoogstens zoveel per week.
export const ITEMS = [
  { key: 'water', label: 'Water', unit: 'glazen', kind: 'min', target: 6, why: 'Ongeveer 1,5 liter per dag, meer op trainingsdagen. Te weinig drinken geeft sneller vermoeidheid en hoofdpijn.' },
  { key: 'koffie', label: 'Koffie', unit: 'koppen', kind: 'max', target: 4, why: 'Tot ongeveer 400 mg cafeïne per dag (4 koppen) is veilig. Cafeïne blijft uren werken: koffie na de middag kan je slaap verstoren.' },
  { key: 'frisdrank', label: 'Frisdrank', unit: 'glazen', kind: 'max', target: 0, why: 'Eén glas bevat ongeveer 26 g suiker, de helft van wat de WHO per dag als maximum aanraadt. Vloeibare suiker verzadigt niet.' },
  { key: 'alcohol', label: 'Alcohol', unit: 'glazen', kind: 'weekMax', target: 10, why: 'Hoogstens 10 glazen per week, met enkele dagen zonder. Alcohol verstoort je diepe slaap en vertraagt het herstel na training.' },
  { key: 'groenten', label: 'Groenten', unit: 'porties', kind: 'min', target: 2, why: 'Minstens 300 g per dag, ongeveer 2 porties. Groenten vullen goed voor weinig energie en leveren vezels.' },
  { key: 'fruit', label: 'Fruit', unit: 'stuks', kind: 'min', target: 2, why: 'Ongeveer 250 g per dag, dus 2 stukken.' },
  { key: 'gekookt', label: 'Zelf gekookt', unit: 'maaltijden', kind: 'info', why: 'Wie zelf kookt, eet doorgaans meer groenten en minder zout, suiker en vet.' },
  { key: 'brood', label: 'Broodmaaltijd', unit: 'maaltijden', kind: 'info', why: 'Boterhammen met beleg. Volkoren brood verzadigt langer dan wit.' },
  { key: 'fastfood', label: 'Fastfood of afhaal', unit: 'porties', kind: 'weekMax', target: 1, why: 'Veel energie, zout en vet in weinig volume. Eén keer per week past in een gezond patroon.' },
  { key: 'snacks', label: 'Snacks en zoet', unit: 'porties', kind: 'max', target: 1, why: 'Koeken, chips, snoep, chocolade. Hoogstens één kleine portie per dag als extraatje.' },
];

const SLEEP_LINKS = [['alcohol', 1, 'alcohol dronk'], ['koffie', 3, '3 of meer koppen koffie dronk'], ['fastfood', 1, 'fastfood at']];

// Gemiddelden over de laatste `n` gelogde dagen binnen `window` dagen, met een oordeel per item.
export function summary(days, window = 30, today = isoDate()) {
  const since = addDays(today, -window + 1);
  const logged = days.filter((d) => d.food && d.date >= since && d.date <= today);
  return {
    days: logged.length,
    items: ITEMS.map((item) => {
      const avg = logged.length ? mean(logged.map((d) => d.food[item.key] || 0)) : null;
      const value = item.kind === 'weekMax' && avg != null ? avg * 7 : avg;
      let rating = null;
      if (value != null && item.kind !== 'info') {
        const ok = item.kind === 'min' ? value >= item.target : value <= item.target;
        const near = item.kind === 'min' ? value >= item.target * 0.7 : value <= item.target + (item.kind === 'weekMax' ? 3 : 1);
        rating = { tone: ok ? 'good' : near ? 'fair' : 'poor', label: ok ? 'Binnen de richtlijn' : item.kind === 'min' ? 'Te weinig' : 'Te veel' };
      }
      return { ...item, value, per: item.kind === 'weekMax' ? 'per week' : 'per dag', rating };
    }),
  };
}

// Vergelijkt je slaap na dagen mét en zonder iets (alcohol, veel koffie, fastfood). Minstens 4 dagen aan elke kant.
export function sleepLinks(days) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const out = [];
  for (const [key, threshold, text] of SLEEP_LINKS) {
    const withIt = [], without = [];
    for (const d of days) {
      if (!d.food) continue;
      const score = byDate.get(addDays(d.date, 1))?.sleep?.score;   // de nacht erna staat op de volgende dag
      if (score == null) continue;
      ((d.food[key] || 0) >= threshold ? withIt : without).push(score);
    }
    if (withIt.length >= 4 && without.length >= 4) out.push({ key, text, diff: mean(withIt) - mean(without), n: withIt.length });
  }
  return out;
}

// Rustverbruik volgens Mifflin-St Jeor (1990), in kcal per dag.
export function restingEnergy({ weightKg, heightCm, birthday, gender }) {
  if (!weightKg || !heightCm || !birthday) return null;
  const age = (Date.now() - Date.parse(birthday)) / 31557600000;
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (gender === 'Female' ? -161 : 5);
}

// Gewichtsverloop: voortschrijdend gemiddelde over 7 dagen en de verandering per week over de laatste 4 weken.
export function weightTrend(days, today = isoDate()) {
  const points = days.filter((d) => d.weight).map((d) => ({ date: d.date, kg: d.weight })).sort((a, b) => a.date.localeCompare(b.date));
  if (!points.length) return { points, latest: null, perWeek: null };
  const avgAt = (date) => mean(points.filter((p) => p.date <= date && p.date > addDays(date, -7)).map((p) => p.kg));
  const now = avgAt(today) ?? points.at(-1).kg, before = avgAt(addDays(today, -28));
  return { points, latest: points.at(-1).kg, average: now, perWeek: before != null ? (now - before) / 4 : null };
}
