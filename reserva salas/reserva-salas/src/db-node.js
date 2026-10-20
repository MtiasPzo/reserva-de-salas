/* Adaptador de base de datos para Node.js.
 * Usa el SQLite incluido en Node.js (módulo node:sqlite, Node 22.13 o superior),
 * por lo que no requiere compilar librerías nativas. Si no está disponible,
 * intenta usar better-sqlite3 (opcional). */
'use strict';
const fs = require('fs');
const path = require('path');

// Oculta el aviso "SQLite is an experimental feature" de Node.js
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  if (String(warning && warning.message || warning).includes('SQLite is an experimental feature')) return;
  return emitWarning.call(process, warning, ...args);
};

const SCHEMA = path.join(__dirname, '..', 'database', 'schema.sql');
const SEED = path.join(__dirname, '..', 'database', 'seed.sql');

function abrirMotor(file) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(file);
    return {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => db.prepare(sql),
      close: () => db.close()
    };
  } catch (e) {
    let Database;
    try { Database = require('better-sqlite3'); }
    catch (e2) { throw new Error('Se necesita Node.js 22.13 o superior (recomendado: Node.js 24 LTS desde https://nodejs.org).'); }
    const db = new Database(file);
    return { exec: (sql) => db.exec(sql), prepare: (sql) => db.prepare(sql), close: () => db.close() };
  }
}

function openDatabase(file, { reset = false, seed = true } = {}) {
  if (reset && file !== ':memory:' && fs.existsSync(file)) {
    fs.unlinkSync(file);
    for (const ext of ['-wal', '-shm']) if (fs.existsSync(file + ext)) fs.unlinkSync(file + ext);
  }
  const nueva = file === ':memory:' || !fs.existsSync(file);
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = abrirMotor(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(SCHEMA, 'utf8'));
  if (nueva && seed) {
    try { db.exec(fs.readFileSync(SEED, 'utf8')); }
    catch (e) {
      db.close();
      if (file !== ':memory:' && fs.existsSync(file)) fs.unlinkSync(file);
      throw new Error('Error en database/seed.sql: ' + e.message + '\nRevisa comas, comillas simples y el punto y coma final de cada INSERT.');
    }
  }
  const plain = (r) => (r ? Object.assign({}, r) : r);
  let depth = 0;

  return {
    raw: db,
    all: (sql, p = []) => db.prepare(sql).all(...p).map(plain),
    get: (sql, p = []) => plain(db.prepare(sql).get(...p)),
    run: (sql, p = []) => { const r = db.prepare(sql).run(...p); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; },
    tx: (fn) => {
      const sp = 'sp' + (depth++);
      db.exec(`SAVEPOINT ${sp}`);
      try { const out = fn(); db.exec(`RELEASE ${sp}`); return out; }
      catch (e) { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); throw e; }
      finally { depth--; }
    },
    close: () => db.close()
  };
}

module.exports = { openDatabase };
