import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubStorage } from '../js/storage.js';

// API de contenidos de GitHub simulada en memoria, con control de sha como la real.
function fakeGitHub() {
  const files = new Map(); // path -> { text, sha }
  let n = 0;
  const b64 = (t) => Buffer.from(t, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');
  const handler = async (url, opts = {}) => {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ''));
    const method = opts.method || 'GET';
    const json = (status, body) => ({ ok: status < 300, status, statusText: '', json: async () => body });
    if (method === 'GET') {
      if (files.has(path)) return json(200, { type: 'file', sha: files.get(path).sha, content: b64(files.get(path).text) });
      const kids = [...files.keys()].filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'));
      if (kids.length) return json(200, kids.map((k) => ({ type: 'file', name: k.split('/').pop() })));
      return json(404, { message: 'Not Found' });
    }
    const body = JSON.parse(opts.body);
    const cur = files.get(path);
    if (method === 'PUT') {
      if (cur && body.sha !== cur.sha) return json(409, { message: 'sha mismatch' });
      if (!cur && body.sha) return json(422, { message: 'sha not expected' });
      const sha = `s${++n}`;
      files.set(path, { text: Buffer.from(body.content, 'base64').toString('utf8'), sha });
      return json(cur ? 200 : 201, { content: { sha } });
    }
    if (method === 'DELETE') {
      if (!cur || body.sha !== cur.sha) return json(409, { message: 'sha mismatch' });
      files.delete(path);
      return json(200, {});
    }
    return json(405, {});
  };
  return { files, handler };
}

test('GitHub: crea, lee, lista, actualiza y borra con tildes y emojis', async () => {
  const gh = fakeGitHub();
  globalThis.fetch = gh.handler;
  const s = githubStorage({ owner: 'yo', repo: 'r', token: 't' });
  assert.equal(await s.read('activo.md'), null);
  await s.write('registros/2026-10.md', 'Reunión ☕ 🪙');
  assert.equal(await s.read('registros/2026-10.md'), 'Reunión ☕ 🪙');
  assert.deepEqual(await s.list('registros'), ['2026-10.md']);
  await s.update('registros/2026-10.md', (t) => `${t}\nmás`);
  assert.equal(gh.files.get('data/registros/2026-10.md').text, 'Reunión ☕ 🪙\nmás');
  await s.update('registros/2026-10.md', () => null);
  assert.equal(gh.files.has('data/registros/2026-10.md'), false);
});

test('GitHub: si otro dispositivo escribió en el medio, reintenta sin pisar su cambio', async () => {
  const gh = fakeGitHub();
  globalThis.fetch = gh.handler;
  const a = githubStorage({ owner: 'yo', repo: 'r', token: 't' });
  await a.write('registros/2026-10.md', 'fila1');
  let first = true;
  await a.update('registros/2026-10.md', (t) => {
    if (first) {
      first = false;
      gh.files.set('data/registros/2026-10.md', { text: `${t}\nfila-del-celu`, sha: 'otro' });
    }
    return `${t}\nfila-de-la-compu`;
  });
  assert.equal(gh.files.get('data/registros/2026-10.md').text, 'fila1\nfila-del-celu\nfila-de-la-compu');
});
