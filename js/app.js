// Startpunt: inloggen, data laden, synchroniseren en tussen de schermen wisselen.
import { connect, handleRedirect, isConnected, callTool } from './coros.js';
import { generate, toCourse } from './plan.js';
import { isoDate, weekStart } from './stats.js';
import * as store from './store.js';
import * as views from './views.js';

const app = document.getElementById('app');
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter((k) => k != null));
  return n;
};

const ROUTES = [['', 'Vandaag', views.today], ['training', 'Training', views.training], ['progressie', 'Progressie', views.progress], ['schema', 'Schema', views.schema], ['herstel', 'Slaap en herstel', views.health], ['voeding', 'Voeding', views.food]];
// Met ?demo draait de app op verzonnen data, zonder login en zonder COROS. Handig om het ontwerp te bekijken.
const demo = new URLSearchParams(location.search).has('demo');
let data = { activities: [], days: [], meta: {} };
let fb = null;
const status = el('span', { className: 'status' });
const main = el('div');

async function load() {
  const [activities, days, meta] = await Promise.all([store.all('activities'), store.all('days'), store.all('meta')]);
  data = { activities, days, meta: Object.fromEntries(meta.map((m) => [m.key, m.value])) };
}

function render() {
  const hash = location.hash || '#';
  const detail = hash.startsWith('#activiteit/');
  const route = detail ? ROUTES[1] : ROUTES.find(([h]) => '#' + h === hash) || ROUTES[0];
  for (const a of document.querySelectorAll('nav a')) a.classList.toggle('on', a.hash === '#' + route[0] || (!route[0] && !a.hash));
  main.replaceChildren(detail ? views.activity(data, hash.slice(12)) : route[2](data, actions));
  if (hash !== shown) window.scrollTo(0, 0);
  shown = hash;
}
let shown = null;

async function setMeta(key, value) {
  data.meta[key] = value;
  if (!demo) await store.setMeta(key, value);
}

// Maakt een schema als er een doel is, en herberekent het bij een nieuw doel, een ander weekdoel of een nieuwe week.
async function ensurePlan(force = false) {
  const { goal, plan } = data.meta;
  if (!goal) return;
  const n = data.meta.weekGoal || 3, today = isoDate();
  if (!force && plan && plan.key === JSON.stringify([goal, n]) && plan.start === weekStart(today)) return;
  await setMeta('plan', generate(goal, { n, activities: data.activities, previous: plan || null }, today));
}

// Wacht even met versturen, zodat een reeks tikken (bijvoorbeeld in het voedingslogboek) één keer schrijft.
let pushTimer = null;
const cloudPush = () => {
  if (demo) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => fb.push().catch((e) => { status.textContent = e.message; }), 2500);
};

const actions = {
  render,
  async save(patches) {
    for (const [key, value] of Object.entries(patches)) await setMeta(key, value);
    await ensurePlan();
    render();
    cloudPush();
  },
  // Eigen invoer voor één dag (voeding, gewicht); COROS-data van die dag blijft staan.
  async saveDay(date, patch) {
    const row = data.days.find((d) => d.date === date);
    if (row) Object.assign(row, patch); else data.days.push({ date, ...patch });
    if (!demo) await store.merge('days', { [date]: patch });
    render();
    cloudPush();
  },
  async replan() {
    await ensurePlan(true);
    render();
    cloudPush();
  },
  // Zet trainingen in de COROS-agenda. Dit wijzigt je COROS-account, dus eerst bevestigen.
  async pushToWatch(sessions) {
    if (demo) return alert('In de demo wordt niets naar COROS gestuurd.');
    if (!isConnected()) return alert('Koppel dit toestel eerst met COROS (onderaan de pagina).');
    if (!confirm(`${sessions.length} ${sessions.length === 1 ? 'training' : 'trainingen'} in je COROS-agenda zetten?`)) return;
    const failed = [];
    for (const s of sessions) {
      try {
        const { data: answer } = await callTool('createScheduledWorkout', { date: s.date.replace(/-/g, ''), course: toCourse(s) });
        s.pushed = String(answer).match(/idInPlan\D*(\d+)/i)?.[1] || true;
      } catch (e) { failed.push(`${s.title} (${s.date}): ${e.message}`); }
    }
    await setMeta('plan', data.meta.plan);
    render();
    cloudPush();
    if (failed.length) alert('Niet gelukt:\n' + failed.join('\n'));
  },
};

