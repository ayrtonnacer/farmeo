import {
  DEFAULT_CONFIG, parseConfig, renderConfig, parseClients, renderClients, resolveRate,
  parseEntries, renderMonth, monthPath, monthKey, buildEntry, parseActive, renderActive, sameEntry,
  totals, groupBy, dailySeries, rangeFor, inRange, gameState, xpForEntry, formatDuration,
  dateKey, addDays, parseDateKey, hours,
} from './model.js';
import {
  loadStorageSettings, saveStorageSettings, demoStorage, githubStorage,
  localFolderSupported, pickLocalFolder, restoreLocalFolder,
} from './storage.js';
import { setSound, unlockAudio, playCoins, playLevelUp, playAchievement, playAlarm, playStart } from './audio.js';

// ---------- estado ----------

const state = {
  settings: loadStorageSettings(),
  storage: null,
  cfg: { ...DEFAULT_CONFIG },
  book: { clients: [], projects: [] },
  entries: [],
  active: null,
  view: 'timer',
  period: 'semana',
  form: { tipo: 'corta', modo: 'cronometro' },
  pendingFolder: null,
  loadError: '',
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => dateKey(new Date());
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const LS = {
  get(k, d) { try { const v = localStorage.getItem(`tiempo-oro:${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`tiempo-oro:${k}`, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

// ---------- formato ----------

function money(amount, currency) {
  try {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 2, minimumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
const moneyList = (dinero) => Object.entries(dinero).sort((a, b) => b[1] - a[1]);
const hm = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
};
const dayLabel = (key) => {
  if (key === today()) return 'Hoy';
  if (key === addDays(today(), -1)) return 'Ayer';
  return parseDateKey(key).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'short' });
};

// ---------- cola de guardado ----------
// Cada cambio se guarda en orden. Si falla (sin internet, token vencido), queda pendiente y se reintenta.

let queue = LS.get('cola', []);
let flushing = false;

function enqueue(op) {
  queue.push(op);
  LS.set('cola', queue);
  flush();
}

async function runOp(op) {
  const s = state.storage;
  switch (op.type) {
    case 'append': {
      const path = monthPath(op.entry.fecha);
      return s.update(path, (text) => renderMonth(monthKey(op.entry.fecha), [...parseEntries(text || ''), op.entry]), op.msg);
    }
    case 'delete': {
      const path = monthPath(op.entry.fecha);
      return s.update(path, (text) => {
        const list = parseEntries(text || '');
        const i = list.findIndex((e) => sameEntry(e, op.entry));
        if (i >= 0) list.splice(i, 1);
        return renderMonth(monthKey(op.entry.fecha), list);
      }, op.msg);
    }
    case 'setActive': return s.update('activo.md', () => renderActive(op.active), op.msg);
    case 'clearActive': return s.update('activo.md', () => null, op.msg);
    case 'clients': return s.update('clientes.md', () => renderClients(op.book), op.msg);
    case 'config': return s.update('config.md', () => renderConfig(op.cfg), op.msg);
    default: return undefined;
  }
}

async function flush() {
  if (flushing || !state.storage) return;
  flushing = true;
  renderSync();
  try {
    while (queue.length) {
      await runOp(queue[0]);
      queue.shift();
      LS.set('cola', queue);
      renderSync();
    }
    state.syncError = '';
  } catch (err) {
    state.syncError = err.message || String(err);
  } finally {
    flushing = false;
    renderSync();
  }
}

function renderSync() {
  const el = $('#sync');
  if (state.loadError) {
    el.hidden = false;
    el.className = 'sync error';
    el.innerHTML = `<span>${esc(state.loadError)}</span><button type="button" data-act="go-settings">Revisar</button>`;
    return;
  }
  if (!queue.length) { el.hidden = true; return; }
  el.hidden = false;
  if (state.syncError && !flushing) {
    el.className = 'sync error';
    el.innerHTML = `<span>${queue.length} ${queue.length === 1 ? 'cambio sin guardar' : 'cambios sin guardar'}. ${esc(state.syncError)}</span><button type="button" data-act="retry">Reintentar</button>`;
  } else {
    el.className = 'sync';
    el.innerHTML = `<span>Guardando en ${esc(state.storage?.label || '')}…</span>`;
  }
}

$('#sync').addEventListener('click', (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (act === 'retry') flush();
  if (act === 'go-settings') showView('settings');
});

// ---------- carga ----------

async function connect() {
  const s = state.settings;
  state.loadError = '';
  state.pendingFolder = null;
  if (s.mode === 'github') {
    if (!s.owner || !s.repo || !s.token) { state.loadError = 'Falta configurar GitHub.'; state.storage = null; return; }
    state.storage = githubStorage(s);
  } else if (s.mode === 'local') {
    const r = await restoreLocalFolder();
    if (r.storage) state.storage = r.storage;
    else {
      state.storage = null;
      state.pendingFolder = r.handle || null;
      state.loadError = r.unsupported ? 'Este navegador no puede abrir carpetas. Usá Chrome o Edge en la compu, o el modo GitHub.' : r.needsPermission ? 'Volvé a darle permiso a la carpeta.' : 'Elegí la carpeta donde guardar los .md.';
    }
  } else {
    state.storage = demoStorage();
  }
}

async function loadAll() {
  if (!state.storage) { renderAll(); return; }
  try {
    const s = state.storage;
    const [cfgText, clientsText, activeText, files] = await Promise.all([s.read('config.md'), s.read('clientes.md'), s.read('activo.md'), s.list('registros')]);
    const months = await Promise.all(files.filter((f) => /^\d{4}-\d{2}\.md$/.test(f)).map((f) => s.read(`registros/${f}`)));
    state.cfg = parseConfig(cfgText || '');
    state.book = parseClients(clientsText || '');
    state.entries = months.flatMap((t) => parseEntries(t || ''));
    state.active = parseActive(activeText);

    if (clientsText === null && state.settings.mode === 'demo') {
      state.book = { clients: [{ nombre: 'Cliente demo', tarifa: 20, moneda: 'USD', color: '#F2C14E' }], projects: [] };
      enqueue({ type: 'clients', book: state.book, msg: 'Crea clientes.md' });
    }
    // cambios que todavía no llegaron a guardarse
    for (const op of queue) {
      if (op.type === 'append' && !state.entries.some((e) => sameEntry(e, op.entry))) state.entries.push(op.entry);
      if (op.type === 'delete') state.entries = state.entries.filter((e) => !sameEntry(e, op.entry));
      if (op.type === 'setActive') state.active = op.active;
      if (op.type === 'clearActive') state.active = null;
      if (op.type === 'clients') state.book = op.book;
      if (op.type === 'config') state.cfg = op.cfg;
    }
    state.loadError = '';
  } catch (err) {
    state.loadError = `No pude leer los datos: ${err.message || err}`;
  }
  setSound({ on: state.cfg.sonido === 'sí', vol: state.cfg.volumen / 100 });
  lastGame = gameState(state.entries, today());
  syncFormFromActive();
  renderAll();
  flush();
}

// ---------- formulario del timer ----------

const form = $('#task-form');
const f = {
  tarea: $('#f-tarea'), cliente: $('#f-cliente'), proyecto: $('#f-proyecto'),
  etiquetas: $('#f-etiquetas'), facturable: $('#f-facturable'), minutos: $('#f-minutos'),
};

function fillClientSelect(select, value) {
  select.innerHTML = `<option value="">Sin cliente</option>${state.book.clients.map((c) => `<option ${c.nombre === value ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}`;
  if (value && !state.book.clients.some((c) => c.nombre === value)) select.insertAdjacentHTML('beforeend', `<option selected>${esc(value)}</option>`);
}

function fillProjectSelect(select, client, value) {
  const list = state.book.projects.filter((p) => !p.cliente || !client || p.cliente === client);
  select.innerHTML = `<option value="">Sin proyecto</option>${list.map((p) => `<option ${p.nombre === value ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}`;
  if (value && !list.some((p) => p.nombre === value)) select.insertAdjacentHTML('beforeend', `<option selected>${esc(value)}</option>`);
}

function readForm() {
  return {
    tarea: f.tarea.value.trim(),
    cliente: f.cliente.value,
    proyecto: f.proyecto.value,
    etiquetas: f.etiquetas.value.split(',').map((t) => t.trim()).filter(Boolean),
    tipo: state.form.tipo,
    facturable: f.facturable.checked,
    modo: state.form.modo,
    minutos: Math.max(1, Math.min(600, Number(f.minutos.value) || state.cfg.temporizador_minutos)),
  };
}

function setSeg(id, value) {
  $$(`#${id} button`).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === value)));
}

function syncFormFromActive() {
  const a = state.active;
  if (a) {
    f.tarea.value = a.tarea;
    fillClientSelect(f.cliente, a.cliente);
    fillProjectSelect(f.proyecto, a.cliente, a.proyecto);
    f.etiquetas.value = a.etiquetas.join(', ');
    f.facturable.checked = a.facturable;
    f.minutos.value = a.minutos;
    state.form.tipo = a.tipo;
    state.form.modo = a.modo;
  } else {
    const keepClient = f.cliente.value;
    fillClientSelect(f.cliente, keepClient);
    fillProjectSelect(f.proyecto, f.cliente.value, f.proyecto.value);
    if (!f.minutos.dataset.touched) f.minutos.value = state.cfg.temporizador_minutos;
  }
  setSeg('seg-tipo', state.form.tipo);
  setSeg('seg-modo', state.form.modo);
  renderTimerControls();
  renderRateHint();
}

function renderRateHint() {
  const { tarifa, moneda } = resolveRate(state.book, f.cliente.value, f.proyecto.value, state.cfg.moneda_por_defecto);
  const el = $('#rate-hint');
  if (tarifa && f.facturable.checked) {
    el.className = 'rate';
    el.textContent = `${money(tarifa, moneda)} por hora`;
  } else {
    el.className = 'rate none';
    el.textContent = !f.facturable.checked ? 'No facturable: suma XP, no oro.' : f.cliente.value ? 'Este cliente no tiene tarifa. Cargala en Clientes.' : 'Sin cliente: suma XP, no oro.';
  }
}

function renderTagSuggest() {
  const used = new Set(f.etiquetas.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean));
  const counts = new Map();
  for (const e of state.entries.slice(-200)) for (const t of e.etiquetas) counts.set(t, (counts.get(t) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).filter((t) => !used.has(t.toLowerCase())).slice(0, 6);
  $('#tag-suggest').innerHTML = top.map((t) => `<button type="button" data-tag="${esc(t)}">+ ${esc(t)}</button>`).join('');
}

$('#tag-suggest').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tag]');
  if (!b) return;
  const list = f.etiquetas.value.split(',').map((t) => t.trim()).filter(Boolean);
  list.push(b.dataset.tag);
  f.etiquetas.value = list.join(', ');
  renderTagSuggest();
  onFormEdit();
});

$('#seg-tipo').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-value]');
  if (!b) return;
  state.form.tipo = b.dataset.value;
  setSeg('seg-tipo', state.form.tipo);
  onFormEdit();
});

