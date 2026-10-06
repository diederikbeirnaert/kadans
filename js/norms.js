// Duiding: wat een cijfer betekent en hoe goed het is, volgens gepubliceerde richtwaarden.
// Elke schaal is een lijst banden { to, label, tone }; de laatste band heeft geen bovengrens.
// tone: bad | poor | fair | good | top (alleen voor de kleur; het label staat er altijd bij).
import { vdot } from './physio.js';

const bands = (limits, labels, tones) => labels.map((label, i) => ({ to: limits[i] ?? Infinity, label, tone: tones[i] }));
const UP = ['bad', 'poor', 'fair', 'good', 'good', 'top'];

export function rate(value, scale) {
  return value == null ? null : scale.find((b) => value < b.to) || scale.at(-1);
}

// VO2max naar leeftijd en geslacht: normtabel van het Cooper Institute (Heyward, 1998).
const VO2 = {
  Male: { 20: [33, 36.5, 42.5, 46.5, 52.5], 30: [31.5, 35.5, 41, 45, 49.5], 40: [30.2, 33.6, 39, 43.8, 48.1], 50: [26.1, 31, 35.8, 41, 45.4], 60: [20.5, 26.1, 32.3, 36.5, 44.3] },
  Female: { 20: [23.6, 29, 33, 37, 41.1], 30: [22.8, 27, 31.5, 35.7, 40.1], 40: [21, 24.5, 29, 32.9, 37], 50: [20.2, 22.8, 27, 31.5, 35.8], 60: [17.5, 20.2, 24.5, 30.3, 31.5] },
};
export function vo2Scale(profile = {}) {
  const age = profile.birthday ? Math.floor((Date.now() - Date.parse(profile.birthday)) / 31557600000) : 28;
  const decade = Math.min(60, Math.max(20, Math.floor(age / 10) * 10));
  const sex = profile.gender === 'Female' ? 'Female' : 'Male';
  return { scale: bands(VO2[sex][decade], ['Zeer laag', 'Laag', 'Matig', 'Goed', 'Zeer goed', 'Uitstekend'], UP), group: `${sex === 'Female' ? 'vrouwen' : 'mannen'} van ${decade}${decade === 60 ? '+' : `–${decade + 9}`} jaar` };
}

// Verhouding vermoeidheid/fitheid (acute:chronic workload ratio, Gabbett 2016).
export const ACWR = bands([0.8, 1.3, 1.5], ['Onderbelast', 'Optimaal', 'Verhoogd', 'Te veel'], ['fair', 'good', 'poor', 'bad']);
// Monotonie van de trainingsweek (Foster, 1998): gemiddelde dagbelasting gedeeld door de spreiding.
export const MONOTONY = bands([1.5, 2], ['Gevarieerd', 'Eentonig', 'Te eentonig'], ['good', 'fair', 'poor']);
// Rusthartslag bij volwassenen; onder 60 is typisch voor getrainde mensen.
export const RHR = bands([50, 60, 70, 80], ['Zeer laag (sportief)', 'Goed', 'Gemiddeld', 'Aan de hoge kant', 'Hoog'], ['top', 'good', 'fair', 'poor', 'bad']);
// Slaapduur in uren: aanbeveling voor volwassenen is 7 tot 9 uur (AASM/Sleep Research Society, 2015).
export const SLEEP_HOURS = bands([6, 7, 9], ['Te kort', 'Aan de korte kant', 'Aanbevolen', 'Lang'], ['bad', 'fair', 'good', 'fair']);
export const SLEEP_SCORE = bands([60, 75, 90], ['Zwak', 'Redelijk', 'Goed', 'Uitstekend'], ['poor', 'fair', 'good', 'top']);
// Spreiding van je bedtijd in minuten: onder een half uur is zeer regelmatig.
export const BEDTIME_SPREAD = bands([30, 60, 90], ['Zeer regelmatig', 'Redelijk regelmatig', 'Onregelmatig', 'Zeer onregelmatig'], ['top', 'good', 'poor', 'bad']);
// Stappen per dag (Tudor-Locke & Bassett, 2004).
export const STEPS = bands([5000, 7500, 10000, 12500], ['Zittend', 'Weinig actief', 'Redelijk actief', 'Actief', 'Zeer actief'], ['poor', 'fair', 'good', 'good', 'top']);
// Minuten beweging per week: de WHO raadt 150 tot 300 minuten matig intensief aan (2020).
export const WEEK_MINUTES = bands([75, 150, 300], ['Te weinig', 'Onder de richtlijn', 'Binnen de richtlijn', 'Boven de richtlijn'], ['bad', 'fair', 'good', 'top']);
// Trainingseffect per sessie (schaal van 0 tot 5, zoals COROS en Firstbeat die gebruiken).
export const TRAINING_EFFECT = bands([1, 2, 3, 4, 5], ['Geen effect', 'Licht', 'Onderhoudend', 'Verbeterend', 'Sterk verbeterend', 'Overbelastend'], ['fair', 'fair', 'good', 'good', 'top', 'poor']);
export const RECOVERY = bands([30, 60, 90], ['Uitgeput', 'Vermoeid', 'Goed hersteld', 'Volledig hersteld'], ['bad', 'fair', 'good', 'top']);
// BMI volgens de WHO.
export const BMI = bands([18.5, 25, 30], ['Ondergewicht', 'Gezond gewicht', 'Overgewicht', 'Obesitas'], ['poor', 'good', 'fair', 'bad']);
// Gewichtsverandering per week als percentage van je lichaamsgewicht (negatief = afvallen).
export const WEIGHT_PACE = bands([-1, -0.25, 0.25], ['Te snel', 'Gezond tempo', 'Stabiel', 'Aankomen'], ['poor', 'good', 'fair', 'fair']);

