// Reglas del negocio: registros, tarifas, estadísticas y gamificación.
// Puro: no toca el DOM ni el almacenamiento, así lo usa también el script de Node.

import { parseTables, renderTable, parseFrontmatter, renderFrontmatter } from './md.js';

// ---------- fechas ----------

const pad = (n) => String(n).padStart(2, '0');
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = (fecha) => fecha.slice(0, 7);
export const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

export function startOfWeek(key) {
  const d = parseDateKey(key);
  const dow = (d.getDay() + 6) % 7; // lunes = 0
  d.setDate(d.getDate() - dow);
  return dateKey(d);
}

export function formatDuration(seconds, { withSeconds = true } = {}) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return withSeconds ? `${h}:${pad(m)}:${pad(sec)}` : `${h}:${pad(m)}`;
}

export function parseDuration(text) {
  const t = String(text ?? '').trim();
  const parts = t.split(':').map((p) => Number(p));
  if (!t || parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 3600 + parts[1] * 60;
  return parts[0] * 3600; // "2" = 2 horas
}

export const hours = (seconds) => seconds / 3600;
const round2 = (n) => Math.round(n * 100) / 100;

const yes = (v) => /^(s[ií]|si|yes|true|1|x)$/i.test(String(v ?? '').trim());
const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const splitTags = (v) => String(v ?? '').split(',').map((t) => t.trim()).filter(Boolean);

// ---------- configuración ----------

export const DEFAULT_CONFIG = {
  moneda_por_defecto: 'USD',
  meta_diaria_horas: 6,
  temporizador_minutos: 25,
  sonido: 'sí',
  volumen: 70,
};

export function parseConfig(text) {
  const { data } = parseFrontmatter(text);
  const cfg = { ...DEFAULT_CONFIG, ...data };
  cfg.meta_diaria_horas = num(cfg.meta_diaria_horas) || DEFAULT_CONFIG.meta_diaria_horas;
  cfg.temporizador_minutos = num(cfg.temporizador_minutos) || DEFAULT_CONFIG.temporizador_minutos;
  cfg.volumen = Math.min(100, Math.max(0, num(cfg.volumen)));
  cfg.sonido = yes(cfg.sonido) ? 'sí' : 'no';
  return cfg;
}

export function renderConfig(cfg) {
  return renderFrontmatter(
    {
      moneda_por_defecto: cfg.moneda_por_defecto,
      meta_diaria_horas: cfg.meta_diaria_horas,
      temporizador_minutos: cfg.temporizador_minutos,
      sonido: cfg.sonido,
      volumen: cfg.volumen,
    },
    '# Configuración\n\nPodés editar estos valores acá o desde la app.',
  );
}

// ---------- clientes y proyectos ----------

const CLIENT_COLS = ['cliente', 'tarifa', 'moneda', 'color'];
const PROJECT_COLS = ['proyecto', 'cliente', 'tarifa', 'moneda'];

export function parseClients(text) {
  const tables = parseTables(text);
  const clients = [];
  const projects = [];
  for (const t of tables) {
    if (t.columns.includes('proyecto')) {
      for (const r of t.rows) {
        if (!r.proyecto) continue;
        projects.push({ nombre: r.proyecto, cliente: r.cliente || '', tarifa: num(r.tarifa), moneda: (r.moneda || '').toUpperCase() });
      }
    } else if (t.columns.includes('cliente')) {
      for (const r of t.rows) {
        if (!r.cliente) continue;
        clients.push({ nombre: r.cliente, tarifa: num(r.tarifa), moneda: (r.moneda || '').toUpperCase(), color: r.color || '' });
      }
    }
  }
  return { clients, projects };
}

export function renderClients({ clients, projects }) {
  const c = renderTable(CLIENT_COLS, clients.map((x) => ({ cliente: x.nombre, tarifa: x.tarifa || '', moneda: x.moneda, color: x.color })));
  const p = renderTable(PROJECT_COLS, projects.map((x) => ({ proyecto: x.nombre, cliente: x.cliente, tarifa: x.tarifa || '', moneda: x.moneda })));
  return `# Clientes

La tarifa es por hora.

${c}

# Proyectos

Si un proyecto tiene tarifa o moneda, pisa la del cliente.

${p}
`;
}

/** Tarifa y moneda que se aplican a una tarea. */
export function resolveRate({ clients, projects }, clienteNombre, proyectoNombre, monedaDefault) {
  const client = clients.find((c) => c.nombre === clienteNombre);
  const project = projects.find((p) => p.nombre === proyectoNombre && (!p.cliente || !clienteNombre || p.cliente === clienteNombre));
  const tarifa = project?.tarifa || client?.tarifa || 0;
  const moneda = project?.moneda || client?.moneda || monedaDefault || 'USD';
  return { tarifa, moneda };
}

// ---------- registros ----------

export const ENTRY_COLS = ['fecha', 'inicio', 'fin', 'duración', 'tarea', 'cliente', 'proyecto', 'etiquetas', 'tipo', 'facturable', 'tarifa', 'moneda', 'monto'];

export const monthPath = (fecha) => `registros/${monthKey(fecha)}.md`;

export function parseEntries(text) {
  const out = [];
  for (const t of parseTables(text)) {
    if (!t.columns.includes('fecha')) continue;
    for (const r of t.rows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.fecha)) continue;
      const duracion = parseDuration(r.duracion);
      const tarifa = num(r.tarifa);
      const facturable = (r.facturable ?? '') === '' ? tarifa > 0 : yes(r.facturable);
      out.push({
        fecha: r.fecha,
        inicio: r.inicio || '',
        fin: r.fin || '',
        duracion,
        tarea: r.tarea || '',
        cliente: r.cliente || '',
        proyecto: r.proyecto || '',
        etiquetas: splitTags(r.etiquetas),
        tipo: /larga/i.test(r.tipo) ? 'larga' : 'corta',
        facturable,
        tarifa,
        moneda: (r.moneda || '').toUpperCase(),
        // si alguien editó a mano y dejó el monto vacío, se recalcula
        monto: (r.monto ?? '') === '' ? (facturable ? round2(hours(duracion) * tarifa) : 0) : num(r.monto),
      });
    }
  }
  return out;
}

