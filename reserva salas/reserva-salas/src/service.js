/* =====================================================================
 *  Capa de servicio — Sistema de Reserva de Salas / Laboratorios
 *  Compartida por el servidor (Node + SQLite incluido en Node.js) y el modo demo
 *  del navegador (sql.js). Recibe un adaptador de BD con:
 *    all(sql, params) -> filas   get(sql, params) -> fila|undefined
 *    run(sql, params) -> { changes, lastInsertRowid }   tx(fn) -> resultado
 *  Implementa las clases del diagrama: GestorReservas, ValidadorConflictos,
 *  Calendario, Usuario.puedeReservar(), Administrador.bloquearRecurso().
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReservaService = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- SHA-256 (sin dependencias, igual en Node y navegador) ---------- */
  function sha256(ascii) {
    const utf8 = unescape(encodeURIComponent(ascii));
    const K = [], H = [];
    let p = 0;
    for (let c = 2; p < 64; c++) {
      let prime = true;
      for (let i = 2; i * i <= c; i++) if (c % i === 0) { prime = false; break; }
      if (prime) {
        if (p < 8) H[p] = (Math.pow(c, 1 / 2) * 4294967296) | 0;
        K[p++] = (Math.pow(c, 1 / 3) * 4294967296) | 0;
      }
    }
    const words = [];
    const bitLen = utf8.length * 8;
    let msg = utf8 + '\x80';
    while (msg.length % 64 !== 56) msg += '\x00';
    for (let i = 0; i < msg.length; i++) words[i >> 2] |= msg.charCodeAt(i) << ((3 - i) % 4) * 8;
    words.push((bitLen / 4294967296) | 0, bitLen | 0);
    const rotr = (v, n) => (v >>> n) | (v << (32 - n));
    for (let j = 0; j < words.length; j += 16) {
      const w = words.slice(j, j + 16);
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        if (i >= 16) {
          const w15 = w[i - 15], w2 = w[i - 2];
          const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
          const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
          w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
  }

  /* ---------- Errores de negocio ---------- */
  const MENSAJES = {
    CONFLICTO_HORARIO: 'Ese horario ya está reservado en esta sala. Elige otro bloque o revisa los horarios libres.',
    RECURSO_NO_DISPONIBLE: 'La sala no está disponible para reservas (inactiva o en mantenimiento).',
    FUERA_DE_HORARIO: 'Las reservas se aceptan de lunes a sábado, entre las 08:00 y las 22:00.',
    FECHA_PASADA: 'No se puede reservar una fecha u hora que ya pasó.',
    EXCEDE_CAPACIDAD: 'La cantidad de asistentes supera la capacidad de la sala.',
    CANCELACION_FUERA_DE_PLAZO: 'Solo puedes cancelar hasta 2 horas antes del inicio de la reserva.',
    TRANSICION_INVALIDA: 'La reserva ya fue cancelada o finalizada y no admite este cambio.',
    LIMITE_RESERVAS: 'Alcanzaste el máximo de reservas activas permitidas para estudiantes.',
    DURACION_MAXIMA: 'Una reserva estudiantil puede durar como máximo 3 horas.',
    HORA_INVALIDA: 'La hora de término debe ser posterior a la hora de inicio.',
    BLOQUE_INVALIDO: 'Las horas deben ir en bloques de 30 minutos (por ejemplo 10:00 o 10:30).',
    DATOS_INCOMPLETOS: 'Completa todos los campos obligatorios.',
    NO_AUTORIZADO: 'Debes iniciar sesión para continuar.',
    PROHIBIDO: 'Tu perfil no tiene permiso para esta acción.',
    NO_ENCONTRADO: 'No se encontró el registro solicitado.',
    CREDENCIALES: 'Correo o contraseña incorrectos.',
    USUARIO_INACTIVO: 'Tu cuenta está desactivada. Contacta a la administración.',
    CODIGO_DUPLICADO: 'Ya existe una sala con ese código.',
    VALIDACION: 'Revisa los datos ingresados.'
  };

  class AppError extends Error {
    constructor(code, status, extra) {
      super(MENSAJES[code] || code);
      this.code = code;
      this.status = status || 400;
      if (extra) Object.assign(this, extra);
    }
  }

  function mapDbError(e) {
    if (e instanceof AppError) return e;
    const msg = String(e && e.message || e);
    for (const code of Object.keys(MENSAJES)) if (msg.indexOf(code) !== -1) return new AppError(code, 409);
    if (/UNIQUE constraint failed: recurso\.codigo/.test(msg)) return new AppError('CODIGO_DUPLICADO', 409);
    if (/CHECK constraint failed/.test(msg)) return new AppError('VALIDACION', 422);
    return e;
  }

  /* ---------- Utilidades de fecha/hora ---------- */
  const pad = n => String(n).padStart(2, '0');
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const fromMin = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return isoDate(d); };
  const fechaCL = s => s ? s.split('-').reverse().join('-') : '';   // DD-MM-AAAA (HU11)
  const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/, RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

  function nuevoCodigo(prefijo) {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return `${prefijo}-${s}`;
  }

  /* =====================================================================
   *  Fábrica del servicio
   * ===================================================================== */
  function createService(db, opts) {
    opts = opts || {};
    const now = opts.now || (() => new Date());

    const param = (clave) => { const r = db.get('SELECT valor FROM parametro WHERE clave = ?', [clave]); return r ? r.valor : null; };
    const params = () => {
      const o = {};
      db.all('SELECT clave, valor FROM parametro').forEach(r => { o[r.clave] = r.valor; });
      return o;
    };

    function requiere(user, ...roles) {
      if (!user) throw new AppError('NO_AUTORIZADO', 401);
      if (roles.length && roles.indexOf(user.rol) === -1) throw new AppError('PROHIBIDO', 403);
    }

    function publicUser(u) {
      if (!u) return null;
      const out = { id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol, activo: !!u.activo };
      if (u.rol === 'ESTUDIANTE') Object.assign(out, db.get('SELECT matricula, carrera FROM estudiante WHERE usuario_id = ?', [u.id]) || {});
      if (u.rol === 'DOCENTE') Object.assign(out, db.get('SELECT departamento FROM docente WHERE usuario_id = ?', [u.id]) || {});
      if (u.rol === 'ADMINISTRADOR') Object.assign(out, db.get('SELECT area FROM administrador WHERE usuario_id = ?', [u.id]) || {});
      return out;
    }

    /* ---------- Mantenimiento de estados (FINALIZADA / vencidas) ---------- */
    function finalizarVencidas() {
      db.run(`UPDATE reserva SET estado = 'FINALIZADA'
               WHERE estado = 'CONFIRMADA' AND datetime(fecha || ' ' || hora_fin) <= datetime('now','localtime')`);
      db.run(`UPDATE reserva SET estado = 'CANCELADA', tipo_cancelacion = 'SISTEMA',
                     motivo_cancelacion = 'Vencida sin aprobación del administrador'
               WHERE estado = 'PENDIENTE' AND datetime(fecha || ' ' || hora_inicio) <= datetime('now','localtime')`);
    }

    /* ---------- Autenticación ---------- */
    function login(correo, password) {
      if (!correo || !password) throw new AppError('DATOS_INCOMPLETOS', 422);
      const u = db.get('SELECT * FROM usuario WHERE correo = ?', [String(correo).trim()]);
      if (!u || sha256(u.salt + password) !== u.password_hash) throw new AppError('CREDENCIALES', 401);
      if (!u.activo) throw new AppError('USUARIO_INACTIVO', 403);
      return publicUser(u);
    }
    function usuarioPorId(id) { return publicUser(db.get('SELECT * FROM usuario WHERE id = ?', [id])); }

    function crearSesion(usuarioId, horas) {
      const token = sha256(usuarioId + ':' + Math.random() + ':' + Date.now()) + nuevoCodigo('T');
      db.run(`INSERT INTO sesion (token, usuario_id, expira_en) VALUES (?, ?, datetime('now','localtime', ?))`,
        [token, usuarioId, `+${horas || 8} hours`]);
      return token;
    }
    function usuarioPorToken(token) {
      if (!token) return null;
      const s = db.get(`SELECT usuario_id FROM sesion WHERE token = ? AND expira_en > datetime('now','localtime')`, [token]);
      return s ? usuarioPorId(s.usuario_id) : null;
    }
    function cerrarSesion(token) { db.run('DELETE FROM sesion WHERE token = ?', [token]); }

    /* ---------- Usuario.puedeReservar() ---------- */
    function activasFuturas(usuarioId) {
      return db.get(`SELECT COUNT(*) AS n FROM reserva WHERE usuario_id = ? AND estado IN ('PENDIENTE','CONFIRMADA')
                      AND datetime(fecha || ' ' || hora_fin) > datetime('now','localtime')`, [usuarioId]).n;
    }
    function puedeReservar(user) {
      if (!user || !user.activo) return { ok: false, motivo: MENSAJES.USUARIO_INACTIVO };
      if (user.rol === 'ESTUDIANTE') {
        const max = Number(param('MAX_RESERVAS_ACTIVAS_ESTUD') || 3);
        const n = activasFuturas(user.id);
        if (n >= max) return { ok: false, motivo: MENSAJES.LIMITE_RESERVAS, activas: n, maximo: max };
        return { ok: true, activas: n, maximo: max };
      }
      return { ok: true, activas: activasFuturas(user.id), maximo: null };
    }

    /* ---------- Edificios y recursos (HU08, HU09) ---------- */
    const edificios = () => db.all('SELECT * FROM edificio ORDER BY nombre');

    function listRecursos(q) {
      q = q || {};
      const where = [], p = [];
      if (q.tipo) { where.push('tipo = ?'); p.push(q.tipo); }
      if (q.soloDisponibles) where.push(`estado = 'DISPONIBLE'`);
      if (q.edificio) { where.push('edificio_id = ?'); p.push(Number(q.edificio)); }
      return db.all(`SELECT * FROM v_recurso ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY tipo, codigo`, p);
    }
    function getRecurso(id) {
      const r = db.get('SELECT * FROM v_recurso WHERE id = ?', [Number(id)]);
      if (!r) throw new AppError('NO_ENCONTRADO', 404);
      return r;
    }

    function validarRecurso(d) {
      const errores = [];
      const req = (cond, campo, msg) => { if (!cond) errores.push({ campo, mensaje: msg }); };
      req(d.codigo && /^[A-Za-z]{3}-[A-Za-z0-9]{3,6}$/.test(d.codigo), 'codigo', 'Código con formato AAA-000 (por ejemplo LAB-A103).');
      req(d.nombre && String(d.nombre).trim().length >= 3, 'nombre', 'El nombre debe tener al menos 3 caracteres.');
      req(['LABORATORIO', 'SALA'].indexOf(d.tipo) !== -1, 'tipo', 'Selecciona si es laboratorio o sala.');
      const cap = Number(d.capacidad);
      req(Number.isInteger(cap) && cap >= 1 && cap <= 500, 'capacidad', 'La capacidad debe ser un entero entre 1 y 500.');
      req(d.ubicacion && String(d.ubicacion).trim().length >= 2, 'ubicacion', 'Indica la ubicación (piso, ala).');
      req(d.edificio_id && db.get('SELECT 1 AS x FROM edificio WHERE id = ?', [Number(d.edificio_id)]), 'edificio_id', 'Selecciona un edificio válido.');
      req(!d.estado || ['DISPONIBLE', 'EN_MANTENIMIENTO', 'INACTIVO'].indexOf(d.estado) !== -1, 'estado', 'Estado no válido.');
      if (d.tipo === 'LABORATORIO') req(d.tipo_lab && String(d.tipo_lab).trim(), 'tipo_lab', 'Indica el tipo de laboratorio.');
      return errores;
    }

    function guardarRecurso(user, d, id) {
      requiere(user, 'ADMINISTRADOR');
      d = Object.assign({}, d);
      if (d.codigo) d.codigo = String(d.codigo).trim().toUpperCase();
      const errores = validarRecurso(d);
      if (errores.length) throw new AppError('VALIDACION', 422, { errores, message: errores[0].mensaje });
      try {
        return db.tx(() => {
          let rid = id ? Number(id) : null;
          if (rid) {
            getRecurso(rid);
            db.run(`UPDATE recurso SET codigo=?, nombre=?, tipo=?, capacidad=?, ubicacion=?, edificio_id=?, estado=? WHERE id=?`,
              [d.codigo, d.nombre.trim(), d.tipo, Number(d.capacidad), d.ubicacion.trim(), Number(d.edificio_id), d.estado || 'DISPONIBLE', rid]);
            db.run('DELETE FROM laboratorio WHERE recurso_id = ?', [rid]);
            db.run('DELETE FROM sala WHERE recurso_id = ?', [rid]);
          } else {
            rid = Number(db.run(`INSERT INTO recurso (codigo, nombre, tipo, capacidad, ubicacion, edificio_id, estado) VALUES (?,?,?,?,?,?,?)`,
              [d.codigo, d.nombre.trim(), d.tipo, Number(d.capacidad), d.ubicacion.trim(), Number(d.edificio_id), d.estado || 'DISPONIBLE']).lastInsertRowid);
          }
          if (d.tipo === 'LABORATORIO')
            db.run('INSERT INTO laboratorio (recurso_id, tipo_lab, equipamiento, requiere_supervisor) VALUES (?,?,?,?)',
              [rid, String(d.tipo_lab).trim(), String(d.equipamiento || '').trim(), d.requiere_supervisor ? 1 : 0]);
          else
            db.run('INSERT INTO sala (recurso_id, tiene_proyector, distribucion) VALUES (?,?,?)',
              [rid, d.tiene_proyector ? 1 : 0, String(d.distribucion || 'Mesa central').trim()]);
          const afectadas = db.all(`SELECT codigo, fecha, hora_inicio, asistentes FROM reserva WHERE recurso_id = ?
                                     AND estado IN ('PENDIENTE','CONFIRMADA') AND fecha >= date('now','localtime')
                                     AND (? <> 'DISPONIBLE' OR asistentes > ?)`, [rid, d.estado || 'DISPONIBLE', Number(d.capacidad)]);
          return { recurso: getRecurso(rid), afectadas };
        });
      } catch (e) { throw mapDbError(e); }
    }

    // Administrador.bloquearRecurso(r)
    function cambiarEstadoRecurso(user, id, estado) {
      requiere(user, 'ADMINISTRADOR');
      const r = getRecurso(id);
      return guardarRecurso(user, Object.assign({}, r, { estado }), id);
    }

    /* ---------- Calendario (HU01, HU02) ---------- */
    function calendario(user, recursoId, desde, hasta) {
      requiere(user);
      finalizarVencidas();
      const recurso = getRecurso(recursoId);
      if (!RE_FECHA.test(desde || '')) desde = isoDate(now());
      if (!RE_FECHA.test(hasta || '')) hasta = addDays(desde, 6);
      const esAdmin = user.rol === 'ADMINISTRADOR';
      const filas = db.all(`SELECT o.*, r.codigo, r.motivo, r.asistentes, u.nombre AS usuario
                              FROM v_ocupacion_publica o
                              JOIN reserva r ON r.id = o.id
                              JOIN usuario u ON u.id = o.usuario_id
                             WHERE o.recurso_id = ? AND o.fecha BETWEEN ? AND ?
                             ORDER BY o.fecha, o.hora_inicio`, [recurso.id, desde, hasta]);
      // HU02: se ocultan datos personales de reservas ajenas
      const reservas = filas.map(f => {
        const propia = f.usuario_id === user.id;
        const base = { id: f.id, fecha: f.fecha, hora_inicio: f.hora_inicio, hora_fin: f.hora_fin, estado: f.estado,
          rol_solicitante: f.rol_solicitante, propia };
        if (propia || esAdmin) Object.assign(base, { codigo: f.codigo, motivo: f.motivo, asistentes: f.asistentes });
        if (esAdmin) base.usuario = f.usuario;
        return base;
      });
      return { recurso, desde, hasta, apertura: param('HORA_APERTURA'), cierre: param('HORA_CIERRE'), reservas };
    }

    // Calendario.horariosLibres(dia)
    function horariosLibres(recursoId, fecha) {
      const recurso = getRecurso(recursoId);
      if (!RE_FECHA.test(fecha || '')) throw new AppError('DATOS_INCOMPLETOS', 422);
      const ap = toMin(param('HORA_APERTURA')), ci = toMin(param('HORA_CIERRE'));
      if (recurso.estado !== 'DISPONIBLE' || parseISO(fecha).getDay() === 0) return [];
      let inicio = ap;
      const ahora = now();
      if (fecha === isoDate(ahora)) inicio = Math.max(ap, Math.ceil((ahora.getHours() * 60 + ahora.getMinutes()) / 30) * 30);
      if (fecha < isoDate(ahora)) return [];
      const ocup = db.all(`SELECT hora_inicio, hora_fin FROM reserva WHERE recurso_id = ? AND fecha = ?
                            AND estado IN ('PENDIENTE','CONFIRMADA') ORDER BY hora_inicio`, [recurso.id, fecha]);
      const libres = [];
      let cursor = inicio;
      ocup.forEach(o => {
        const a = toMin(o.hora_inicio), b = toMin(o.hora_fin);
        if (a > cursor) libres.push({ desde: fromMin(cursor), hasta: fromMin(a) });
        cursor = Math.max(cursor, b);
      });
      if (cursor < ci) libres.push({ desde: fromMin(cursor), hasta: fromMin(ci) });
      return libres.filter(l => toMin(l.hasta) - toMin(l.desde) >= 30);
    }

    /* ---------- ValidadorConflictos ---------- */
    function existeSolapamiento(r, ignorarId) {
      return db.all(`SELECT r.id, r.hora_inicio, r.hora_fin, r.estado, u.rol AS rol_solicitante, r.usuario_id
                       FROM reserva r JOIN usuario u ON u.id = r.usuario_id
                      WHERE r.recurso_id = ? AND r.fecha = ? AND r.estado IN ('PENDIENTE','CONFIRMADA')
                        AND r.hora_inicio < ? AND ? < r.hora_fin AND r.id <> ?`,
        [Number(r.recurso_id), r.fecha, r.hora_fin, r.hora_inicio, ignorarId || 0]);
    }

    function validar(user, r, o) {
      o = o || {};
      const errores = [];
      const add = (code, campo) => errores.push({ code, campo, mensaje: MENSAJES[code] });
      if (!r || !r.recurso_id || !r.fecha || !r.hora_inicio || !r.hora_fin || !r.motivo || String(r.motivo).trim().length < 3) {
        add('DATOS_INCOMPLETOS'); return { ok: false, errores, conflictos: [] };
      }
      if (!RE_FECHA.test(r.fecha)) { add('DATOS_INCOMPLETOS', 'fecha'); return { ok: false, errores, conflictos: [] }; }
      if (!RE_HORA.test(r.hora_inicio) || !RE_HORA.test(r.hora_fin)) { add('BLOQUE_INVALIDO', 'hora_inicio'); return { ok: false, errores, conflictos: [] }; }
      if (toMin(r.hora_inicio) % 30 || toMin(r.hora_fin) % 30) add('BLOQUE_INVALIDO', 'hora_inicio');
      if (r.hora_fin <= r.hora_inicio) add('HORA_INVALIDA', 'hora_fin');
      // fueraDeHorario()
      if (r.hora_inicio < param('HORA_APERTURA') || r.hora_fin > param('HORA_CIERRE') || parseISO(r.fecha).getDay() === 0) add('FUERA_DE_HORARIO', 'hora_inicio');
      const ahora = now();
      if (`${r.fecha} ${r.hora_inicio}` < `${isoDate(ahora)} ${hhmm(ahora)}`) add('FECHA_PASADA', 'fecha');
      let recurso;
      try { recurso = getRecurso(r.recurso_id); } catch (e) { add('NO_ENCONTRADO', 'recurso_id'); return { ok: false, errores, conflictos: [] }; }
      if (recurso.estado !== 'DISPONIBLE') add('RECURSO_NO_DISPONIBLE', 'recurso_id');
      // excedeCapacidad()
      const asis = Number(r.asistentes || 1);
      if (!Number.isInteger(asis) || asis < 1) add('VALIDACION', 'asistentes');
      else if (asis > recurso.capacidad) add('EXCEDE_CAPACIDAD', 'asistentes');
      if (user && user.rol === 'ESTUDIANTE') {
        if (toMin(r.hora_fin) - toMin(r.hora_inicio) > Number(param('MAX_MINUTOS_ESTUDIANTE') || 180)) add('DURACION_MAXIMA', 'hora_fin');
        if (!o.omitirLimite) { const pr = puedeReservar(user); if (!pr.ok) add('LIMITE_RESERVAS'); }
      }
      // existeSolapamiento() — HU07
      const conflictos = existeSolapamiento(r).map(c => ({
        hora_inicio: c.hora_inicio, hora_fin: c.hora_fin, estado: c.estado, rol_solicitante: c.rol_solicitante,
        propia: user ? c.usuario_id === user.id : false, id: c.id
      }));
      if (conflictos.length) add('CONFLICTO_HORARIO', 'hora_inicio');
      return { ok: errores.length === 0, errores, conflictos, recurso };
    }

    function detalleReserva(id) {
      return db.get('SELECT * FROM v_reserva_detalle WHERE id = ?', [Number(id)]);
    }

    function notificar(usuarioId, mensaje) {
      db.run('INSERT INTO notificacion (usuario_id, mensaje) VALUES (?, ?)', [usuarioId, mensaje]);
    }

    function codigoUnico() {
      let c;
      do { c = nuevoCodigo('RS'); } while (db.get('SELECT 1 AS x FROM reserva WHERE codigo = ?', [c]));
      return c;
    }

    /* ---------- GestorReservas.crearReserva (HU03, HU06, HU07) ---------- */
    function crearReserva(user, data) {
      requiere(user);
      finalizarVencidas();
      const r = {
        recurso_id: Number(data.recurso_id), fecha: data.fecha, hora_inicio: data.hora_inicio, hora_fin: data.hora_fin,
        motivo: String(data.motivo || '').trim(), asistentes: Number(data.asistentes || 1)
      };
      const v = validar(user, r);
      if (!v.ok) throw new AppError(v.errores[0].code, v.errores[0].code === 'CONFLICTO_HORARIO' ? 409 : 422,
        { errores: v.errores, conflictos: v.conflictos });
      const requiereAprobacion = user.rol === 'ESTUDIANTE' && v.recurso.tipo === 'LABORATORIO' && !!v.recurso.requiere_supervisor;
      const estado = requiereAprobacion ? 'PENDIENTE' : 'CONFIRMADA';
      try {
        return db.tx(() => {
          const codigo = codigoUnico();
          const id = db.run(`INSERT INTO reserva (codigo, usuario_id, recurso_id, fecha, hora_inicio, hora_fin, motivo, asistentes, estado)
                             VALUES (?,?,?,?,?,?,?,?,?)`,
            [codigo, user.id, r.recurso_id, r.fecha, r.hora_inicio, r.hora_fin, r.motivo, r.asistentes, estado]).lastInsertRowid;
          const msg = requiereAprobacion
            ? `Tu reserva ${codigo} en ${v.recurso.nombre} quedó pendiente: el laboratorio requiere supervisor y debe aprobarla la administración.`
            : `Tu reserva ${codigo} en ${v.recurso.nombre} para el ${fechaCL(r.fecha)} de ${r.hora_inicio} a ${r.hora_fin} está confirmada.`;
          notificar(user.id, msg);
          return { reserva: detalleReserva(id), mensaje: msg, requiereAprobacion };
        });
      } catch (e) { throw mapDbError(e); }
    }

    /* ---------- HU05: reserva docente (bloques completos o recurrentes, con prioridad) ---------- */
    function planDocente(user, data) {
      requiere(user, 'DOCENTE', 'ADMINISTRADOR');
      const semanas = Math.max(1, Math.min(Number(data.semanas || 1), Number(param('MAX_SEMANAS_RECURRENCIA') || 16)));
      const ocurrencias = [];
      for (let i = 0; i < semanas; i++) {
        const r = {
          recurso_id: Number(data.recurso_id), fecha: data.fecha ? addDays(data.fecha, 7 * i) : data.fecha,
          hora_inicio: data.hora_inicio, hora_fin: data.hora_fin, motivo: data.motivo, asistentes: Number(data.asistentes || 1)
        };
        const v = validar(user, r);
        const otros = v.errores.filter(e => e.code !== 'CONFLICTO_HORARIO');
        const duros = v.conflictos.filter(c => c.rol_solicitante !== 'ESTUDIANTE');
        const desplazables = v.conflictos.filter(c => c.rol_solicitante === 'ESTUDIANTE');
        let estado = 'LIBRE';
        if (otros.length) estado = 'ERROR';
        else if (duros.length) estado = 'CONFLICTO';
        else if (desplazables.length) estado = 'DESPLAZA';
        ocurrencias.push({ fecha: r.fecha, estado, errores: otros, conflictos: v.conflictos, desplazables: desplazables.map(c => c.id), datos: r });
        if (!data.fecha) break;
      }
      return { semanas, ocurrencias };
    }

    function crearReservaDocente(user, data) {
      const plan = planDocente(user, data);
      if (data.simular) return plan;
      const aplicarPrioridad = !!data.aplicarPrioridad;
      const serie = plan.semanas > 1 ? nuevoCodigo('SER') : null;
      try {
        return db.tx(() => {
          const creadas = [], omitidas = [], desplazadas = [];
          plan.ocurrencias.forEach(o => {
            if (o.estado === 'ERROR' || o.estado === 'CONFLICTO' || (o.estado === 'DESPLAZA' && !aplicarPrioridad)) {
              omitidas.push({ fecha: o.fecha, motivo: o.estado === 'DESPLAZA' ? 'Horario ocupado por una reserva estudiantil (prioridad no aplicada)'
                : (o.errores[0] ? o.errores[0].mensaje : MENSAJES.CONFLICTO_HORARIO) });
              return;
            }
            const codigo = codigoUnico();
            if (o.estado === 'DESPLAZA') {
              o.desplazables.forEach(rid => {
                const d = detalleReserva(rid);
                db.run(`UPDATE reserva SET estado = 'CANCELADA', tipo_cancelacion = 'PRIORIDAD_DOCENTE', motivo_cancelacion = ? WHERE id = ?`,
                  [`Desplazada por actividad docente ${codigo}`, rid]);
                notificar(d.usuario_id, `Tu reserva ${d.codigo} del ${fechaCL(d.fecha)} (${d.hora_inicio}-${d.hora_fin}) en ${d.recurso} fue cancelada: el espacio se asignó a una actividad docente, que tiene prioridad. Revisa los horarios libres para reagendar.`);
                desplazadas.push({ codigo: d.codigo, fecha: d.fecha, hora_inicio: d.hora_inicio, hora_fin: d.hora_fin });
              });
            }
            const id = db.run(`INSERT INTO reserva (codigo, usuario_id, recurso_id, fecha, hora_inicio, hora_fin, motivo, asistentes, estado, serie_id)
                               VALUES (?,?,?,?,?,?,?,?, 'CONFIRMADA', ?)`,
              [codigo, user.id, o.datos.recurso_id, o.fecha, o.datos.hora_inicio, o.datos.hora_fin, String(o.datos.motivo).trim(), o.datos.asistentes, serie]).lastInsertRowid;
            creadas.push(detalleReserva(id));
          });
          if (creadas.length) notificar(user.id, `Se registraron ${creadas.length} reserva(s) docentes${serie ? ' (serie ' + serie + ')' : ''}.`);
          return { serie, creadas, omitidas, desplazadas };
        });
      } catch (e) { throw mapDbError(e); }
    }

    /* ---------- Consultas de reservas (HU10, HU11) ---------- */
    function filtrosFecha(q, where, p) {
      if (q.desde && RE_FECHA.test(q.desde)) { where.push('fecha >= ?'); p.push(q.desde); }
      if (q.hasta && RE_FECHA.test(q.hasta)) { where.push('fecha <= ?'); p.push(q.hasta); }
    }
    function misReservas(user, q) {
      requiere(user);
      finalizarVencidas();
      q = q || {};
      const where = ['usuario_id = ?'], p = [user.id];
      filtrosFecha(q, where, p);
      if (q.estado) { where.push('estado = ?'); p.push(q.estado); }
      const filas = db.all(`SELECT * FROM v_reserva_detalle WHERE ${where.join(' AND ')} ORDER BY fecha DESC, hora_inicio DESC`, p);
      const minHoras = Number(param('HORAS_MIN_CANCELACION') || 2);
      const ahora = now().getTime();
      return filas.map(f => Object.assign(f, {
        cancelable: (f.estado === 'PENDIENTE' || f.estado === 'CONFIRMADA') &&
          (new Date(f.fecha + 'T' + f.hora_inicio + ':00').getTime() - ahora) / 3600000 >= minHoras
      }));
    }

    function adminReservas(user, q) {
      requiere(user, 'ADMINISTRADOR');
      finalizarVencidas();
      q = q || {};
      const where = [], p = [];
      filtrosFecha(q, where, p);
      if (q.estado) { where.push('estado = ?'); p.push(q.estado); }
      if (q.recurso_id) { where.push('recurso_id = ?'); p.push(Number(q.recurso_id)); }
      if (q.rol) { where.push('rol = ?'); p.push(q.rol); }
      if (q.q) { where.push('(codigo LIKE ? OR usuario LIKE ? OR motivo LIKE ? OR recurso LIKE ?)'); const s = `%${q.q}%`; p.push(s, s, s, s); }
      return db.all(`SELECT * FROM v_reserva_detalle ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY fecha DESC, hora_inicio`, p);
    }

    function reservasCSV(user, q) {
      const filas = adminReservas(user, q);
      const cols = ['codigo', 'fecha', 'hora_inicio', 'hora_fin', 'recurso_codigo', 'recurso', 'usuario', 'rol', 'asistentes', 'estado', 'motivo'];
      const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      return [cols.join(';')].concat(filas.map(f => cols.map(c => esc(c === 'fecha' ? fechaCL(f[c]) : f[c])).join(';'))).join('\r\n');
    }

    function estadisticas(user, q) {
      requiere(user, 'ADMINISTRADOR');
      finalizarVencidas();
      q = q || {};
      const desde = RE_FECHA.test(q.desde || '') ? q.desde : addDays(isoDate(now()), -30);
      const hasta = RE_FECHA.test(q.hasta || '') ? q.hasta : addDays(isoDate(now()), 30);
      const porEstado = db.all(`SELECT estado, COUNT(*) AS n FROM reserva WHERE fecha BETWEEN ? AND ? GROUP BY estado`, [desde, hasta]);
      const porRecurso = db.all(`SELECT rc.codigo, rc.nombre, COUNT(r.id) AS reservas,
              COALESCE(SUM(CASE WHEN r.estado IN ('CONFIRMADA','FINALIZADA','PENDIENTE')
                THEN ((CAST(substr(r.hora_fin,1,2) AS INTEGER)*60 + CAST(substr(r.hora_fin,4,2) AS INTEGER)) -
                      (CAST(substr(r.hora_inicio,1,2) AS INTEGER)*60 + CAST(substr(r.hora_inicio,4,2) AS INTEGER))) END), 0) / 60.0 AS horas
            FROM recurso rc LEFT JOIN reserva r ON r.recurso_id = rc.id AND r.fecha BETWEEN ? AND ?
           GROUP BY rc.id ORDER BY horas DESC`, [desde, hasta]);
      const porRol = db.all(`SELECT u.rol, COUNT(*) AS n FROM reserva r JOIN usuario u ON u.id = r.usuario_id
                              WHERE r.fecha BETWEEN ? AND ? GROUP BY u.rol`, [desde, hasta]);
      const pendientes = db.get(`SELECT COUNT(*) AS n FROM reserva WHERE estado = 'PENDIENTE'`).n;
      const hoy = db.get(`SELECT COUNT(*) AS n FROM reserva WHERE fecha = date('now','localtime') AND estado IN ('CONFIRMADA','PENDIENTE','FINALIZADA')`).n;
      return { desde, hasta, porEstado, porRecurso, porRol, pendientes, hoy };
    }

    /* ---------- GestorReservas.cancelarReserva (HU04) ---------- */
    function cancelarReserva(user, id, motivo) {
      requiere(user);
      finalizarVencidas();
      const r = detalleReserva(id);
      if (!r) throw new AppError('NO_ENCONTRADO', 404);
      const esAdmin = user.rol === 'ADMINISTRADOR';
      if (!esAdmin && r.usuario_id !== user.id) throw new AppError('PROHIBIDO', 403);
      if (r.estado !== 'PENDIENTE' && r.estado !== 'CONFIRMADA') throw new AppError('TRANSICION_INVALIDA', 409);
      const tipo = esAdmin && r.usuario_id !== user.id ? 'ADMINISTRADOR' : 'USUARIO';
      if (tipo === 'USUARIO') {
        const horas = (new Date(r.fecha + 'T' + r.hora_inicio + ':00').getTime() - now().getTime()) / 3600000;
        if (horas < Number(param('HORAS_MIN_CANCELACION') || 2)) throw new AppError('CANCELACION_FUERA_DE_PLAZO', 409);
      }
      try {
        return db.tx(() => {
          db.run(`UPDATE reserva SET estado = 'CANCELADA', tipo_cancelacion = ?, motivo_cancelacion = ? WHERE id = ?`,
            [tipo, String(motivo || (tipo === 'USUARIO' ? 'Cancelada por el usuario' : 'Cancelada por administración')).slice(0, 200), r.id]);
          if (tipo === 'ADMINISTRADOR')
            notificar(r.usuario_id, `La administración canceló tu reserva ${r.codigo} del ${fechaCL(r.fecha)} en ${r.recurso}.`);
          return { reserva: detalleReserva(r.id), mensaje: `Reserva ${r.codigo} cancelada. El horario quedó libre.` };
        });
      } catch (e) { throw mapDbError(e); }
    }

    function confirmarReserva(user, id) {
      requiere(user, 'ADMINISTRADOR');
      finalizarVencidas();
      const r = detalleReserva(id);
      if (!r) throw new AppError('NO_ENCONTRADO', 404);
      if (r.estado !== 'PENDIENTE') throw new AppError('TRANSICION_INVALIDA', 409);
      try {
        db.run(`UPDATE reserva SET estado = 'CONFIRMADA' WHERE id = ?`, [r.id]);
        notificar(r.usuario_id, `La administración aprobó tu reserva ${r.codigo} del ${fechaCL(r.fecha)} en ${r.recurso}.`);
        return { reserva: detalleReserva(r.id), mensaje: `Reserva ${r.codigo} confirmada.` };
      } catch (e) { throw mapDbError(e); }
    }

    /* ---------- Notificaciones ---------- */
    function notificaciones(user) {
      requiere(user);
      return db.all('SELECT * FROM notificacion WHERE usuario_id = ? ORDER BY id DESC LIMIT 30', [user.id]);
    }
    function marcarLeidas(user) {
      requiere(user);
      db.run('UPDATE notificacion SET leida = 1 WHERE usuario_id = ?', [user.id]);
      return { ok: true };
    }

    return {
      sha256, login, usuarioPorId, crearSesion, usuarioPorToken, cerrarSesion, puedeReservar, params,
      edificios, listRecursos, getRecurso, guardarRecurso, cambiarEstadoRecurso,
      calendario, horariosLibres, validar, crearReserva, planDocente, crearReservaDocente,
      misReservas, adminReservas, reservasCSV, estadisticas, cancelarReserva, confirmarReserva,
      notificaciones, marcarLeidas, finalizarVencidas
    };
  }

  return { createService, AppError, MENSAJES, sha256, fechaCL, isoDate, addDays };
});