$('#seg-modo').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-value]');
  if (!b || state.active) return;
  state.form.modo = b.dataset.value;
  setSeg('seg-modo', state.form.modo);
  renderTimerControls();
  tick();
});

f.cliente.addEventListener('change', () => { fillProjectSelect(f.proyecto, f.cliente.value, ''); renderRateHint(); onFormEdit(); });
f.proyecto.addEventListener('change', () => { renderRateHint(); onFormEdit(); });
f.facturable.addEventListener('change', () => { renderRateHint(); onFormEdit(); });
f.tarea.addEventListener('input', onFormEdit);
f.etiquetas.addEventListener('input', () => { renderTagSuggest(); onFormEdit(); });
f.minutos.addEventListener('input', () => { f.minutos.dataset.touched = '1'; tick(); });

// Si editás la tarea mientras corre, se actualiza activo.md (con un respiro para no commitear cada letra).
let editTimer = null;
let editPending = false;
function onFormEdit() {
  if (!state.active) return;
  const data = readForm();
  Object.assign(state.active, { tarea: data.tarea, cliente: data.cliente, proyecto: data.proyecto, etiquetas: data.etiquetas, tipo: data.tipo, facturable: data.facturable });
  tick();
  clearTimeout(editTimer);
  editPending = true;
  editTimer = setTimeout(() => {
    editPending = false;
    queue = queue.filter((op) => op.type !== 'setActive' || op === queue[0]);
    enqueue({ type: 'setActive', active: { ...state.active }, msg: `✏️ Edita tarea en curso: ${state.active.tarea || 'sin nombre'}` });
  }, 1500);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  unlockAudio();
  if (state.active) stopTimer(); else startTimer();
});