const entryToRow = (e) => ({
  fecha: e.fecha,
  inicio: e.inicio,
  fin: e.fin,
  duracion: formatDuration(e.duracion),
  tarea: e.tarea,
  cliente: e.cliente,
  proyecto: e.proyecto,
  etiquetas: e.etiquetas.join(', '),
  tipo: e.tipo,
  facturable: e.facturable ? 'sí' : 'no',
  tarifa: e.tarifa || '',
  moneda: e.moneda,
  monto: e.monto.toFixed(2),
});

const sortEntries = (list) => [...list].sort((a, b) => (a.fecha + a.inicio).localeCompare(b.fecha + b.inicio));

export function renderMonth(month, entries) {
  return `# Registros ${month}

${renderTable(ENTRY_COLS, sortEntries(entries).map(entryToRow))}
`;
}

export const sameEntry = (a, b) => JSON.stringify(entryToRow(a)) === JSON.stringify(entryToRow(b));

/** Arma un registro a partir del timer y la hora de cierre. */
export function buildEntry(active, endDate, book, monedaDefault) {
  const start = new Date(active.inicio);
  const duracion = Math.max(1, Math.round((endDate - start) / 1000));
  const { tarifa, moneda } = resolveRate(book, active.cliente, active.proyecto, monedaDefault);
  const facturable = active.facturable !== false && tarifa > 0;
  return {
    fecha: dateKey(start),
    inicio: hhmm(start),
    fin: hhmm(endDate),
    duracion,
    tarea: active.tarea || 'Sin nombre',
    cliente: active.cliente || '',
    proyecto: active.proyecto || '',
    etiquetas: active.etiquetas || [],
    tipo: active.tipo === 'larga' ? 'larga' : 'corta',
    facturable,
    tarifa: facturable ? tarifa : 0,
    moneda,
    monto: facturable ? round2(hours(duracion) * tarifa) : 0,
  };
}

// ---------- timer activo ----------

export function parseActive(text) {
  if (!text) return null;
  const { data } = parseFrontmatter(text);
  if (!data.inicio || Number.isNaN(Date.parse(data.inicio))) return null;
  return {
    inicio: data.inicio,
    tarea: data.tarea || '',
    cliente: data.cliente || '',
    proyecto: data.proyecto || '',
    etiquetas: splitTags(data.etiquetas),
    tipo: data.tipo === 'larga' ? 'larga' : 'corta',
    facturable: data.facturable === undefined ? true : yes(data.facturable),
    modo: data.modo === 'temporizador' ? 'temporizador' : 'cronometro',
    minutos: num(data.minutos) || 25,
  };
}

