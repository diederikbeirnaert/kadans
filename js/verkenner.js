// Fase 1: koppelen met COROS en verkennen wat elke tool precies teruggeeft.
import { disconnect, isConnected, listTools, callTool } from './coros.js';

const app = document.getElementById('app');
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter((k) => k != null));
  return n;
};
// Alles wat iets aanmaakt of wijzigt in je COROS-account vraagt eerst bevestiging.
const WRITES = /^(create|update|schedule|delete|remove)/i;
const report = { gemaakt: new Date().toISOString(), tools: [], antwoorden: {} };

function download(name, data) {
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: name });
  a.click();
  URL.revokeObjectURL(a.href);
}

function example(schema) {
  const out = {};
  for (const [k, p] of Object.entries(schema?.properties || {})) {
    if (!(schema.required || []).includes(k)) continue;
    out[k] = p.default ?? p.example ?? (p.enum ? p.enum[0] : { number: 0, integer: 0, boolean: false, array: [], object: {} }[p.type] ?? '');
  }
  return JSON.stringify(out, null, 2);
}

function toolCard(tool) {
  const write = WRITES.test(tool.name);
  const args = el('textarea', { value: example(tool.inputSchema), rows: 4, spellcheck: false });
  const out = el('pre', { className: 'out', hidden: true });
  const run = el('button', { className: 'btn small', textContent: 'Uitvoeren' });
  run.onclick = async () => {
    let parsed;
    try { parsed = JSON.parse(args.value || '{}'); } catch { out.hidden = false; out.textContent = 'De argumenten zijn geen geldige JSON.'; return; }
    if (write && !confirm(`"${tool.name}" wijzigt iets in je COROS-account. Doorgaan?`)) return;
    run.disabled = true; out.hidden = false; out.textContent = 'Bezig…';
    const t0 = performance.now();
    try {
      const { data } = await callTool(tool.name, parsed);
      report.antwoorden[tool.name] = { argumenten: parsed, antwoord: data };
      const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      out.textContent = `${Math.round(performance.now() - t0)} ms · ${text.length.toLocaleString('nl-BE')} tekens\n\n${text}`;
    } catch (e) { out.textContent = 'Fout: ' + e.message; }
    run.disabled = false;
  };
  return el('details', { className: 'card tool' },
    el('summary', {}, el('span', { className: 'name', textContent: tool.name }), write ? el('span', { className: 'tag', textContent: 'schrijft' }) : null),
    el('p', { className: 'muted', textContent: tool.description || '' }),
    el('label', { textContent: 'Argumenten (JSON)' }), args,
    el('details', { className: 'schema' }, el('summary', { textContent: 'Schema' }), el('pre', { textContent: JSON.stringify(tool.inputSchema, null, 2) })),
    run, out);
}

// --- Proefsync: roept alle leestools zelf aan en meet hoe ver de historiek teruggaat. ---

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const ago = (days) => ymd(new Date(Date.now() - days * 864e5));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Lange antwoorden worden ingekort; het formaat en het datumbereik blijven wel zichtbaar.
function summarize(data, full) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const dates = [...new Set(text.match(/\b20\d{2}-\d{2}-\d{2}\b/g) || [])].sort();
  const s = { tekens: text.length, datums: dates.length ? { eerste: dates[0], laatste: dates.at(-1), aantal: dates.length } : null };
  if (full || text.length <= 4000) s.antwoord = text.slice(0, 30000);
  else { s.begin = text.slice(0, 3000); s.einde = text.slice(-800); }
  return s;
}

