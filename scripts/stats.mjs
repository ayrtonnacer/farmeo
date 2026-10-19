#!/usr/bin/env node
// Estadísticas desde la terminal, leyendo directo los .md.
//
//   node scripts/stats.mjs                 -> esta semana
//   node scripts/stats.mjs mes             -> hoy | semana | mes | año | todo
//   node scripts/stats.mjs 2026-10-01 2026-10-31
//   node scripts/stats.mjs mes --md        -> genera data/resumen.md
//   DATA_DIR=otra/carpeta node scripts/stats.mjs

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseEntries, parseConfig, inRange, totals, groupBy, rangeFor, gameState, formatDuration, dateKey,
} from '../js/model.js';

const root = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const asMarkdown = process.argv.includes('--md');

const read = (p) => readFile(join(root, p), 'utf8').catch(() => '');

const files = (await readdir(join(root, 'registros')).catch(() => [])).filter((f) => /^\d{4}-\d{2}\.md$/.test(f));
const entries = (await Promise.all(files.map((f) => read(`registros/${f}`)))).flatMap(parseEntries);
const cfg = parseConfig(await read('config.md'));

const today = dateKey(new Date());
let from;
let to;
let titulo;
if (/^\d{4}-\d{2}-\d{2}$/.test(args[0] || '')) {
  from = args[0];
  to = args[1] || today;
  titulo = `${from} a ${to}`;
} else {
  const period = args[0] || 'semana';
  ({ from, to } = rangeFor(period, today));
  titulo = period;
}

const list = inRange(entries, from, to);
const t = totals(list);
const g = gameState(entries, today);
const h = (s) => `${formatDuration(s, { withSeconds: false })} h`;
const plata = (d) => Object.entries(d).map(([c, v]) => `${v.toFixed(2)} ${c}`).join(' · ') || '—';

const tabla = (rows) => [
  '| nombre | tiempo | tareas | ganado |',
  '|---|---|---|---|',
  ...rows.map((r) => `| ${r.nombre} | ${h(r.segundos)} | ${r.tareas} | ${plata(r.dinero)} |`),
].join('\n');

const md = `# Resumen: ${titulo}

Generado el ${today}. Meta diaria: ${cfg.meta_diaria_horas} h.

| | |
|---|---|
| Tiempo total | ${h(t.segundos)} |
| Facturable | ${t.segundos ? Math.round((t.facturables / t.segundos) * 100) : 0}% |
| Ganado | ${plata(t.dinero)} |
| Tareas | ${t.tareas} |
| Nivel | ${g.level} (${g.rango}) · ${g.xp} XP |
| Racha | ${g.racha} días |

## Por cliente

${tabla(groupBy(list, 'cliente'))}

## Por proyecto

${tabla(groupBy(list, 'proyecto'))}

## Por etiqueta

${tabla(groupBy(list, 'etiquetas'))}

## Logros

${g.logros.map((l) => `- ${l.desbloqueado ? '[x]' : '[ ]'} ${l.icono} **${l.nombre}**: ${l.desc}`).join('\n')}
`;

if (asMarkdown) {
  await writeFile(join(root, 'resumen.md'), md);
  console.log(`Escribí ${join(root, 'resumen.md')}`);
} else {
  console.log(md);
}