export function renderActive(a) {
  return renderFrontmatter(
    {
      inicio: a.inicio,
      tarea: a.tarea,
      cliente: a.cliente,
      proyecto: a.proyecto,
      etiquetas: a.etiquetas.join(', '),
      tipo: a.tipo,
      facturable: a.facturable ? 'sí' : 'no',
      modo: a.modo,
      minutos: a.minutos,
    },
    'Hay una tarea corriendo. La app la cierra y la pasa a registros cuando tocás Terminar.',
  );
}

// ---------- estadísticas ----------

export function inRange(entries, from, to) {
  return entries.filter((e) => (!from || e.fecha >= from) && (!to || e.fecha <= to));
}

function addMoney(target, moneda, monto) {
  if (!monto) return;
  target[moneda] = round2((target[moneda] || 0) + monto);
}

export function totals(entries) {
  const t = { segundos: 0, facturables: 0, tareas: entries.length, dinero: {} };
  for (const e of entries) {
    t.segundos += e.duracion;
    if (e.facturable) t.facturables += e.duracion;
    addMoney(t.dinero, e.moneda, e.monto);
  }
  return t;
}

/** Agrupa por cliente, proyecto o etiqueta. Devuelve filas ordenadas por tiempo. */
export function groupBy(entries, field) {
  const map = new Map();
  for (const e of entries) {
    const keys = field === 'etiquetas' ? (e.etiquetas.length ? e.etiquetas : ['(sin etiqueta)']) : [e[field] || `(sin ${field})`];
    for (const k of keys) {
      if (!map.has(k)) map.set(k, { nombre: k, segundos: 0, tareas: 0, dinero: {} });
      const g = map.get(k);
      g.segundos += e.duracion;
      g.tareas += 1;
      addMoney(g.dinero, e.moneda, e.monto);
    }
  }
  return [...map.values()].sort((a, b) => b.segundos - a.segundos);
}

export function dailySeries(entries, from, to) {
  const out = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push({ fecha: k, segundos: 0, dinero: {} });
  const idx = new Map(out.map((d, i) => [d.fecha, i]));
  for (const e of entries) {
    const i = idx.get(e.fecha);
    if (i === undefined) continue;
    out[i].segundos += e.duracion;
    addMoney(out[i].dinero, e.moneda, e.monto);
  }
  return out;
}

export function rangeFor(period, today) {
  switch (period) {
    case 'hoy': return { from: today, to: today };
    case 'semana': return { from: startOfWeek(today), to: today };
    case 'mes': return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'año': return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default: return { from: '', to: '' };
  }
}

// ---------- gamificación ----------

/** XP por tarea: 1 por minuto, x1.5 si es facturable, x1.25 si es larga, más un bonus por terminarla. */
export function xpForEntry(e) {
  const mult = (e.facturable ? 1.5 : 1) * (e.tipo === 'larga' ? 1.25 : 1);
  return Math.round((e.duracion / 60) * mult) + (e.tipo === 'larga' ? 25 : 5);
}

export const xpToNext = (level) => Math.round(150 * level ** 1.35);

export function levelInfo(totalXp) {
  let level = 1;
  let rest = totalXp;
  while (rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, xpEnNivel: rest, xpNecesaria: xpToNext(level), rango: rankFor(level) };
}

const RANKS = [
  [30, 'Leyenda freelance'],
  [20, 'Maestro del oficio'],
  [15, 'Mercenario'],
  [10, 'Artesano'],
  [5, 'Jornalero'],
  [1, 'Aprendiz'],
];
export const rankFor = (level) => RANKS.find(([min]) => level >= min)[1];

export function streak(entries, today) {
  const days = new Set(entries.map((e) => e.fecha));
  let k = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(k)) { n++; k = addDays(k, -1); }
  return n;
}

function longestStreak(entries) {
  const days = [...new Set(entries.map((e) => e.fecha))].sort();
  let best = 0;
  let cur = 0;
  let prev = null;
  for (const d of days) {
    cur = prev && addDays(prev, 1) === d ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = d;
  }
  return best;
}

