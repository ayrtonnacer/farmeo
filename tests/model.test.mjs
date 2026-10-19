import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTables, renderTable, parseFrontmatter } from '../js/md.js';
import {
  parseClients, renderClients, resolveRate, parseEntries, renderMonth, buildEntry,
  parseActive, renderActive, totals, groupBy, streak, levelInfo, gameState, dailySeries,
  parseDuration, formatDuration, parseConfig, renderConfig, sameEntry,
} from '../js/model.js';

test('tablas: escapa pipes y respeta tildes en encabezados', () => {
  const md = renderTable(['tarea', 'duración'], [{ tarea: 'A | B', duracion: '1:00:00' }]);
  const [t] = parseTables(md);
  assert.deepEqual(t.columns, ['tarea', 'duracion']);
  assert.equal(t.rows[0].tarea, 'A | B');
});

test('frontmatter ida y vuelta con comillas y dos puntos', () => {
  const a = { inicio: '2026-10-18T09:00:00.000Z', tarea: 'Reunión "kickoff": cliente', cliente: 'X', proyecto: '', etiquetas: ['a', 'b'], tipo: 'larga', facturable: true, modo: 'temporizador', minutos: 50 };
  const back = parseActive(renderActive(a));
  assert.deepEqual(back, a);
  assert.equal(parseFrontmatter('sin frontmatter').body, 'sin frontmatter');
});

test('clientes y tarifa del proyecto pisa la del cliente', () => {
  const book = { clients: [{ nombre: 'Estudio', tarifa: 15, moneda: 'USD', color: '#fff' }], projects: [{ nombre: 'CRM', cliente: 'Estudio', tarifa: 20, moneda: '' }] };
  const parsed = parseClients(renderClients(book));
  assert.deepEqual(parsed, book);
  assert.deepEqual(resolveRate(book, 'Estudio', 'CRM', 'ARS'), { tarifa: 20, moneda: 'USD' });
  assert.deepEqual(resolveRate(book, 'Estudio', '', 'ARS'), { tarifa: 15, moneda: 'USD' });
  assert.deepEqual(resolveRate(book, '', '', 'ARS'), { tarifa: 0, moneda: 'ARS' });
});

test('cerrar un timer arma el registro con monto congelado', () => {
  const book = { clients: [{ nombre: 'Estudio', tarifa: 20, moneda: 'USD', color: '' }], projects: [] };
  const start = new Date(2026, 9, 18, 9, 10, 0);
  const end = new Date(2026, 9, 18, 11, 40, 0);
  const e = buildEntry({ inicio: start.toISOString(), tarea: 'Fix', cliente: 'Estudio', proyecto: '', etiquetas: ['bug'], tipo: 'larga', facturable: true }, end, book, 'USD');
  assert.equal(e.fecha, '2026-10-18');
  assert.equal(e.inicio, '09:10');
  assert.equal(e.duracion, 9000);
  assert.equal(e.monto, 50);
  const back = parseEntries(renderMonth('2026-10', [e]));
  assert.equal(back.length, 1);
  assert.ok(sameEntry(back[0], e));
});

test('no facturable o sin tarifa da monto 0', () => {
  const book = { clients: [], projects: [] };
  const e = buildEntry({ inicio: new Date(2026, 0, 1, 10).toISOString(), facturable: true }, new Date(2026, 0, 1, 11), book, 'USD');
  assert.equal(e.monto, 0);
  assert.equal(e.facturable, false);
});

test('registros editados a mano: monto vacío se recalcula, filas basura se ignoran', () => {
  const md = `| fecha | duracion | tarea | tarifa | moneda | monto |
|---|---|---|---|---|---|
| 2026-10-01 | 1:30 | algo | 10 | ARS | |
| nota suelta | | | | | |`;
  const [e] = parseEntries(md);
  assert.equal(e.duracion, 5400);
  assert.equal(e.monto, 15);
  assert.equal(e.facturable, true);
  assert.equal(parseEntries(md).length, 1);
});

test('duraciones', () => {
  assert.equal(parseDuration('2:30:05'), 9005);
  assert.equal(parseDuration('0:45'), 2700);
  assert.equal(formatDuration(9005), '2:30:05');
});

test('estadísticas y monedas separadas', () => {
  const es = [
    { fecha: '2026-10-17', duracion: 3600, cliente: 'A', etiquetas: ['x'], moneda: 'USD', monto: 10, facturable: true, tipo: 'corta', inicio: '10:00' },
    { fecha: '2026-10-18', duracion: 1800, cliente: 'B', etiquetas: [], moneda: 'ARS', monto: 5000, facturable: true, tipo: 'corta', inicio: '10:00' },
  ];
  const t = totals(es);
  assert.deepEqual(t.dinero, { USD: 10, ARS: 5000 });
  assert.equal(groupBy(es, 'cliente')[0].nombre, 'A');
  assert.equal(groupBy(es, 'etiquetas').length, 2);
  assert.equal(dailySeries(es, '2026-10-16', '2026-10-18').length, 3);
  assert.equal(streak(es, '2026-10-18'), 2);
  assert.equal(streak(es, '2026-10-19'), 2);
  assert.equal(streak(es, '2026-10-20'), 0);
});

test('niveles y logros', () => {
  assert.equal(levelInfo(0).level, 1);
  assert.equal(levelInfo(150).level, 2);
  const g = gameState([{ fecha: '2026-10-18', duracion: 4 * 3600, cliente: 'A', etiquetas: [], moneda: 'USD', monto: 120, facturable: true, tipo: 'larga', inicio: '06:30' }], '2026-10-18');
  const on = g.logros.filter((l) => l.desbloqueado).map((l) => l.id);
  assert.deepEqual(on.sort(), ['madrugador', 'maraton', 'oro100', 'primera'].sort());
});

test('config con valores raros cae en los defaults', () => {
  const c = parseConfig('---\nmeta_diaria_horas: abc\nvolumen: 300\n---');
  assert.equal(c.meta_diaria_horas, 6);
  assert.equal(c.volumen, 100);
  assert.equal(parseConfig(renderConfig(c)).volumen, 100);
});
