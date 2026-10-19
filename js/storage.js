// Dónde viven los .md. Tres modos con la misma interfaz:
//   read(path) -> string | null
//   write(path, text, message)
//   remove(path, message)
//   list(dir) -> nombres de archivo
//   update(path, fn, message)  fn(textoActual) -> textoNuevo | null (null borra)

const SETTINGS_KEY = 'tiempo-oro:storage';

export function loadStorageSettings() {
  try {
    return { mode: 'demo', owner: '', repo: '', branch: 'main', root: 'data', token: '', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { mode: 'demo', owner: '', repo: '', branch: 'main', root: 'data', token: '' };
  }
}

export function saveStorageSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* sin almacenamiento: queda en memoria */ }
}

// ---------- modo demo (este navegador) ----------

export function demoStorage() {
  const prefix = 'tiempo-oro:demo:';
  const mem = new Map();
  const get = (k) => { try { return localStorage.getItem(prefix + k); } catch { return mem.get(k) ?? null; } };
  const set = (k, v) => { try { localStorage.setItem(prefix + k, v); } catch { mem.set(k, v); } };
  const del = (k) => { try { localStorage.removeItem(prefix + k); } catch { mem.delete(k); } };
  const keys = () => {
    try { return Object.keys(localStorage).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)); } catch { return [...mem.keys()]; }
  };
  const api = {
    label: 'Este navegador (demo)',
    async read(path) { return get(path); },
    async write(path, text) { set(path, text); },
    async remove(path) { del(path); },
    async list(dir) {
      const p = dir.endsWith('/') ? dir : `${dir}/`;
      return keys().filter((k) => k.startsWith(p) && !k.slice(p.length).includes('/')).map((k) => k.slice(p.length));
    },
    async update(path, fn) {
      const next = fn(get(path));
      if (next === null) del(path); else set(path, next);
    },
  };
  return api;
}

// ---------- modo GitHub (los .md viven en tu repo) ----------

const b64encode = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64decode = (b64) => {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function githubStorage({ owner, repo, branch = 'main', root = 'data', token }) {
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/`;
  const full = (path) => [root, path].filter(Boolean).join('/').split('/').map(encodeURIComponent).join('/');
  const shas = new Map();

  async function call(method, path, body) {
    const url = `${base}${full(path)}${method === 'GET' ? `?ref=${encodeURIComponent(branch)}&t=${Date.now()}` : ''}`;
    const res = await fetch(url, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).message || msg; } catch { /* sin cuerpo */ }
      throw new GitHubError(res.status, githubMessage(res.status, msg));
    }
    return res.status === 204 ? {} : res.json();
  }

  async function read(path) {
    const data = await call('GET', path);
    if (!data || Array.isArray(data)) { shas.delete(path); return null; }
    shas.set(path, data.sha);
    return b64decode(data.content || '');
  }

  async function write(path, text, message) {
    const sha = shas.get(path);
    const res = await call('PUT', path, { message: message || `Actualiza ${path}`, content: b64encode(text), branch, ...(sha ? { sha } : {}) });
    shas.set(path, res.content.sha);
  }

  async function remove(path, message) {
    if (!shas.has(path)) await read(path);
    const sha = shas.get(path);
    if (!sha) return;
    await call('DELETE', path, { message: message || `Borra ${path}`, sha, branch });
    shas.delete(path);
  }

  return {
    label: `GitHub · ${owner}/${repo}`,
    read,
    write,
    remove,
    async list(dir) {
      const data = await call('GET', dir);
      return Array.isArray(data) ? data.filter((f) => f.type === 'file').map((f) => f.name) : [];
    },
    // Lee lo último, aplica el cambio y guarda. Si otro dispositivo escribió en el medio, reintenta.
    async update(path, fn, message) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await read(path);
        const next = fn(current);
        try {
          if (next === null) await remove(path, message);
          else await write(path, next, message);
          return;
        } catch (err) {
          if (!(err instanceof GitHubError) || ![409, 422].includes(err.status) || attempt === 2) throw err;
        }
      }
    },
    async check() {
      const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
        cache: 'no-store',
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new GitHubError(res.status, githubMessage(res.status, ''));
      const info = await res.json();
      if (info.permissions && !info.permissions.push) throw new GitHubError(403, 'El token puede leer el repo pero no escribir. Dale permiso Contents: Read and write.');
      return info;
    },
  };
}

function githubMessage(status, raw) {
  if (status === 401) return 'GitHub rechazó el token. Revisá que esté bien copiado y no haya vencido.';
  if (status === 403) return `GitHub no deja escribir con este token (${raw}). Dale permiso Contents: Read and write sobre el repo.`;
  if (status === 404) return 'No encontré el repo. Revisá usuario, nombre del repo y que el token tenga acceso a él.';
  if (status === 409 || status === 422) return 'Otro dispositivo cambió el archivo al mismo tiempo. Probá de nuevo.';
  return `GitHub respondió ${status}: ${raw}`;
}

// ---------- modo carpeta local (Chrome/Edge de escritorio) ----------

export const localFolderSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('tiempo-oro', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = db.transaction('handles').objectStore('handles').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function pickLocalFolder() {
  const handle = await window.showDirectoryPicker({ id: 'tiempo-oro', mode: 'readwrite' });
  await idbSet('root', handle);
  return handle;
}

/** Devuelve { storage } si hay permiso, o { needsPermission, handle } si hay que pedirlo con un clic. */
export async function restoreLocalFolder() {
  if (!localFolderSupported()) return { unsupported: true };
  const handle = await idbGet('root').catch(() => null);
  if (!handle) return { missing: true };
  const perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') return { storage: localStorageFromHandle(handle) };
  return { needsPermission: true, handle };
}

export function localStorageFromHandle(rootHandle) {
  async function dirFor(path, create) {
    const parts = path.split('/').filter(Boolean);
    let dir = rootHandle;
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
    return dir;
  }
  async function fileHandle(path, create) {
    const parts = path.split('/');
    const name = parts.pop();
    const dir = await dirFor(parts.join('/'), create);
    return dir.getFileHandle(name, { create });
  }
  const notFound = (e) => e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');
  const api = {
    label: `Carpeta local · ${rootHandle.name}`,
    async read(path) {
      try { return await (await (await fileHandle(path, false)).getFile()).text(); } catch (e) { if (notFound(e)) return null; throw e; }
    },
    async write(path, text) {
      const w = await (await fileHandle(path, true)).createWritable();
      await w.write(text);
      await w.close();
    },
    async remove(path) {
      const parts = path.split('/');
      const name = parts.pop();
      try { await (await dirFor(parts.join('/'), false)).removeEntry(name); } catch (e) { if (!notFound(e)) throw e; }
    },
    async list(dir) {
      try {
        const d = await dirFor(dir, false);
        const out = [];
        for await (const [name, h] of d.entries()) if (h.kind === 'file') out.push(name);
        return out;
      } catch (e) { if (notFound(e)) return []; throw e; }
    },
    async update(path, fn) {
      const next = fn(await api.read(path));
      if (next === null) await api.remove(path); else await api.write(path, next);
    },
  };
  return api;
}