// HRV tegenover je eigen normale bereik van COROS.
export function rateHrv(hrv) {
  if (!hrv?.avg || hrv.low == null) return null;
  if (hrv.avg < hrv.low) return { label: 'Onder je normale bereik', tone: 'poor' };
  if (hrv.avg > hrv.high) return { label: 'Boven je normale bereik', tone: 'good' };
  return { label: 'Binnen je normale bereik', tone: 'good' };
}

// De tijd die bij een prestatie-index hoort op een afstand (omgekeerde van de formule van Daniels).
export function timeForVdot(v, distanceM) {
  let lo = distanceM / 8, hi = distanceM / 1.2;   // tussen 8 m/s en 1,2 m/s
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (vdot(distanceM, mid) > v) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export const EXPLAIN = {
  vo2max: 'VO2max is de maximale hoeveelheid zuurstof die je lichaam per minuut kan opnemen, per kilo lichaamsgewicht. Het is de beste maat voor je uithoudingsvermogen: hoe hoger, hoe langer en sneller je kunt volhouden.',
  vdot: 'De prestatie-index (VDOT van Jack Daniels) vertaalt je snelste tijden naar één getal. Anders dan VO2max telt hier ook mee hoe zuinig je loopt en hoe goed je een tempo kunt volhouden.',
  form: 'De verhouding tussen wat je deze week deed (vermoeidheid) en wat je gewend bent (fitheid). Rond 1 train je zoals je lichaam verwacht; ver daarboven stijgt het risico op blessures, ver daaronder verlies je conditie.',
  fitness: 'Fitheid is je gemiddelde trainingsbelasting per dag over de laatste 6 weken. Het getal zelf heeft geen norm: het telt alleen tegenover je eigen verleden. Stijgt het, dan bouw je op.',
  monotony: 'Monotonie meet hoe gelijk je dagen zijn. Elke dag hetzelfde doen is zwaarder voor je lichaam dan zware en lichte dagen afwisselen.',
  hrv: 'HRV (hartslagvariabiliteit) is de variatie in tijd tussen je hartslagen tijdens de slaap. Een hogere waarde betekent dat je zenuwstelsel ontspannen en hersteld is. Vergelijk alleen met jezelf: HRV verschilt sterk van persoon tot persoon.',
  rhr: 'Je rusthartslag is je laagste hartslag in rust. Hoe fitter je hart, hoe minder slagen het nodig heeft. Een plotse stijging van 5 slagen of meer wijst vaak op vermoeidheid, stress, alcohol of een beginnende ziekte.',
  sleep: 'Volwassenen hebben 7 tot 9 uur slaap nodig. Tijdens je slaap herstellen je spieren en verwerk je de training; structureel te weinig slapen remt je vooruitgang en verhoogt je blessurerisico.',
  bedtime: 'Elke dag rond hetzelfde uur gaan slapen houdt je biologische klok stabiel. Onregelmatige bedtijden hangen samen met slechtere slaap, ook als je genoeg uren haalt.',
  stages: 'Diepe slaap herstelt je lichaam, remslaap verwerkt wat je leerde en meemaakte. Typisch is 13 tot 23% diep en 20 tot 25% rem. Een horloge schat de fases; neem ze als richting, niet als exacte meting.',
  steps: 'Stappen meten hoe actief je bent buiten je trainingen. Vanaf 7.500 stappen per dag daalt het gezondheidsrisico duidelijk; 10.000 is een goede richtwaarde.',
  zones: 'Duursporters worden het snelst beter als ongeveer 80% van hun trainingstijd rustig is (zone 1 en 2) en 20% echt stevig (zone 4 en hoger). Veel tijd in het midden, zone 3, maakt moe zonder veel op te leveren.',
  recovery: 'Het herstelpercentage van COROS schat hoeveel je hersteld bent van je laatste trainingen. Onder 30% is rust het verstandigst.',
  te: 'Het trainingseffect zegt wat een sessie met je conditie deed, op een schaal van 0 tot 5. Aeroob gaat over uithouding, anaeroob over korte, harde inspanningen.',
};