async function proefsync(log) {
  const out = {};
  const step = async (key, tool, args = {}, full = false) => {
    log(key);
    const t0 = performance.now();
    try {
      const { data, raw } = await callTool(tool, args);
      out[key] = { tool, argumenten: args, ms: Math.round(performance.now() - t0), ...summarize(data, full) };
      await wait(250);
      return { text: typeof data === 'string' ? data : JSON.stringify(data), raw };
    } catch (e) {
      out[key] = { tool, argumenten: args, fout: e.message };
      return null;
    }
  };
  const today = ymd(new Date());

  for (const t of ['queryUserInfo', 'queryDevices', 'queryFitnessAssessmentOverview', 'queryRecoveryStatus', 'queryTrainingSchedule']) await step(t, t, {}, true);
  await step('queryTrainingPlanLibrary', 'queryTrainingPlanLibrary', { statusList: [0, 1, 2] }, true);
  for (const t of ['queryTrainingLoadAssessment', 'queryDailyHealthData', 'queryRestingHeartRate', 'queryStressLevel']) {
    await step(`${t} · 7 dagen`, t, { days: 7 }, true);
    await step(`${t} · 365 dagen`, t, { days: 365 });
  }
  await step('queryAvgHeartRate · 1 jaar', 'queryAvgHeartRate', { startDate: ago(365), endDate: today });
  await step('querySleepOverview · 90 dagen', 'querySleepOverview', { startDate: ago(90), endDate: today });
  await step('querySleepOverview · 2 jaar geleden', 'querySleepOverview', { startDate: ago(760), endDate: ago(730) });
  await step('querySleepHrv · 30 dagen', 'querySleepHrv', { startDate: ago(30), endDate: today, days: 0 });
  await step('querySleepHrv · 1 jaar geleden', 'querySleepHrv', { startDate: ago(372), endDate: ago(365), days: 0 });
  await step('queryHealthCheckTimeSeries · 7 dagen', 'queryHealthCheckTimeSeries', { startDate: ago(7), endDate: today, days: 7 });
  await step('queryStressTimeSeries · 1 dag', 'queryStressTimeSeries', { startDate: ago(1), endDate: today, days: 1 });

  // Activiteiten per jaar: toont hoe ver de historiek gaat en of er een maximum per oproep is.
  const picks = {};
  let empty = 0;
  for (let y = new Date().getFullYear(); y >= 2018 && empty < 2; y--) {
    const key = `querySportRecords · ${y}`;
    const r = await step(key, 'querySportRecords', {
      startDate: `${y}0101`, endDate: y === new Date().getFullYear() ? today : `${y}1231`, sportTypeCodes: [],
      minDistanceKm: 0, maxDistanceKm: 0, minDurationMinutes: 0, maxDurationMinutes: 0, maxAveragePace: '', locationKeyword: '', limit: 200,
    });
    const ids = [...(r?.text || '').matchAll(/LabelId: (\d+) \| SportType: (\d+)/g)];
    if (out[key]) out[key].aantalActiviteiten = ids.length;
    empty = ids.length ? 0 : empty + 1;
    for (const [, labelId, sport] of ids) {
      const group = { 1: 'lopen', 2: 'fietsen', 3: 'zwemmen', 4: 'kracht' }[Math.floor(sport / 100)] || 'andere';
      picks[group] ||= { labelId, sportType: +sport };
    }
  }

  for (const [group, a] of Object.entries(picks)) {
    await step(`getActivityDetail · ${group}`, 'getActivityDetail', a, true);
    await step(`queryActivityLapData · ${group}`, 'queryActivityLapData', a, true);
  }

  // FIT-bestanden: twee oproepen (van de 50 per dag) om te zien welke weg in de browser werkt.
  const first = picks.lopen || Object.values(picks)[0];
  if (first) {
    const urls = await step('FIT · download-URL', 'queryActivityFitFileDownloadUrls', first, true);
    const url = urls?.text.match(/https?:\/\/[^\s"')]+/)?.[0];
    if (url) {
      log('FIT · bestand ophalen');
      try {
        const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
        out['FIT · bestand ophalen'] = { host: new URL(url).host, bytes: buf.length, isFit: String.fromCharCode(...buf.slice(8, 12)) === '.FIT' };
      } catch (e) {
        out['FIT · bestand ophalen'] = { host: new URL(url).host, fout: e.message };
      }
      delete out['FIT · download-URL'].antwoord;
    }
    const bin = await step('FIT · binair', 'downloadActivityFitFiles', first);
    if (bin) {
      out['FIT · binair'] = {
        inhoud: (bin.raw.content || []).map((c) => ({
          type: c.type, mimeType: c.resource?.mimeType || c.mimeType, uri: c.resource?.uri,
          blobTekens: (c.resource?.blob || c.data || '').length, tekst: c.text?.slice(0, 500),
        })),
      };
    }
  }
  return { gemaakt: new Date().toISOString(), stappen: out };
}

async function showTools() {
  const list = el('div', { className: 'list' }, el('p', { className: 'muted', textContent: 'Tools ophalen…' }));
  const filter = el('input', { type: 'search', placeholder: 'Zoek een tool…' });
  const save = el('button', { className: 'btn small ghost', textContent: 'Rapport downloaden' });
  save.onclick = () => download('kadans-coros-rapport.json', report);
  const out = el('button', { className: 'btn small ghost', textContent: 'Ontkoppelen' });
  out.onclick = () => { disconnect(); location.href = './'; };
  const status = el('p', { className: 'muted', hidden: true });
  const probe = el('button', { className: 'btn small', textContent: 'Proefsync' });
  probe.onclick = async () => {
    probe.disabled = true; status.hidden = false;
    let n = 0;
    try {
      const result = await proefsync((key) => { status.textContent = `Proefsync, stap ${++n}: ${key}`; });
      download('kadans-proefsync.json', result);
      status.textContent = `Proefsync klaar (${n} stappen). Het bestand kadans-proefsync.json is gedownload.`;
    } catch (e) { status.textContent = 'Proefsync mislukt: ' + e.message; }
    probe.disabled = false;
  };
  app.replaceChildren(
    el('header', {}, el('h1', { textContent: 'Kadans' }), el('p', { className: 'muted', textContent: 'Gekoppeld met COROS. Hieronder staat alles wat COROS aanbiedt.' })),
    el('div', { className: 'bar' }, filter, probe, save, out), status, list);
  try {
    const tools = (await listTools()).sort((a, b) => a.name.localeCompare(b.name));
    report.tools = tools;
    const cards = tools.map((t) => [t, toolCard(t)]);
    list.replaceChildren(el('p', { className: 'muted', textContent: `${tools.length} tools` }), ...cards.map(([, c]) => c));
    filter.oninput = () => {
      const q = filter.value.toLowerCase();
      for (const [t, c] of cards) c.hidden = !(t.name + ' ' + (t.description || '')).toLowerCase().includes(q);
    };
  } catch (e) {
    list.replaceChildren(el('p', { className: 'error', textContent: e.message }));
  }
}

if (isConnected()) showTools();
else app.replaceChildren(el('p', {}, 'Nog niet gekoppeld. ', el('a', { href: './', textContent: 'Koppel eerst met COROS.' })));
