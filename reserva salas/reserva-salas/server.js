/* =====================================================================
 *  Servidor web — Sistema de Reserva de Salas / Laboratorios
 *  Ejecutar:  npm install  &&  npm start   →  http://localhost:3000
 *  Variables: PORT (3000), DB_FILE (data/reservas.db), TZ (America/Santiago)
 * ===================================================================== */
'use strict';
process.env.TZ = process.env.TZ || 'America/Santiago';

const path = require('path');
const express = require('express');
const { openDatabase } = require('./src/db-node');
const { createService, AppError } = require('./src/service');
const { routes } = require('./src/routes');

function createApp({ dbFile, reset } = {}) {
  const db = openDatabase(dbFile || process.env.DB_FILE || path.join(__dirname, 'data', 'reservas.db'), { reset });
  const svc = createService(db);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => {          // cabeceras básicas de seguridad
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  for (const r of routes) {
    const method = r.method.toLowerCase();
    app[method](r.path, (req, res) => {
      try {
        const auth = req.get('Authorization') || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.query.token || null);
        const user = svc.usuarioPorToken(token);
        if (!r.publica && !user) throw new AppError('NO_AUTORIZADO', 401);
        const out = r.handler(svc, { user, token, params: req.params, query: req.query, body: req.body || {} });
        if (r.csv) {
          res.set('Content-Type', 'text/csv; charset=utf-8');
          res.set('Content-Disposition', 'attachment; filename="reservas.csv"');
          return res.send('﻿' + out);
        }
        res.status(r.status || 200).json(out);
      } catch (e) {
        const status = e.status || 500;
        if (status === 500) console.error(e);
        res.status(status).json({ error: e.code || 'ERROR_INTERNO', mensaje: status === 500 ? 'Error interno del servidor.' : e.message,
          errores: e.errores, conflictos: e.conflictos });
      }
    });
  }
  app.use('/api', (req, res) => res.status(404).json({ error: 'NO_ENCONTRADO', mensaje: 'Ruta no encontrada.' }));
  // Módulos compartidos con el navegador (misma lógica en servidor y modo demo)
  app.get('/js/service.js', (req, res) => res.sendFile(path.join(__dirname, 'src', 'service.js')));
  app.get('/js/routes.js', (req, res) => res.sendFile(path.join(__dirname, 'src', 'routes.js')));
  // Recursos para el modo demo sin servidor (misma BD SQLite en el navegador)
  app.use('/database', express.static(path.join(__dirname, 'database')));
  app.get('/js/sql-asm.js', (req, res) => res.sendFile(require.resolve('sql.js/dist/sql-asm.js')));
  app.use(express.static(path.join(__dirname, 'public')));
  return { app, db, svc };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const { app } = createApp({ reset: process.argv.includes('--reset') });
  app.listen(port, () => console.log(`Reserva de Salas disponible en http://localhost:${port}`));
}

module.exports = { createApp };
