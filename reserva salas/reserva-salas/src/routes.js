/* =====================================================================
 *  Tabla de rutas de la API REST. La usan el servidor Express y el
 *  modo demo del navegador, así ambos exponen exactamente la misma API.
 *  Cada handler recibe (svc, ctx) con ctx = { user, token, params, query, body }.
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReservaRoutes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const R = [];
  const add = (method, path, handler, opts) => R.push(Object.assign({ method, path, handler, publica: false }, opts || {}));

  add('GET', '/api/health', () => ({ ok: true, servicio: 'reserva-salas' }), { publica: true });

  // Autenticación
  add('POST', '/api/login', (svc, c) => {
    const usuario = svc.login(c.body.correo, c.body.password);
    return { token: svc.crearSesion(usuario.id, 8), usuario };
  }, { publica: true });
  add('POST', '/api/logout', (svc, c) => { svc.cerrarSesion(c.token); return { ok: true }; });
  add('GET', '/api/me', (svc, c) => ({ usuario: c.user, puedeReservar: svc.puedeReservar(c.user) }));
  add('GET', '/api/parametros', (svc) => svc.params());

  // Edificios y recursos (HU08, HU09)
  add('GET', '/api/edificios', (svc) => svc.edificios());
  add('GET', '/api/recursos', (svc, c) => svc.listRecursos({ tipo: c.query.tipo, soloDisponibles: c.query.disponibles === '1', edificio: c.query.edificio }));
  add('GET', '/api/recursos/:id', (svc, c) => svc.getRecurso(c.params.id));
  add('POST', '/api/recursos', (svc, c) => svc.guardarRecurso(c.user, c.body), { status: 201 });
  add('PUT', '/api/recursos/:id', (svc, c) => svc.guardarRecurso(c.user, c.body, c.params.id));
  add('POST', '/api/recursos/:id/estado', (svc, c) => svc.cambiarEstadoRecurso(c.user, c.params.id, c.body.estado));

  // Calendario (HU01, HU02)
  add('GET', '/api/recursos/:id/calendario', (svc, c) => svc.calendario(c.user, c.params.id, c.query.desde, c.query.hasta));
  add('GET', '/api/recursos/:id/libres', (svc, c) => svc.horariosLibres(c.params.id, c.query.fecha));

  // Reservas (HU03, HU04, HU05, HU06, HU07, HU11)
  add('POST', '/api/reservas/validar', (svc, c) => {
    const v = svc.validar(c.user, c.body);
    return { ok: v.ok, errores: v.errores, conflictos: v.conflictos };
  });
  add('POST', '/api/reservas', (svc, c) => svc.crearReserva(c.user, c.body), { status: 201 });
  add('POST', '/api/reservas/docente', (svc, c) => svc.crearReservaDocente(c.user, c.body));
  add('GET', '/api/reservas/mias', (svc, c) => svc.misReservas(c.user, c.query));
  add('POST', '/api/reservas/:id/cancelar', (svc, c) => svc.cancelarReserva(c.user, c.params.id, c.body.motivo));
  add('POST', '/api/reservas/:id/confirmar', (svc, c) => svc.confirmarReserva(c.user, c.params.id));

  // Administración (HU10, HU11)
  add('GET', '/api/admin/reservas', (svc, c) => svc.adminReservas(c.user, c.query));
  add('GET', '/api/admin/estadisticas', (svc, c) => svc.estadisticas(c.user, c.query));
  add('GET', '/api/admin/reservas.csv', (svc, c) => svc.reservasCSV(c.user, c.query), { csv: true });

  // Notificaciones
  add('GET', '/api/notificaciones', (svc, c) => svc.notificaciones(c.user));
  add('POST', '/api/notificaciones/leer', (svc, c) => svc.marcarLeidas(c.user));

  // Resolución de rutas con parámetros (/api/recursos/:id)
  function match(method, url) {
    const [path, qs] = url.split('?');
    for (const r of R) {
      if (r.method !== method) continue;
      const a = r.path.split('/'), b = path.split('/');
      if (a.length !== b.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < a.length; i++) {
        if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
        else if (a[i] !== b[i]) { ok = false; break; }
      }
      if (ok) {
        const query = {};
        (qs || '').split('&').filter(Boolean).forEach(kv => {
          const [k, v] = kv.split('=');
          query[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '));
        });
        return { route: r, params, query };
      }
    }
    return null;
  }

  return { routes: R, match };
});