function shell() {
  const link = (text, onclick) => Object.assign(el('button', { className: 'link', textContent: text }), { onclick });
  app.replaceChildren(
    el('div', { className: 'top' },
      el('div', { className: 'brand', textContent: 'Kadans' }),
      el('nav', {}, ...ROUTES.map(([hash, label]) => el('a', { href: '#' + hash, textContent: label })))),
    main,
    el('footer', {}, status,
      demo ? null : link('Synchroniseren', refresh),
      demo ? null : el('a', { className: 'link', href: 'verkenner.html', textContent: 'Verkenner' }),
      demo ? null : link('Uitloggen', () => fb.logout())));
  window.onhashchange = render;
  render();
}

let busy = false;
async function refresh() {
  if (busy) return;
  busy = true;
  const say = (text) => { status.textContent = text; };
  let cloud = true;
  try {
    say('Cloud ophalen…');
    try {
      if (await fb.pull()) { await load(); await ensurePlan(); render(); }
    } catch (e) { cloud = false; say(e.message); }

    if (isConnected()) {
      const { sync } = await import('./sync.js');
      const r = await sync(async (msg) => {
        say(msg);
        // Tijdens het ophalen van details af en toe hertekenen, zodat je de data ziet binnenkomen.
        if (/Details ophalen… \d*0 van/.test(msg)) { await load(); render(); }
      });
      await load(); await ensurePlan(); render();
      if (cloud) { say('Opslaan in de cloud…'); await fb.push(); }
      if (cloud) say(r.failed ? `Bijgewerkt. Van ${r.failed} activiteiten ontbreken de details.` : `Bijgewerkt om ${new Date().toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}.`);
    } else {
      if (cloud) say('COROS is op dit toestel niet gekoppeld; je ziet de data uit de cloud.');
      status.append(' ', Object.assign(el('button', { className: 'link', textContent: 'Koppel met COROS' }), { onclick: () => connect().catch((e) => say(e.message)) }));
    }
  } catch (e) {
    say('Synchroniseren mislukt: ' + e.message);
  }
  busy = false;
}

function showLogin(error) {
  const email = el('input', { type: 'email', placeholder: 'E-mailadres', autocomplete: 'username', required: true });
  const password = el('input', { type: 'password', placeholder: 'Wachtwoord', autocomplete: 'current-password', required: true });
  const msg = el('p', { className: 'error', textContent: error || '' });
  const submit = (action) => async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    msg.textContent = '';
    try { await fb[action](email.value.trim(), password.value); } catch (err) { msg.textContent = err.message; }
  };
  const form = el('form', { className: 'login' }, email, password,
    el('button', { className: 'btn', textContent: 'Inloggen' }),
    Object.assign(el('button', { className: 'link', type: 'button', textContent: 'Eerste keer? Maak een account aan' }), { onclick: submit('register') }),
    msg);
  form.onsubmit = submit('login');
  app.replaceChildren(el('div', { className: 'hero' },
    el('h1', { textContent: 'Kadans' }),
    el('p', { className: 'muted', textContent: 'Je training, slaap en gezondheid uit COROS, op één plek.' }),
    form));
}

async function start() {
  let note = '';
  try { await handleRedirect(); } catch (e) { note = e.message; }
  await load();
  await ensurePlan();
  shell();
  if (note) status.textContent = note;
  else refresh();
}

if (demo) {
  data = (await import('../tests/demo.js')).demo();
  await ensurePlan();
  shell();
  status.textContent = 'Demo met verzonnen data.';
} else {
  try {
    fb = await import('./fb.js');
    let started = false;
    fb.onUser((user) => {
      if (!user) { started = false; return showLogin(); }
      if (!started) { started = true; start(); }
    });
  } catch (e) {
    app.replaceChildren(el('p', { className: 'error', textContent: 'Firebase kon niet geladen worden: ' + e.message }));
  }
}