$('#btn-discard').addEventListener('click', () => {
  if (!state.active) return;
  if (!confirm('¿Descartar esta tarea? No se va a guardar el tiempo.')) return;
  clearTimeout(editTimer);
  editPending = false;
  state.active = null;
  enqueue({ type: 'clearActive', msg: '🗑️ Descarta tarea en curso' });
  renderTimerControls();
  tick();
});

function startTimer(prefill) {
  if (!state.storage) { toast({ ico: '⚙️', title: 'Primero elegí dónde guardar', sub: 'Andá a Ajustes.', kind: 'error' }); return; }
  if (prefill) {
    f.tarea.value = prefill.tarea;
    fillClientSelect(f.cliente, prefill.cliente);
    fillProjectSelect(f.proyecto, prefill.cliente, prefill.proyecto);
    f.etiquetas.value = prefill.etiquetas.join(', ');
    f.facturable.checked = prefill.facturable || !prefill.cliente;
    state.form.tipo = prefill.tipo;
    setSeg('seg-tipo', state.form.tipo);
  }
  const data = readForm();
  state.active = { ...data, inicio: new Date().toISOString() };
  alarmed = false;
  if (data.modo === 'temporizador' && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  playStart();
  enqueue({ type: 'setActive', active: { ...state.active }, msg: `⏱️ Empieza: ${data.tarea || 'sin nombre'}` });
  renderTimerControls();
  renderRateHint();
  tick();
  if (prefill) window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

function stopTimer() {
  clearTimeout(editTimer);
  editPending = false;
  const data = readForm();
  const active = { ...state.active, tarea: data.tarea, cliente: data.cliente, proyecto: data.proyecto, etiquetas: data.etiquetas, tipo: data.tipo, facturable: data.facturable };
  const entry = buildEntry(active, new Date(), state.book, state.cfg.moneda_por_defecto);
  state.active = null;
  addEntry(entry, { fromButton: true });
  queue = queue.filter((op, i) => i === 0 || op.type !== 'setActive');
  LS.set('cola', queue);
  enqueue({ type: 'clearActive', msg: 'Cierra tarea en curso' });
  f.tarea.value = '';
  f.etiquetas.value = '';
  state.form.tipo = 'corta';
  setSeg('seg-tipo', 'corta');
  renderTimerControls();
  tick();
}

function addEntry(entry, { fromButton = false } = {}) {
  const before = lastGame || gameState(state.entries, today());
  state.entries.push(entry);
  const after = gameState(state.entries, today());
  lastGame = after;
  const durTxt = formatDuration(entry.duracion);
  enqueue({ type: 'append', entry, msg: `🪙 ${entry.tarea} · ${durTxt}${entry.monto ? ` · ${entry.monto.toFixed(2)} ${entry.moneda}` : ''}` });
  celebrate(entry, before, after, fromButton);
  renderAll();
}

function renderTimerControls() {
  const running = !!state.active;
  const btn = $('#btn-main');
  btn.textContent = running ? 'Terminar y cobrar' : 'Empezar';
  btn.classList.toggle('stop', running);
  $('#btn-discard').hidden = !running;
  $('#minutes-wrap').hidden = state.form.modo !== 'temporizador';
  $$('#seg-modo button').forEach((b) => { b.disabled = running; });
  f.minutos.disabled = running;
  $('.dial-wrap').classList.toggle('running', running);
}

// ---------- reloj ----------

let alarmed = false;
let lastGame = null;

function todaySeconds() {
  return state.entries.filter((e) => e.fecha === today()).reduce((s, e) => s + e.duracion, 0);
}

function tick() {
  const a = state.active;
  const wrap = $('.dial-wrap');
  const ring = $('#dial-ring');
  const goal = state.cfg.meta_diaria_horas * 3600;
  let fraction = 0;
  let clockText;
  let modeText;
  let over = false;
  const earning = $('#earning');

  if (a) {
    const elapsed = Math.max(0, (Date.now() - Date.parse(a.inicio)) / 1000);
    if (a.modo === 'temporizador') {
      const total = a.minutos * 60;
      const left = total - elapsed;
      over = left < 0;
      fraction = over ? 1 : left / total;
      clockText = over ? `+${formatDuration(-left)}` : formatDuration(left);
      modeText = over ? 'Tiempo cumplido' : `Temporizador · ${a.minutos} min`;
      if (over && !alarmed) {
        alarmed = true;
        playAlarm();
        toast({ ico: '🔔', title: '¡Se cumplió el tiempo!', sub: 'Terminá la tarea o seguí: sigue contando.' });
        if ('Notification' in window && Notification.permission === 'granted') {
          try { new Notification('Tiempo Oro', { body: `Terminó el temporizador de "${a.tarea || 'tu tarea'}"`, icon: 'icon.svg' }); } catch { /* algunos móviles no permiten Notification directo */ }
        }
      }
    } else {
      fraction = Math.min(1, (todaySeconds() + elapsed) / goal);
      clockText = formatDuration(elapsed);
      modeText = 'Cronómetro';
    }
    const { tarifa, moneda } = resolveRate(state.book, a.cliente, a.proyecto, state.cfg.moneda_por_defecto);
    if (tarifa && a.facturable) {
      earning.className = 'earning';
      earning.textContent = `+ ${money(hours(elapsed) * tarifa, moneda)}`;
    } else {
      earning.className = 'earning idle';
      earning.textContent = `+${Math.round(elapsed / 60)} XP`;
    }
    document.title = `${clockText} · ${a.tarea || 'Tiempo Oro'}`;
  } else {
    const done = todaySeconds();
    fraction = Math.min(1, done / goal);
    if (state.form.modo === 'temporizador') {
      clockText = formatDuration((Number(f.minutos.value) || state.cfg.temporizador_minutos) * 60);
      modeText = 'Temporizador listo';
    } else {
      clockText = formatDuration(0);
      modeText = 'Listo para arrancar';
    }
    earning.className = 'earning idle';
    earning.textContent = `Hoy ${hm(done)} de ${state.cfg.meta_diaria_horas} h`;
    document.title = 'Tiempo Oro';
  }
  $('#clock').textContent = clockText;
  $('#dial-mode').textContent = modeText;
  wrap.classList.toggle('over', over);
  ring.style.strokeDasharray = `${Math.round(fraction * 1000)} 1000`;
}

setInterval(() => { if (state.active) tick(); }, 250);

// ---------- celebraciones ----------

function coinCountFor(entry) {
  if (entry.monto > 0) return 5 + Math.min(19, Math.round(Math.log2(1 + entry.duracion / 600) * 4));
  return 2 + Math.min(4, Math.round(entry.duracion / 1800));
}

function celebrate(entry, before, after, fromButton) {
  const gained = entry.monto > 0;
  playCoins(coinCountFor(entry), { quiet: !gained });
  burstCoins(fromButton ? $('#btn-main') : $('#log'), gained ? coinCountFor(entry) : 4);
  setTimeout(() => {
    const p = $('#purse');
    p.classList.remove('bump');
    void p.offsetWidth;
    p.classList.add('bump');
  }, reducedMotion() ? 0 : 700);

  toast({
    kind: 'gold',
    ico: '🪙',
    title: entry.tarea,
    html: `${gained ? `<span class="gain">+ ${esc(money(entry.monto, entry.moneda))}</span> ` : ''}<span class="xp">+${xpForEntry(entry)} XP</span> <small>${esc(formatDuration(entry.duracion))}</small>`,
  });

  if (after.level > before.level) {
    setTimeout(() => { playLevelUp(); showLevelUp(after); }, 900);
  }
  const was = new Set(before.logros.filter((l) => l.desbloqueado).map((l) => l.id));
  after.logros.filter((l) => l.desbloqueado && !was.has(l.id)).forEach((l, i) => {
    setTimeout(() => {
      playAchievement();
      toast({ kind: 'gold', ico: l.icono, title: `Logro: ${l.nombre}`, sub: l.desc });
    }, 1600 + i * 1200);
  });
}

function burstCoins(fromEl, n) {
  if (reducedMotion() || !fromEl) return;
  const fx = $('#fx');
  const from = fromEl.getBoundingClientRect();
  const to = $('#purse .coin').getBoundingClientRect();
  const sx = from.left + from.width / 2;
  const sy = from.top + Math.min(from.height / 2, 40);
  for (let i = 0; i < n; i++) {
    const c = document.createElement('span');
    c.className = 'coin';
    fx.appendChild(c);
    const spread = (Math.random() - 0.5) * 220;
    const up = 80 + Math.random() * 120;
    const anim = c.animate([
      { transform: `translate(${sx}px, ${sy}px) scale(.6)`, opacity: 0 },
      { transform: `translate(${sx + spread}px, ${sy - up}px) scale(1.1) rotateY(180deg)`, opacity: 1, offset: 0.35 },
      { transform: `translate(${to.left}px, ${to.top}px) scale(.8) rotateY(540deg)`, opacity: 1, offset: 0.92 },
      { transform: `translate(${to.left}px, ${to.top}px) scale(.4)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 300, delay: i * 35, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' });
    anim.onfinish = () => c.remove();
  }
}

function showLevelUp(g) {
  const el = $('#levelup');
  $('#levelup-num').textContent = g.level;
  $('#levelup-rank').textContent = g.rango;
  el.hidden = false;
  const close = () => { el.hidden = true; el.removeEventListener('click', close); };
  el.addEventListener('click', close);
  setTimeout(close, 3500);
}

function toast({ ico = '', title = '', sub = '', html = '', kind = '' }) {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.innerHTML = `<span class="t-ico">${esc(ico)}</span><div><b>${esc(title)}</b>${html ? `<div>${html}</div>` : ''}${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

// ---------- HUD ----------

function renderHud() {
  const g = lastGame || gameState(state.entries, today());
  $('#level-num').textContent = g.level;
  $('#rank').textContent = g.rango;
  $('#xpfill').style.width = `${(g.xpEnNivel / g.xpNecesaria) * 100}%`;
  $('#xpbar').setAttribute('aria-valuenow', String(Math.round((g.xpEnNivel / g.xpNecesaria) * 100)));
  $('#xptext').textContent = `${g.xpEnNivel} / ${g.xpNecesaria} XP`;
  $('#streak-num').textContent = g.racha;
  $('#streak').classList.toggle('on', g.racha > 0);
  $('#streak').title = `Racha: ${g.racha} ${g.racha === 1 ? 'día' : 'días'} seguidos`;

  const t = totals(state.entries.filter((e) => e.fecha === today()));
  // la moneda por defecto va primero; las demás quedan en el tooltip
  const list = moneyList(t.dinero).sort((a, b) => (b[0] === state.cfg.moneda_por_defecto) - (a[0] === state.cfg.moneda_por_defecto));
  const main = list[0] || [state.cfg.moneda_por_defecto, 0];
  $('#purse-amount').textContent = money(main[1], main[0]) + (list.length > 1 ? ` +${list.length - 1}` : '');
  $('#purse').title = list.length ? `Ganado hoy: ${list.map(([c, v]) => money(v, c)).join(', ')}` : 'Ganado hoy';
}

// ---------- registro (lista de tareas) ----------

function renderLog() {
  const from = addDays(today(), -6);
  const recent = state.entries.filter((e) => e.fecha >= from).sort((a, b) => (b.fecha + b.inicio).localeCompare(a.fecha + a.inicio));
  const el = $('#log');
  if (!recent.length) {
    el.innerHTML = `<p class="empty">Todavía no hay tareas esta semana. Escribí qué vas a hacer y tocá Empezar.</p>`;
    return;
  }
  const byDay = new Map();
  for (const e of recent) {
    if (!byDay.has(e.fecha)) byDay.set(e.fecha, []);
    byDay.get(e.fecha).push(e);
  }
  const colorOf = (name) => state.book.clients.find((c) => c.nombre === name)?.color || 'var(--muted)';
  el.innerHTML = [...byDay.entries()].map(([day, list]) => {
    const t = totals(list);
    const m = moneyList(t.dinero).map(([c, v]) => money(v, c)).join(' · ');
    return `<div class="day">
      <div class="day-head"><span>${esc(dayLabel(day))}</span><span><b>${formatDuration(t.segundos, { withSeconds: false })} h</b>${m ? ` · ${esc(m)}` : ''}</span></div>
      ${list.map((e) => {
        const idx = state.entries.indexOf(e);
        return `<div class="entry">
          <div class="entry-title">${esc(e.tarea)}</div>
          <div class="entry-meta">
            ${e.cliente ? `<span><span class="dot" style="background:${esc(colorOf(e.cliente))}"></span>${esc(e.cliente)}${e.proyecto ? ` · ${esc(e.proyecto)}` : ''}</span>` : e.proyecto ? `<span>${esc(e.proyecto)}</span>` : ''}
            <span>${esc(e.inicio)}–${esc(e.fin)}</span>
            ${e.tipo === 'larga' ? '<span class="badge-larga">larga</span>' : ''}
            ${e.etiquetas.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
          </div>
          <div class="entry-side">
            <span class="entry-dur">${formatDuration(e.duracion)}</span>
            ${e.monto ? `<span class="entry-money">${esc(money(e.monto, e.moneda))}</span>` : ''}
            <span class="entry-acts">
              <button type="button" data-act="again" data-i="${idx}" title="Volver a empezar esta tarea" aria-label="Volver a empezar ${esc(e.tarea)}">▶</button>
              <button type="button" data-act="del" data-i="${idx}" title="Borrar" aria-label="Borrar ${esc(e.tarea)}">✕</button>
            </span>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

$('#log').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-act]');
  if (!b) return;
  const e = state.entries[Number(b.dataset.i)];
  if (!e) return;
  if (b.dataset.act === 'again') {
    if (state.active) { toast({ ico: '⏱️', title: 'Ya hay una tarea corriendo', sub: 'Terminala primero.' }); return; }
    unlockAudio();
    startTimer(e);
  }
  if (b.dataset.act === 'del') {
    if (!confirm(`¿Borrar "${e.tarea}" (${formatDuration(e.duracion)})?`)) return;
    state.entries.splice(state.entries.indexOf(e), 1);
    lastGame = gameState(state.entries, today());
    enqueue({ type: 'delete', entry: e, msg: `🗑️ Borra: ${e.tarea}` });
    renderAll();
  }
});

// ---------- carga manual ----------

const manual = $('#manual-dialog');
const mform = $('#manual-form');

$('#btn-manual').addEventListener('click', () => {
  mform.reset();
  mform.fecha.value = today();
  const now = new Date();
  mform.fin.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const start = new Date(now - 3600e3);
  mform.inicio.value = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
  fillClientSelect(mform.cliente, f.cliente.value);
  fillProjectSelect(mform.proyecto, mform.cliente.value, '');
  $('#manual-error').hidden = true;
  manual.showModal();
});
mform.cliente.addEventListener('change', () => fillProjectSelect(mform.proyecto, mform.cliente.value, ''));

mform.addEventListener('submit', (ev) => {
  if (ev.submitter?.value !== 'save') return;
  ev.preventDefault();
  const [y, mo, d] = mform.fecha.value.split('-').map(Number);
  const [h1, m1] = mform.inicio.value.split(':').map(Number);
  const [h2, m2] = mform.fin.value.split(':').map(Number);
  const start = new Date(y, mo - 1, d, h1, m1);
  let end = new Date(y, mo - 1, d, h2, m2);
  if (end <= start) end = new Date(end.getTime() + 86400e3); // cruza la medianoche
  if (end - start > 16 * 3600e3) {
    $('#manual-error').textContent = 'Más de 16 horas seguidas: revisá el horario.';
    $('#manual-error').hidden = false;
    return;
  }
  unlockAudio();
  const entry = buildEntry({
    inicio: start.toISOString(),
    tarea: mform.tarea.value.trim(),
    cliente: mform.cliente.value,
    proyecto: mform.proyecto.value,
    etiquetas: mform.etiquetas.value.split(',').map((t) => t.trim()).filter(Boolean),
    tipo: mform.larga.checked ? 'larga' : 'corta',
    facturable: mform.facturable.checked,
  }, end, state.book, state.cfg.moneda_por_defecto);
  manual.close();
  addEntry(entry);
});

// ---------- estadísticas ----------

const PERIODS = [['hoy', 'Hoy'], ['semana', 'Semana'], ['mes', 'Mes'], ['año', 'Año'], ['todo', 'Todo']];

function renderStats() {
  $('#period').innerHTML = PERIODS.map(([k, label]) => `<button role="tab" data-p="${k}" aria-selected="${state.period === k}">${label}</button>`).join('');
  const t0 = today();
  const { from, to } = rangeFor(state.period, t0);
  const list = inRange(state.entries, from, to);
  const t = totals(list);
  const money2 = moneyList(t.dinero);
  const pct = t.segundos ? Math.round((t.facturables / t.segundos) * 100) : 0;

  // barras por día: últimos 14 días, o el período si es más corto/largo dentro de lo razonable
  const chartFrom = state.period === 'mes' ? from : addDays(t0, -13);
  const series = dailySeries(state.entries, chartFrom, t0);

  const colorOf = (name) => state.book.clients.find((c) => c.nombre === name)?.color || 'var(--gold)';
  const bars = (rows, color) => {
    if (!rows.length) return '<p class="empty">Sin datos en este período.</p>';
    const max = rows[0].segundos || 1;
    return `<div class="bars">${rows.slice(0, 8).map((r) => {
      const m = moneyList(r.dinero).map(([c, v]) => money(v, c)).join(' · ');
      return `<div class="bar-row" title="${esc(r.nombre)}: ${esc(hm(r.segundos))}${m ? ` · ${esc(m)}` : ''} · ${r.tareas} tareas">
        <span class="bar-name">${esc(r.nombre)}</span>
        <span class="bar-val">${formatDuration(r.segundos, { withSeconds: false })} h${m ? `<em>${esc(m)}</em>` : ''}</span>
        <span class="bar-track"><i style="width:${(r.segundos / max) * 100}%;background:${esc(color(r.nombre))}"></i></span>
      </div>`;
    }).join('')}</div>`;
  };

  const g = lastGame || gameState(state.entries, t0);
  $('#stats').innerHTML = `
    <div class="tiles">
      <div class="tile"><small>Tiempo</small><b>${formatDuration(t.segundos, { withSeconds: false })} h</b></div>
      <div class="tile"><small>Facturable</small><b>${pct}%</b></div>
      <div class="tile"><small>Ganado</small>${money2.length ? money2.map(([c, v]) => `<b class="money">${esc(money(v, c))}</b>`).join('') : '<b class="money">0</b>'}</div>
      <div class="tile"><small>Tareas</small><b>${t.tareas}</b></div>
    </div>

    <section class="block">
      <h3>${state.period === 'mes' ? 'Horas por día este mes' : 'Horas por día, últimas dos semanas'}</h3>
      ${daysChart(series)}
      <p class="chart-note"><i></i>Meta diaria. Las barras doradas brillantes la alcanzaron.</p>
    </section>

    <section class="block"><h3>Por cliente</h3>${bars(groupBy(list, 'cliente'), colorOf)}</section>
    <section class="block"><h3>Por proyecto</h3>${bars(groupBy(list, 'proyecto'), () => 'var(--gold)')}</section>
    <section class="block"><h3>Por etiqueta</h3>${bars(groupBy(list, 'etiquetas'), () => 'var(--teal)')}</section>

    <section class="block">
      <h3>Logros · ${g.logros.filter((l) => l.desbloqueado).length} de ${g.logros.length}</h3>
      <div class="achievements">${g.logros.map((l) => `<div class="ach ${l.desbloqueado ? 'on' : ''}"><div class="ico">${l.icono}</div><b>${esc(l.nombre)}</b><small>${esc(l.desc)}</small></div>`).join('')}</div>
    </section>`;
}

function daysChart(series) {
  const goal = state.cfg.meta_diaria_horas;
  const maxH = Math.max(goal * 1.15, ...series.map((d) => d.segundos / 3600), 1);
  const every = series.length > 16 ? 3 : 1;
  return `<div class="days" role="img" aria-label="Horas por día">
    <div class="days-goal" style="bottom:calc(20px + ${(goal / maxH).toFixed(4)} * (100% - 28px))"><span>${goal} h</span></div>
    ${series.map((d, i) => {
      const h = d.segundos / 3600;
      const label = parseDateKey(d.fecha).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' });
      const m = moneyList(d.dinero).map(([c, v]) => money(v, c)).join(' · ');
      return `<div class="day-col" title="${esc(label)}: ${esc(hm(d.segundos))}${m ? ` · ${esc(m)}` : ''}">
        <div class="day-bar-area">${h > 0 ? `<i class="${h >= goal ? 'hit-goal' : ''}" style="height:${(h / maxH) * 100}%"></i>` : ''}</div>
        <span>${i % every === 0 || d.fecha === today() ? parseDateKey(d.fecha).getDate() : ''}</span>
      </div>`;
    }).join('')}
  </div>`;
}

$('#period').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-p]');
  if (!b) return;
  state.period = b.dataset.p;
  renderStats();
});

// ---------- clientes ----------

const COMMON_CURRENCIES = ['USD', 'ARS', 'EUR', 'BRL', 'CLP', 'MXN', 'COP', 'UYU', 'PEN', 'GBP'];
const PALETTE = ['#F2C14E', '#3FB8A8', '#E9806F', '#8F9BFF', '#C77DDB', '#7FD36F', '#F29A4E', '#5BB4F0'];

function currencyOptions(value) {
  const list = COMMON_CURRENCIES.includes(value) || !value ? COMMON_CURRENCIES : [value, ...COMMON_CURRENCIES];
  return list.map((c) => `<option ${c === value ? 'selected' : ''}>${c}</option>`).join('');
}

let editingClient = null;
let editingProject = null;

function renderClientsView() {
  const { clients, projects } = state.book;
  const cEdit = editingClient !== null ? clients[editingClient] : null;
  const pEdit = editingProject !== null ? projects[editingProject] : null;
  const nextColor = PALETTE[clients.length % PALETTE.length];
  $('#clients').innerHTML = `
    <div class="panel">
      <h2>Clientes</h2>
      <p>La tarifa es por hora. Lo que ya registraste no cambia si después la modificás.</p>
      ${clients.length ? clients.map((c, i) => `<div class="list-item">
        <span class="swatch" style="background:${esc(c.color || 'var(--muted)')}"></span>
        <div><div>${esc(c.nombre)}</div><div class="sub">${projects.filter((p) => p.cliente === c.nombre).length} proyectos</div></div>
        <div><span class="rate-tag">${c.tarifa ? esc(money(c.tarifa, c.moneda || state.cfg.moneda_por_defecto)) + '/h' : 'sin tarifa'}</span>
          <button class="icon-btn" data-edit-client="${i}" aria-label="Editar ${esc(c.nombre)}">Editar</button></div>
      </div>`).join('') : '<p class="empty">Todavía no cargaste clientes.</p>'}
      <form id="client-form" class="form-grid">
        <label class="field full"><span>${cEdit ? 'Editando cliente' : 'Nuevo cliente'}</span><input name="nombre" required maxlength="60" value="${esc(cEdit?.nombre || '')}" placeholder="Nombre"></label>
        <label class="field"><span>Tarifa por hora</span><input name="tarifa" type="number" min="0" step="0.01" inputmode="decimal" value="${cEdit?.tarifa || ''}" placeholder="0"></label>
        <label class="field"><span>Moneda</span><select name="moneda">${currencyOptions(cEdit?.moneda || state.cfg.moneda_por_defecto)}</select></label>
        <label class="field"><span>Color</span><input name="color" type="color" value="${esc(cEdit?.color || nextColor)}"></label>
        <div class="actions full">
          <button class="btn-small primary">${cEdit ? 'Guardar cambios' : 'Agregar cliente'}</button>
          ${cEdit ? '<button type="button" class="btn-small" data-cancel-client>Cancelar</button><button type="button" class="link danger-link" data-del-client>Borrar cliente</button>' : ''}
        </div>
      </form>
    </div>

    <div class="panel">
      <h2>Proyectos</h2>
      <p>Opcional. Si un proyecto tiene tarifa o moneda propia, pisa la del cliente.</p>
      ${projects.length ? projects.map((p, i) => `<div class="list-item">
        <span class="swatch" style="background:${esc(state.book.clients.find((c) => c.nombre === p.cliente)?.color || 'var(--muted)')}"></span>
        <div><div>${esc(p.nombre)}</div><div class="sub">${esc(p.cliente || 'Cualquier cliente')}</div></div>
        <div><span class="rate-tag">${p.tarifa ? esc(money(p.tarifa, p.moneda || clients.find((c) => c.nombre === p.cliente)?.moneda || state.cfg.moneda_por_defecto)) + '/h' : 'tarifa del cliente'}</span>
          <button class="icon-btn" data-edit-project="${i}" aria-label="Editar ${esc(p.nombre)}">Editar</button></div>
      </div>`).join('') : '<p class="empty">Sin proyectos.</p>'}
      <form id="project-form" class="form-grid">
        <label class="field full"><span>${pEdit ? 'Editando proyecto' : 'Nuevo proyecto'}</span><input name="nombre" required maxlength="60" value="${esc(pEdit?.nombre || '')}" placeholder="Nombre"></label>
        <label class="field full"><span>Cliente</span><select name="cliente"><option value="">Cualquier cliente</option>${clients.map((c) => `<option ${c.nombre === pEdit?.cliente ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></label>
        <label class="field"><span>Tarifa propia</span><input name="tarifa" type="number" min="0" step="0.01" inputmode="decimal" value="${pEdit?.tarifa || ''}" placeholder="la del cliente"></label>
        <label class="field"><span>Moneda propia</span><select name="moneda"><option value="">la del cliente</option>${currencyOptions(pEdit?.moneda || '')}</select></label>
        <div class="actions full">
          <button class="btn-small primary">${pEdit ? 'Guardar cambios' : 'Agregar proyecto'}</button>
          ${pEdit ? '<button type="button" class="btn-small" data-cancel-project>Cancelar</button><button type="button" class="link danger-link" data-del-project>Borrar proyecto</button>' : ''}
        </div>
      </form>
    </div>`;
}

function saveBook(msg) {
  state.book = { clients: [...state.book.clients], projects: [...state.book.projects] };
  enqueue({ type: 'clients', book: state.book, msg });
  syncFormFromActive();
  renderAll();
}

$('#clients').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const nombre = String(fd.get('nombre')).trim();
  if (!nombre) return;
  const tarifa = Number(fd.get('tarifa')) || 0;
  if (ev.target.id === 'client-form') {
    const item = { nombre, tarifa, moneda: String(fd.get('moneda')), color: String(fd.get('color')) };
    const dup = state.book.clients.findIndex((c) => c.nombre.toLowerCase() === nombre.toLowerCase());
    if (dup >= 0 && dup !== editingClient) { toast({ ico: '⚠️', title: 'Ya existe un cliente con ese nombre', kind: 'error' }); return; }
    if (editingClient !== null) {
      const old = state.book.clients[editingClient].nombre;
      state.book.clients[editingClient] = item;
      if (old !== nombre) state.book.projects.forEach((p) => { if (p.cliente === old) p.cliente = nombre; });
    } else state.book.clients.push(item);
    editingClient = null;
    saveBook(`👥 Cliente: ${nombre}`);
  } else {
    const item = { nombre, cliente: String(fd.get('cliente')), tarifa, moneda: String(fd.get('moneda')) };
    if (editingProject !== null) state.book.projects[editingProject] = item; else state.book.projects.push(item);
    editingProject = null;
    saveBook(`📁 Proyecto: ${nombre}`);
  }
});

$('#clients').addEventListener('click', (ev) => {
  const t = ev.target;
  if (t.dataset.editClient !== undefined) { editingClient = Number(t.dataset.editClient); renderClientsView(); $('#client-form input').focus(); }
  if (t.dataset.editProject !== undefined) { editingProject = Number(t.dataset.editProject); renderClientsView(); $('#project-form input').focus(); }
  if (t.hasAttribute('data-cancel-client')) { editingClient = null; renderClientsView(); }
  if (t.hasAttribute('data-cancel-project')) { editingProject = null; renderClientsView(); }
  if (t.hasAttribute('data-del-client')) {
    const c = state.book.clients[editingClient];
    if (!confirm(`¿Borrar el cliente "${c.nombre}"? Las tareas ya registradas no se borran.`)) return;
    state.book.clients.splice(editingClient, 1);
    editingClient = null;
    saveBook(`👥 Borra cliente: ${c.nombre}`);
  }
  if (t.hasAttribute('data-del-project')) {
    const p = state.book.projects[editingProject];
    if (!confirm(`¿Borrar el proyecto "${p.nombre}"?`)) return;
    state.book.projects.splice(editingProject, 1);
    editingProject = null;
    saveBook(`📁 Borra proyecto: ${p.nombre}`);
  }
});

// ---------- ajustes ----------

function renderSettings() {
  const s = state.settings;
  const c = state.cfg;
  const folderOk = localFolderSupported();
  $('#settings').innerHTML = `
    <div class="panel">
      <h2>Dónde se guardan tus .md</h2>
      <p>Ahora: <b>${esc(state.storage?.label || 'sin conectar')}</b></p>
      <div class="radio-cards" id="mode-cards">
        <label class="radio-card"><input type="radio" name="mode" value="github" ${s.mode === 'github' ? 'checked' : ''}><b>Tu repo de GitHub</b><small>Funciona en la compu y en el celu. Cada cambio es un commit.</small></label>
        <label class="radio-card"><input type="radio" name="mode" value="local" ${s.mode === 'local' ? 'checked' : ''} ${folderOk ? '' : 'disabled'}><b>Una carpeta de tu compu</b><small>${folderOk ? 'Sin internet. Chrome o Edge de escritorio.' : 'No disponible en este navegador.'}</small></label>
        <label class="radio-card"><input type="radio" name="mode" value="demo" ${s.mode === 'demo' ? 'checked' : ''}><b>Este navegador (demo)</b><small>Para probar. Si borrás los datos del navegador, se pierden.</small></label>
      </div>

      <form id="gh-form" class="form-grid" ${s.mode === 'github' ? '' : 'hidden'}>
        <label class="field"><span>Usuario u organización</span><input name="owner" value="${esc(s.owner)}" placeholder="ayrtonnacer" autocapitalize="off" spellcheck="false"></label>
        <label class="field"><span>Repo</span><input name="repo" value="${esc(s.repo)}" placeholder="tiempo-oro" autocapitalize="off" spellcheck="false"></label>
        <label class="field"><span>Rama</span><input name="branch" value="${esc(s.branch || 'main')}" autocapitalize="off" spellcheck="false"></label>
        <label class="field"><span>Carpeta de datos</span><input name="root" value="${esc(s.root ?? 'data')}" autocapitalize="off" spellcheck="false"></label>
        <label class="field full"><span>Token de GitHub</span><input name="token" type="password" value="${esc(s.token)}" placeholder="github_pat_…" autocomplete="off" spellcheck="false"></label>
        <p class="hint full">Creá un <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">token fine-grained</a> con acceso <b>sólo a este repo</b> y permiso <b>Contents: Read and write</b>. Se guarda únicamente en este dispositivo.</p>
        <p class="form-error full" id="gh-error" hidden></p>
        <div class="actions full"><button class="btn-small primary">Conectar</button></div>
      </form>

      <div id="local-box" ${s.mode === 'local' ? '' : 'hidden'}>
        <p class="hint">Elegí la carpeta <b>data</b> de tu repo clonado (o cualquier carpeta vacía). Ahí se crean los .md.</p>
        <div class="actions">
          <button type="button" class="btn-small primary" id="pick-folder">${state.pendingFolder ? 'Dar permiso a la carpeta' : 'Elegir carpeta'}</button>
        </div>
      </div>
    </div>

    <form class="panel" id="cfg-form">
      <h2>Preferencias</h2>
      <p>Se guardan en config.md.</p>
      <div class="form-grid">
        <label class="field"><span>Moneda por defecto</span><select name="moneda_por_defecto">${currencyOptions(c.moneda_por_defecto)}</select></label>
        <label class="field"><span>Meta diaria (horas)</span><input name="meta_diaria_horas" type="number" min="0.5" max="16" step="0.5" value="${c.meta_diaria_horas}"></label>
        <label class="field"><span>Temporizador (minutos)</span><input name="temporizador_minutos" type="number" min="1" max="600" value="${c.temporizador_minutos}"></label>
        <label class="field"><span>Sonido</span><select name="sonido"><option ${c.sonido === 'sí' ? 'selected' : ''}>sí</option><option ${c.sonido === 'no' ? 'selected' : ''}>no</option></select></label>
        <label class="field full"><span>Volumen</span><span class="range-row"><input name="volumen" type="range" min="0" max="100" value="${c.volumen}"><button type="button" class="btn-small" id="test-sound">Probar monedas</button></span></label>
      </div>
      <div class="actions" style="margin-top:12px"><button class="btn-small primary">Guardar preferencias</button></div>
    </form>`;
}

$('#settings').addEventListener('change', async (ev) => {
  if (ev.target.name === 'mode') {
    const mode = ev.target.value;
    $('#gh-form').hidden = mode !== 'github';
    $('#local-box').hidden = mode !== 'local';
    if (mode === 'demo') {
      state.settings.mode = 'demo';
      saveStorageSettings(state.settings);
      await reconnect();
    }
  }
  if (ev.target.name === 'volumen') setSound({ vol: Number(ev.target.value) / 100 });
});

$('#settings').addEventListener('click', async (ev) => {
  if (ev.target.id === 'test-sound') {
    unlockAudio();
    setSound({ on: true, vol: Number($('#cfg-form [name=volumen]').value) / 100 });
    playCoins(10);
  }
  if (ev.target.id === 'pick-folder') {
    try {
      if (state.pendingFolder) {
        const perm = await state.pendingFolder.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') return;
      } else {
        await pickLocalFolder();
      }
      state.settings.mode = 'local';
      saveStorageSettings(state.settings);
      await reconnect();
      toast({ ico: '📁', title: 'Carpeta conectada', sub: state.storage?.label || '' });
    } catch (err) {
      if (err.name !== 'AbortError') toast({ ico: '⚠️', title: 'No pude abrir la carpeta', sub: err.message, kind: 'error' });
    }
  }
});

$('#settings').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const fd = Object.fromEntries(new FormData(ev.target));
  if (ev.target.id === 'gh-form') {
    const next = { ...state.settings, mode: 'github', owner: fd.owner.trim(), repo: fd.repo.trim(), branch: fd.branch.trim() || 'main', root: fd.root.trim().replace(/^\/+|\/+$/g, ''), token: fd.token.trim() };
    const err = $('#gh-error');
    err.hidden = true;
    const btn = ev.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Conectando…';
    try {
      await githubStorage(next).check();
      state.settings = next;
      saveStorageSettings(next);
      await reconnect();
      toast({ ico: '✅', title: 'Conectado a GitHub', sub: `${next.owner}/${next.repo}` });
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Conectar';
    }
  }
  if (ev.target.id === 'cfg-form') {
    state.cfg = parseConfig(renderConfig({ ...state.cfg, ...fd }));
    setSound({ on: state.cfg.sonido === 'sí', vol: state.cfg.volumen / 100 });
    enqueue({ type: 'config', cfg: state.cfg, msg: '⚙️ Actualiza configuración' });
    if (!f.minutos.dataset.touched) f.minutos.value = state.cfg.temporizador_minutos;
    renderAll();
    toast({ ico: '⚙️', title: 'Preferencias guardadas' });
  }
});

async function reconnect() {
  // lo que quedó en cola pertenece al almacenamiento anterior
  if (queue.length && !confirm(`Hay ${queue.length} cambios sin guardar en el lugar anterior. ¿Descartarlos y cambiar?`)) return;
  queue = [];
  LS.set('cola', queue);
  state.syncError = '';
  await connect();
  await loadAll();
}

// ---------- navegación ----------

function showView(view) {
  state.view = view;
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== view; });
  $$('.tabs button').forEach((b) => {
    if (b.dataset.tab === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  renderView();
  window.scrollTo({ top: 0 });
}

$('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) showView(b.dataset.tab);
});

function renderView() {
  if (state.view === 'stats') renderStats();
  if (state.view === 'clients') renderClientsView();
  if (state.view === 'settings') renderSettings();
}

function renderAll() {
  renderHud();
  renderLog();
  renderTagSuggest();
  renderSync();
  renderView();
  tick();
}

// otro dispositivo pudo haber empezado o terminado una tarea
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.storage && !queue.length && !editPending) loadAll();
});

// ---------- arranque ----------

(async () => {
  await connect();
  if (!state.storage) showView('settings');
  await loadAll();
  if (state.active) {
    const a = state.active;
    alarmed = a.modo === 'temporizador' && Date.now() - Date.parse(a.inicio) > a.minutos * 60e3;
  }
})();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