function bestWeekHours(entries) {
  const weeks = new Map();
  for (const e of entries) {
    const w = startOfWeek(e.fecha);
    weeks.set(w, (weeks.get(w) || 0) + e.duracion);
  }
  return Math.max(0, ...weeks.values()) / 3600;
}

function maxClientsInWeek(entries) {
  const weeks = new Map();
  for (const e of entries) {
    if (!e.cliente) continue;
    const w = startOfWeek(e.fecha);
    if (!weeks.has(w)) weeks.set(w, new Set());
    weeks.get(w).add(e.cliente);
  }
  return Math.max(0, ...[...weeks.values()].map((s) => s.size));
}

export const ACHIEVEMENTS = [
  { id: 'primera', icono: '🪙', nombre: 'Primera moneda', desc: 'Terminá tu primera tarea.', check: (s) => s.tareas >= 1 },
  { id: 'cien-tareas', icono: '📜', nombre: 'Cien contratos', desc: 'Terminá 100 tareas.', check: (s) => s.tareas >= 100 },
  { id: 'maraton', icono: '🏃', nombre: 'Maratón', desc: 'Una sola tarea de 3 horas o más.', check: (s) => s.tareaMasLarga >= 3 * 3600 },
  { id: 'racha3', icono: '🔥', nombre: 'Encendido', desc: 'Racha de 3 días seguidos.', check: (s) => s.mejorRacha >= 3 },
  { id: 'racha7', icono: '⚔️', nombre: 'Semana invicta', desc: 'Racha de 7 días seguidos.', check: (s) => s.mejorRacha >= 7 },
  { id: 'racha30', icono: '👑', nombre: 'Imparable', desc: 'Racha de 30 días seguidos.', check: (s) => s.mejorRacha >= 30 },
  { id: 'semana20', icono: '⏳', nombre: 'Media jornada épica', desc: '20 horas en una misma semana.', check: (s) => s.mejorSemana >= 20 },
  { id: 'semana40', icono: '🏰', nombre: 'Semana completa', desc: '40 horas en una misma semana.', check: (s) => s.mejorSemana >= 40 },
  { id: 'horas100', icono: '💯', nombre: 'Centenario', desc: '100 horas registradas.', check: (s) => s.horasTotales >= 100 },
  { id: 'horas1000', icono: '🗿', nombre: 'Las mil horas', desc: '1000 horas registradas.', check: (s) => s.horasTotales >= 1000 },
  { id: 'oro100', icono: '💰', nombre: 'Bolsa llena', desc: 'Ganá 100 en cualquier moneda.', check: (s) => s.maxDinero >= 100 },
  { id: 'oro1000', icono: '🏦', nombre: 'Tesoro', desc: 'Ganá 1000 en cualquier moneda.', check: (s) => s.maxDinero >= 1000 },
  { id: 'madrugador', icono: '🌅', nombre: 'Madrugador', desc: 'Arrancá una tarea entre las 5 y las 7.', check: (s) => s.madrugador },
  { id: 'buho', icono: '🦉', nombre: 'Búho', desc: 'Arrancá una tarea entre las 23 y las 4.', check: (s) => s.buho },
  { id: 'multicliente', icono: '🧭', nombre: 'Multiclase', desc: 'Trabajá para 3 clientes en una semana.', check: (s) => s.clientesSemana >= 3 },
];

export function gameState(entries, today) {
  const t = totals(entries);
  const xp = entries.reduce((sum, e) => sum + xpForEntry(e), 0);
  const s = {
    tareas: entries.length,
    horasTotales: t.segundos / 3600,
    tareaMasLarga: Math.max(0, ...entries.map((e) => e.duracion)),
    mejorRacha: longestStreak(entries),
    mejorSemana: bestWeekHours(entries),
    maxDinero: Math.max(0, ...Object.values(t.dinero)),
    madrugador: entries.some((e) => e.inicio >= '05:00' && e.inicio < '07:00'),
    buho: entries.some((e) => e.inicio >= '23:00' || (e.inicio && e.inicio < '04:00')),
    clientesSemana: maxClientsInWeek(entries),
  };
  return {
    xp,
    ...levelInfo(xp),
    racha: streak(entries, today),
    logros: ACHIEVEMENTS.map((a) => ({ ...a, desbloqueado: a.check(s) })),
  };
}
