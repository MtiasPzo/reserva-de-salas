/* =====================================================================
 *  Pruebas automatizadas (QA) — node --test
 *  Cubren los criterios de aceptación de HU01–HU11 y las reglas del DoD.
 * ===================================================================== */
'use strict';
process.env.TZ = 'America/Santiago';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');

let server, base, ctx;
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function futuro(dias) {                       // fecha futura que no cae domingo
  const d = new Date(); d.setDate(d.getDate() + dias);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return iso(d);
}
function domingo(diasMin) { const d = new Date(); d.setDate(d.getDate() + diasMin); while (d.getDay() !== 0) d.setDate(d.getDate() + 1); return iso(d); }

async function req(method, path, body, token) {
  const r = await fetch(base + path, {
    method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
}
async function login(correo) {
  const r = await req('POST', '/api/login', { correo, password: 'Reserva2026!' });
  assert.equal(r.status, 200);
  return r.body.token;
}
const T = {};

test.before(async () => {
  ctx = createApp({ dbFile: ':memory:' });
  await new Promise(res => { server = ctx.app.listen(0, res); });
  base = `http://127.0.0.1:${server.address().port}`;
  T.ana = await login('ana.soto@inacapmail.cl');
  T.diego = await login('diego.munoz@inacapmail.cl');
  T.vale = await login('valentina.reyes@inacapmail.cl');
  T.paula = await login('pfernandez@inacap.cl');
  T.rodrigo = await login('rsaavedra@inacap.cl');
  T.admin = await login('admin@inacap.cl');
});
test.after(() => { server.close(); ctx.db.close(); });

test('PR-01 Autenticación: credenciales válidas e inválidas; rutas protegidas', async () => {
  assert.equal((await req('POST', '/api/login', { correo: 'ana.soto@inacapmail.cl', password: 'mala' })).status, 401);
  assert.equal((await req('GET', '/api/recursos')).status, 401);
  const me = await req('GET', '/api/me', null, T.ana);
  assert.equal(me.body.usuario.rol, 'ESTUDIANTE');
  assert.equal(me.body.usuario.matricula, '2024-11872');
});

test('PR-02 HU01 Calendario muestra horarios ocupados del recurso', async () => {
  const r = await req('GET', `/api/recursos/1/calendario?desde=${futuro(0)}&hasta=${futuro(8)}`, null, T.diego);
  assert.equal(r.status, 200);
  assert.equal(r.body.apertura, '08:00');
  assert.ok(r.body.reservas.length >= 2);
});

test('PR-03 HU02 Reservas ajenas no exponen datos personales', async () => {
  const r = await req('GET', `/api/recursos/1/calendario?desde=${futuro(0)}&hasta=${futuro(8)}`, null, T.diego);
  for (const x of r.body.reservas.filter(x => !x.propia)) {
    assert.equal(x.usuario, undefined); assert.equal(x.motivo, undefined); assert.equal(x.codigo, undefined);
    assert.ok(['ESTUDIANTE', 'DOCENTE', 'ADMINISTRADOR'].includes(x.rol_solicitante));
  }
  const a = await req('GET', `/api/recursos/1/calendario?desde=${futuro(0)}&hasta=${futuro(8)}`, null, T.admin);
  assert.ok(a.body.reservas.every(x => x.usuario));            // el administrador sí ve el detalle
});

const F = futuro(14);
test('PR-04 HU03 + HU06 Crear reserva: se guarda, bloquea el horario y entrega código único', async () => {
  const r = await req('POST', '/api/reservas', { recurso_id: 5, fecha: F, hora_inicio: '10:00', hora_fin: '11:30', asistentes: 4, motivo: 'Estudio de Base de Datos' }, T.ana);
  assert.equal(r.status, 201);
  assert.match(r.body.reserva.codigo, /^RS-[A-Z2-9]{6}$/);
  assert.equal(r.body.reserva.estado, 'CONFIRMADA');
  assert.match(r.body.mensaje, /confirmada/);
  const libres = await req('GET', `/api/recursos/5/libres?fecha=${F}`, null, T.diego);
  assert.ok(!libres.body.some(l => l.desde <= '10:00' && l.hasta >= '11:30'));
  const n = await req('GET', '/api/notificaciones', null, T.ana);
  assert.ok(n.body.some(x => x.mensaje.includes(r.body.reserva.codigo)));
});

test('PR-05 HU07 Rechaza reserva duplicada o solapada en la misma sala', async () => {
  const dup = await req('POST', '/api/reservas', { recurso_id: 5, fecha: F, hora_inicio: '10:00', hora_fin: '11:30', asistentes: 2, motivo: 'Duplicada' }, T.diego);
  assert.equal(dup.status, 409); assert.equal(dup.body.error, 'CONFLICTO_HORARIO');
  assert.equal(dup.body.conflictos[0].hora_inicio, '10:00');
  const parcial = await req('POST', '/api/reservas', { recurso_id: 5, fecha: F, hora_inicio: '11:00', hora_fin: '12:00', asistentes: 2, motivo: 'Parcial' }, T.diego);
  assert.equal(parcial.status, 409);
  const adyacente = await req('POST', '/api/reservas', { recurso_id: 5, fecha: F, hora_inicio: '11:30', hora_fin: '12:30', asistentes: 2, motivo: 'Contigua' }, T.diego);
  assert.equal(adyacente.status, 201, 'un bloque contiguo sí debe permitirse');
  const otraSala = await req('POST', '/api/reservas', { recurso_id: 6, fecha: F, hora_inicio: '10:00', hora_fin: '11:00', asistentes: 2, motivo: 'Otra sala' }, T.paula);
  assert.equal(otraSala.status, 201, 'mismo horario en otra sala sí debe permitirse');
});

test('PR-06 HU07 El trigger de la BD bloquea el solapamiento aunque se omita la API', () => {
  assert.throws(() => ctx.db.run(`INSERT INTO reserva (codigo, usuario_id, recurso_id, fecha, hora_inicio, hora_fin, motivo, asistentes)
                                   VALUES ('RS-TEST01', 6, 5, ?, '10:30', '11:00', 'Directo en BD', 1)`, [F]), /CONFLICTO_HORARIO/);
});

test('PR-07 ValidadorConflictos: capacidad, horario de atención, domingo y fecha pasada', async () => {
  const base = { recurso_id: 6, fecha: futuro(15), hora_inicio: '09:00', hora_fin: '10:00', asistentes: 2, motivo: 'Prueba' };
  assert.equal((await req('POST', '/api/reservas', Object.assign({}, base, { asistentes: 7 }), T.vale)).body.error, 'EXCEDE_CAPACIDAD');
  assert.equal((await req('POST', '/api/reservas', Object.assign({}, base, { hora_inicio: '07:00', hora_fin: '08:30' }), T.vale)).body.error, 'FUERA_DE_HORARIO');
  assert.equal((await req('POST', '/api/reservas', Object.assign({}, base, { hora_fin: '22:30', hora_inicio: '21:00' }), T.vale)).body.error, 'FUERA_DE_HORARIO');
  assert.equal((await req('POST', '/api/reservas', Object.assign({}, base, { fecha: domingo(3) }), T.vale)).body.error, 'FUERA_DE_HORARIO');
  assert.equal((await req('POST', '/api/reservas', Object.assign({}, base, { fecha: '2026-01-05' }), T.vale)).body.error, 'FECHA_PASADA');
  assert.equal((await req('POST', '/api/reservas', Object.assign({}, base, { hora_inicio: '09:15' }), T.vale)).body.error, 'BLOQUE_INVALIDO');
  assert.equal((await req('POST', '/api/reservas', Object.assign({}, base, { hora_fin: '08:30' }), T.vale)).body.error, 'HORA_INVALIDA');
});

test('PR-08 Usuario.puedeReservar(): máximo 3 reservas activas y 3 horas por reserva (estudiante)', async () => {
  const largo = await req('POST', '/api/reservas', { recurso_id: 7, fecha: futuro(16), hora_inicio: '08:00', hora_fin: '11:30', asistentes: 2, motivo: 'Muy larga' }, T.diego);
  assert.equal(largo.body.error, 'DURACION_MAXIMA');
  // Diego ya tiene 2 activas de la carga inicial + 2 de PR-05 → supera el límite
  const extra = await req('POST', '/api/reservas', { recurso_id: 7, fecha: futuro(16), hora_inicio: '08:00', hora_fin: '09:00', asistentes: 2, motivo: 'Extra' }, T.diego);
  assert.equal(extra.status, 422); assert.equal(extra.body.error, 'LIMITE_RESERVAS');
});

let pendienteId;
test('PR-09 Laboratorio con supervisor: reserva estudiantil queda PENDIENTE y el administrador la aprueba', async () => {
  const r = await req('POST', '/api/reservas', { recurso_id: 2, fecha: futuro(17), hora_inicio: '15:00', hora_fin: '16:00', asistentes: 3, motivo: 'Práctica de ruteo' }, T.ana);
  assert.equal(r.status, 201); assert.equal(r.body.reserva.estado, 'PENDIENTE'); assert.equal(r.body.requiereAprobacion, true);
  pendienteId = r.body.reserva.id;
  assert.equal((await req('POST', `/api/reservas/${pendienteId}/confirmar`, {}, T.ana)).status, 403);
  const ok = await req('POST', `/api/reservas/${pendienteId}/confirmar`, {}, T.admin);
  assert.equal(ok.body.reserva.estado, 'CONFIRMADA');
});

test('PR-10 HU04 Cancelar con más de 2 h de anticipación libera el horario', async () => {
  const mias = await req('GET', '/api/reservas/mias', null, T.ana);
  const r = mias.body.find(x => x.fecha === F && x.estado === 'CONFIRMADA');
  assert.equal(r.cancelable, true);
  assert.equal((await req('POST', `/api/reservas/${r.id}/cancelar`, {}, T.diego)).status, 403, 'no puede cancelar una reserva ajena');
  const c = await req('POST', `/api/reservas/${r.id}/cancelar`, { motivo: 'Cambio de planes' }, T.ana);
  assert.equal(c.status, 200); assert.equal(c.body.reserva.estado, 'CANCELADA');
  const libres = await req('GET', `/api/recursos/5/libres?fecha=${F}`, null, T.ana);
  assert.ok(libres.body.some(l => l.desde <= '10:00' && l.hasta >= '11:00'));
  const otra = await req('POST', `/api/reservas/${r.id}/cancelar`, {}, T.ana);
  assert.equal(otra.body.error, 'TRANSICION_INVALIDA');
});

test('PR-11 HU04 No permite cancelar dentro del plazo mínimo (servicio y trigger)', async () => {
  // Para no depender de la hora del reloj, se amplía temporalmente el plazo mínimo
  // (parámetro HORAS_MIN_CANCELACION) a 100 000 h: cualquier reserva futura queda "dentro de las 2 h".
  const r = await req('POST', '/api/reservas', { recurso_id: 6, fecha: futuro(18), hora_inicio: '16:00', hora_fin: '17:00', asistentes: 2, motivo: 'Plazo de cancelación' }, T.paula);
  assert.equal(r.status, 201);
  ctx.db.run(`UPDATE parametro SET valor = '100000' WHERE clave = 'HORAS_MIN_CANCELACION'`);
  try {
    const mias = await req('GET', '/api/reservas/mias', null, T.paula);
    assert.equal(mias.body.find(x => x.id === r.body.reserva.id).cancelable, false);
    const c = await req('POST', `/api/reservas/${r.body.reserva.id}/cancelar`, {}, T.paula);
    assert.equal(c.status, 409); assert.equal(c.body.error, 'CANCELACION_FUERA_DE_PLAZO');
    assert.throws(() => ctx.db.run(`UPDATE reserva SET estado = 'CANCELADA', tipo_cancelacion = 'USUARIO' WHERE id = ?`, [r.body.reserva.id]), /CANCELACION_FUERA_DE_PLAZO/);
    const adm = await req('POST', `/api/reservas/${r.body.reserva.id}/cancelar`, { motivo: 'Corte de luz' }, T.admin);
    assert.equal(adm.status, 200, 'la administración sí puede cancelar por fuerza mayor');
  } finally {
    ctx.db.run(`UPDATE parametro SET valor = '2' WHERE clave = 'HORAS_MIN_CANCELACION'`);
  }
});

test('PR-12 HU05 Docente reserva una serie semanal (4 semanas) con el mismo identificador de serie', async () => {
  const r = await req('POST', '/api/reservas/docente', { recurso_id: 1, fecha: futuro(21), hora_inicio: '18:00', hora_fin: '19:30', asistentes: 25, motivo: 'Taller de Programación', semanas: 4 }, T.paula);
  assert.equal(r.status, 200); assert.equal(r.body.creadas.length, 4);
  assert.ok(r.body.serie && r.body.creadas.every(c => c.serie_id === r.body.serie));
});

test('PR-13 HU05 Prioridad docente: desplaza reservas estudiantiles solo si se aplica', async () => {
  const fd = futuro(22);
  const est = await req('POST', '/api/reservas', { recurso_id: 7, fecha: fd, hora_inicio: '12:00', hora_fin: '13:00', asistentes: 3, motivo: 'Ensayo de presentación' }, T.ana);
  assert.equal(est.status, 201);
  const sinPrioridad = await req('POST', '/api/reservas/docente', { recurso_id: 7, fecha: fd, hora_inicio: '11:30', hora_fin: '13:30', asistentes: 30, motivo: 'Charla', semanas: 1 }, T.paula);
  assert.equal(sinPrioridad.body.creadas.length, 0); assert.equal(sinPrioridad.body.omitidas.length, 1);
  const conPrioridad = await req('POST', '/api/reservas/docente', { recurso_id: 7, fecha: fd, hora_inicio: '11:30', hora_fin: '13:30', asistentes: 30, motivo: 'Charla', semanas: 1, aplicarPrioridad: true }, T.paula);
  assert.equal(conPrioridad.body.creadas.length, 1); assert.equal(conPrioridad.body.desplazadas.length, 1);
  const mias = await req('GET', `/api/reservas/mias?desde=${fd}&hasta=${fd}`, null, T.ana);
  assert.equal(mias.body[0].estado, 'CANCELADA');
  const n = await req('GET', '/api/notificaciones', null, T.ana);
  assert.ok(n.body[0].mensaje.includes('actividad docente'));
  // otro docente no puede desplazar a un docente
  const choque = await req('POST', '/api/reservas/docente', { recurso_id: 7, fecha: fd, hora_inicio: '12:00', hora_fin: '13:00', asistentes: 20, motivo: 'Otra clase', aplicarPrioridad: true }, T.rodrigo);
  assert.equal(choque.body.creadas.length, 0);
});

test('PR-14 Permisos por perfil: estudiante no accede a funciones docentes ni administrativas', async () => {
  assert.equal((await req('POST', '/api/reservas/docente', { recurso_id: 1, fecha: futuro(23), hora_inicio: '10:00', hora_fin: '11:00', motivo: 'x', semanas: 1 }, T.ana)).status, 403);
  assert.equal((await req('GET', '/api/admin/reservas', null, T.ana)).status, 403);
  assert.equal((await req('POST', '/api/recursos', { codigo: 'SAL-X99' }, T.paula)).status, 403);
});

test('PR-15 HU10 + HU11 Vista administrativa con filtro por rango de fechas', async () => {
  const todas = await req('GET', '/api/admin/reservas', null, T.admin);
  const d = futuro(14);
  const filtradas = await req('GET', `/api/admin/reservas?desde=${d}&hasta=${d}`, null, T.admin);
  assert.ok(todas.body.length > filtradas.body.length);
  assert.ok(filtradas.body.length > 0 && filtradas.body.every(x => x.fecha === d));
  const est = await req('GET', '/api/admin/reservas?estado=CANCELADA', null, T.admin);
  assert.ok(est.body.every(x => x.estado === 'CANCELADA'));
  const st = await req('GET', '/api/admin/estadisticas', null, T.admin);
  assert.ok(Array.isArray(st.body.porRecurso) && st.body.porRecurso.length === 7);
  const csv = await req('GET', `/api/admin/reservas.csv?desde=${d}&hasta=${d}`, null, T.admin);
  assert.match(csv.body, /codigo;fecha;hora_inicio/);
  assert.match(csv.body, /\d{2}-\d{2}-\d{4}/, 'fechas en formato DD-MM-AAAA');
});

let nuevaId;
test('PR-16 HU08 Registrar sala: valida datos, rechaza códigos duplicados y queda disponible', async () => {
  const mal = await req('POST', '/api/recursos', { codigo: 'X', nombre: '', tipo: 'SALA', capacidad: 0, ubicacion: '', edificio_id: 99 }, T.admin);
  assert.equal(mal.status, 422); assert.ok(mal.body.errores.length >= 4);
  const ok = await req('POST', '/api/recursos', { codigo: 'lab-a103', nombre: 'Laboratorio de Ciberseguridad', tipo: 'LABORATORIO', capacidad: 22, ubicacion: 'Piso 1', edificio_id: 1, tipo_lab: 'Ciberseguridad', equipamiento: '22 PC, firewall', requiere_supervisor: false }, T.admin);
  assert.equal(ok.status, 201); assert.equal(ok.body.recurso.codigo, 'LAB-A103');
  nuevaId = ok.body.recurso.id;
  const dup = await req('POST', '/api/recursos', { codigo: 'LAB-A103', nombre: 'Otro', tipo: 'SALA', capacidad: 5, ubicacion: 'P1', edificio_id: 1 }, T.admin);
  assert.equal(dup.body.error, 'CODIGO_DUPLICADO');
  const lista = await req('GET', '/api/recursos', null, T.ana);
  assert.ok(lista.body.some(r => r.codigo === 'LAB-A103' && r.estado === 'DISPONIBLE'));
  const r = await req('POST', '/api/reservas', { recurso_id: nuevaId, fecha: futuro(24), hora_inicio: '10:00', hora_fin: '11:00', asistentes: 2, motivo: 'Primera reserva' }, T.paula);
  assert.equal(r.status, 201);
});

test('PR-17 HU09 Editar sala: cambiar datos y dejarla en mantenimiento bloquea nuevas reservas', async () => {
  const ed = await req('PUT', `/api/recursos/${nuevaId}`, { codigo: 'LAB-A103', nombre: 'Lab. de Ciberseguridad', tipo: 'LABORATORIO', capacidad: 24, ubicacion: 'Piso 1, ala sur', edificio_id: 1, tipo_lab: 'Ciberseguridad', equipamiento: '24 PC', estado: 'EN_MANTENIMIENTO' }, T.admin);
  assert.equal(ed.status, 200); assert.equal(ed.body.recurso.capacidad, 24); assert.equal(ed.body.recurso.estado, 'EN_MANTENIMIENTO');
  assert.equal(ed.body.afectadas.length, 1, 'informa reservas futuras afectadas');
  const r = await req('POST', '/api/reservas', { recurso_id: nuevaId, fecha: futuro(25), hora_inicio: '10:00', hora_fin: '11:00', asistentes: 2, motivo: 'En mantención' }, T.paula);
  assert.equal(r.body.error, 'RECURSO_NO_DISPONIBLE');
  const hab = await req('POST', `/api/recursos/${nuevaId}/estado`, { estado: 'DISPONIBLE' }, T.admin);
  assert.equal(hab.body.recurso.estado, 'DISPONIBLE');
});

test('PR-18 EstadoReserva: transiciones inválidas rechazadas por la BD y auditoría registrada', () => {
  const r = ctx.db.get(`SELECT id FROM reserva WHERE estado = 'CANCELADA' LIMIT 1`);
  assert.throws(() => ctx.db.run(`UPDATE reserva SET estado = 'CONFIRMADA' WHERE id = ?`, [r.id]), /TRANSICION_INVALIDA/);
  const h = ctx.db.all('SELECT * FROM historial_reserva WHERE reserva_id = ? ORDER BY id', [r.id]);
  assert.ok(h.length >= 1);
});

test('PR-19 Calendario.horariosLibres() devuelve los huecos del día', async () => {
  const fd = futuro(30);
  await req('POST', '/api/reservas', { recurso_id: 3, fecha: fd, hora_inicio: '10:00', hora_fin: '12:00', asistentes: 10, motivo: 'Clase' }, T.rodrigo);
  const l = await req('GET', `/api/recursos/3/libres?fecha=${fd}`, null, T.ana);
  assert.deepEqual(l.body, [{ desde: '08:00', hasta: '10:00' }, { desde: '12:00', hasta: '22:00' }]);
});
