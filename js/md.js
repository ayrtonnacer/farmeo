// Lectura y escritura de los archivos .md.
// Sin dependencias: funciona en el navegador y en Node.

// ---------- celdas de tabla ----------

export function escapeCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .trim();
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length && (s[i + 1] === '|' || s[i + 1] === '\\')) {
      cur += s[i + 1];
      i++;
    } else if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

// "Duración" -> "duracion": así no importa si editás el archivo a mano con o sin tildes.
export const normalizeKey = (s) =>
  String(s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const isSeparator =(line) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line.trim());
const isTableLine = (line) => line.trim().startsWith('|');

// ---------- tablas ----------

/**
 * Devuelve todas las tablas del documento.
 * Cada tabla: { heading, columns, rows: [{col: valor}] }
 * `heading` es el último título (#, ##...) que aparece antes de la tabla.
 */
export function parseTables(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const tables = [];
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) { heading = h[1].trim(); continue; }
    if (isTableLine(line) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const columns = splitRow(line).map(normalizeKey);
      const rows = [];
      i += 2;
      while (i < lines.length && isTableLine(lines[i])) {
        const cells = splitRow(lines[i]);
        if (cells.some((c) => c !== '')) {
          const row = {};
          columns.forEach((col, idx) => { row[col] = cells[idx] ?? ''; });
          rows.push(row);
        }
        i++;
      }
      i--;
      tables.push({ heading, columns, rows });
    }
  }
  return tables;
}

export function renderTable(columns, rows) {
  const head = `| ${columns.join(' | ')} |`;
  const sep = `|${columns.map(() => '---').join('|')}|`;
  const keys = columns.map(normalizeKey);
  const body = rows.map((r) => `| ${keys.map((k) => escapeCell(r[k])).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

// ---------- frontmatter ----------

export function parseFrontmatter(text) {
  const m = String(text ?? '').match(/^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!m) return { data: {}, body: String(text ?? '') };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([\w.-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.length > 1 && v.startsWith('"') && v.endsWith('"')) {
      try { v = JSON.parse(v); } catch { v = v.slice(1, -1); }
    } else if (v.length > 1 && v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    data[kv[1]] = v;
  }
  return { data, body: String(text).slice(m[0].length) };
}

export function renderFrontmatter(data, body = '') {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      const s = String(v);
      return `${k}: ${/[:#"']|^\s|\s$/.test(s) ? JSON.stringify(s) : s}`;
    });
  return `---\n${lines.join('\n')}\n---\n${body ? `\n${body.trim()}\n` : ''}`;
}
