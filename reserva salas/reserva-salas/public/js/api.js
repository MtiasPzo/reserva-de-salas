/* =====================================================================
 *  Cliente de la API.
 *  - Modo servidor: llama a la API REST de Express (fetch).
 *  - Modo demo: si no hay servidor (o window.RESERVA_DEMO = true), levanta
 *    la MISMA base SQLite en el navegador con sql.js y ejecuta la misma
 *    capa de servicio y tabla de rutas que usa el servidor.
 * ===================================================================== */
(function () {
  'use strict';
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } }
  };
  const DB_KEY = 'reservalab_demo_db_v1';
  let mode = 'remote', token = store.get('reservalab_token'), local = null;

  class ApiError extends Error {
    constructor(status, data) {
      super((data && data.mensaje) || 'No se pudo completar la operación.');
      this.status = status; this.code = data && data.error; this.errores = data && data.errores; this.conflictos = data && data.conflictos;
    }
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src));
      document.head.appendChild(s);
    });
  }

  function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function fromB64(b) { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

  async function initLocal(fresh) {
    if (!window.initSqlJs) await loadScript('js/sql-asm.js');
    const SQL = await window.initSqlJs();
    const [schema, seed] = await Promise.all([
      fetch('database/schema.sql').then(r => r.text()),
      fetch('database/seed.sql').then(r => r.text())
    ]);
    const saved = fresh ? null : store.get(DB_KEY);
    let db;
    if (saved) {
      try { db = new SQL.Database(fromB64(saved)); db.exec('PRAGMA foreign_keys = ON;'); db.exec(schema); }
      catch (e) { db = null; }
    }
    if (!db) {
      db = new SQL.Database();
      db.exec('PRAGMA foreign_keys = ON;');
      db.exec(schema);
      db.exec(seed);
      token = null; store.del('reservalab_token');
    }
    const adapter = {
      all(sql, p) {
        const st = db.prepare(sql); const rows = [];
        try { st.bind(p || []); while (st.step()) rows.push(st.getAsObject()); } finally { st.free(); }
        return rows;
      },
      get(sql, p) { return adapter.all(sql, p)[0]; },
      run(sql, p) {
        db.run(sql, p || []);
        const changes = db.getRowsModified();
        const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
        return { changes, lastInsertRowid: Number(id) };
      },
      tx(fn) {
        db.exec('SAVEPOINT tx');
        try { const r = fn(); db.exec('RELEASE tx'); return r; }
        catch (e) { db.exec('ROLLBACK TO tx'); db.exec('RELEASE tx'); throw e; }
      }
    };
    local = { db, svc: window.ReservaService.createService(adapter) };
    persist();
  }

  function persist() { if (local) store.set(DB_KEY, toB64(local.db.export())); }

  async function init() {
    if (!window.RESERVA_DEMO) {
      try {
        const r = await fetch('api/health', { cache: 'no-store' });
        const j = r.ok ? await r.json() : null;
        if (j && j.ok) { mode = 'remote'; return mode; }
      } catch (e) { /* sin servidor: modo demo */ }
    }
    mode = 'local';
    await initLocal(false);
    return mode;
  }

  async function call(method, path, body) {
    if (mode === 'remote') {
      const r = await fetch(path.replace(/^\//, ''), {
        method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
      const isJson = (r.headers.get('content-type') || '').indexOf('json') !== -1;
      const data = isJson ? await r.json() : await r.text();
      if (!r.ok) throw new ApiError(r.status, data);
      return data;
    }
    // Modo demo: se resuelve la ruta con la misma tabla del servidor
    const m = window.ReservaRoutes.match(method, path);
    if (!m) throw new ApiError(404, { mensaje: 'Ruta no encontrada.' });
    try {
      const user = local.svc.usuarioPorToken(token);
      if (!m.route.publica && !user) throw Object.assign(new Error('Debes iniciar sesión para continuar.'), { status: 401, code: 'NO_AUTORIZADO' });
      const out = m.route.handler(local.svc, { user, token, params: m.params, query: m.query, body: body || {} });
      if (method !== 'GET') persist();
      return JSON.parse(JSON.stringify(out));
    } catch (e) {
      if (method !== 'GET') persist();
      throw new ApiError(e.status || 500, { error: e.code, mensaje: e.status ? e.message : 'Error interno: ' + e.message, errores: e.errores, conflictos: e.conflictos });
    }
  }

  window.Api = {
    init, call, ApiError,
    get mode() { return mode; },
    setToken(t) { token = t; if (t) store.set('reservalab_token', t); else store.del('reservalab_token'); },
    get token() { return token; },
    csvUrl(qs) { return 'api/admin/reservas.csv?' + qs + '&token=' + encodeURIComponent(token || ''); },
    async resetDemo() { store.del(DB_KEY); await initLocal(true); }
  };
})();
