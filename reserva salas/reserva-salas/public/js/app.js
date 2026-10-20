/* =====================================================================
 *  ReservaLab — interfaz de usuario
 *  HU01 calendario · HU02 reservas existentes sin datos personales
 *  HU03 crear reserva · HU04 cancelar (regla 2 h) · HU05 reserva docente
 *  HU06 confirmación con código · HU07 alerta de conflicto
 *  HU08/HU09 mantenedor de salas · HU10 vista administrativa · HU11 filtro por fecha
 * ===================================================================== */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return isoDate(d); };
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const fechaCL = (s) => s ? s.split('-').reverse().join('-') : '';   // DD-MM-AAAA (HU11)
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const diaDe = (s) => DIAS[parseISO(s).getDay()];
  const lunesDe = (s) => { const d = parseISO(s); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return isoDate(d); };
  const hoy = () => isoDate(new Date());
  // Semana a mostrar por defecto: la actual (lunes a sábado); el domingo se muestra la siguiente
  const semanaInicial = () => { const h = hoy(); return parseISO(h).getDay() === 0 ? addDays(h, 1) : lunesDe(h); };
  const ahoraMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const ROLES = { ESTUDIANTE: 'Estudiante', DOCENTE: 'Docente', ADMINISTRADOR: 'Administrador' };
  const ESTADOS = { PENDIENTE: ['Pendiente', 'pill-warn'], CONFIRMADA: ['Confirmada', 'pill-ok'], CANCELADA: ['Cancelada', 'pill-bad'], FINALIZADA: ['Finalizada', 'pill-mute'] };
  const ESTADO_RECURSO = { DISPONIBLE: ['Disponible', 'pill-ok'], EN_MANTENIMIENTO: ['En mantenimiento', 'pill-warn'], INACTIVO: ['Inactivo', 'pill-bad'] };
  const pill = (map, k) => { const v = map[k] || [k, 'pill-mute']; return `<span class="pill ${v[1]}">${esc(v[0])}</span>`; };
  const api = (m, p, b) => window.Api.call(m, p, b);
  const qs = (o) => Object.keys(o).filter(k => o[k] !== '' && o[k] != null).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(o[k])}`).join('&');

  const S = { user: null, params: { HORA_APERTURA: '08:00', HORA_CIERRE: '22:00' }, recursos: [], tipo: '', recursoId: null, semana: semanaInicial(), cal: null, view: 'reservar' };

  /* ---------- Utilidades de UI ---------- */
  let toastT;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3800); }
  function modal(html) { $('modal-body').innerHTML = html; $('modal').hidden = false; const f = $('modal-body').querySelector('button, input, textarea'); if (f) f.focus(); }
  function closeModal() { $('modal').hidden = true; $('modal-body').innerHTML = ''; }
  function labelTableCells(table) {
    const labels = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach(row => {
      row.querySelectorAll('td').forEach((cell, index) => {
        if (labels[index]) cell.dataset.label = labels[index];
      });
    });
  }
  function alertBox(el, tipo, titulo, items) {
    el.className = `alert alert-${tipo}`;
    el.innerHTML = `<strong>${esc(titulo)}</strong>${items && items.length ? `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>` : ''}`;
    el.hidden = false;
  }
  function horaOptions(sel, desde, hasta, valor) {
    const out = [];
    for (let m = toMin(desde); m <= toMin(hasta); m += 30) out.push(`<option value="${fromMin(m)}"${fromMin(m) === valor ? ' selected' : ''}>${fromMin(m)}</option>`);
    sel.innerHTML = out.join('');
  }
  async function copiar(texto, el) {
    try { await navigator.clipboard.writeText(texto); toast('Copiado al portapapeles'); }
    catch (e) { if (el && el.select) { el.focus(); el.select(); } toast('Selecciona el texto y cópialo con Ctrl+C'); }
  }
  function errorMsg(e) { return e && e.message ? e.message : 'No se pudo completar la operación.'; }

  /* ---------- Tema claro / oscuro ---------- */
  function aplicarTema(t) { if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }
  function temaActual() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  try { const t = localStorage.getItem('reservalab_tema'); if (t) aplicarTema(t); } catch (e) { /* sin almacenamiento */ }
  $('btn-theme').addEventListener('click', () => {
    const t = temaActual() === 'dark' ? 'light' : 'dark';
    aplicarTema(t);
    try { localStorage.setItem('reservalab_tema', t); } catch (e) { /* sin almacenamiento */ }
  });

  /* ---------- Login ---------- */
  (function arte() {
    const pat = 'm.bb..m.b...bm..b.m..bbb.m.e..b.mm..b..b.m.bb...m..b.e.b.m.';
    $('art-grid').innerHTML = pat.split('').map(c => `<i class="${c === '.' ? '' : c}"></i>`).join('');
  })();
  document.querySelectorAll('[data-demo]').forEach(b => b.addEventListener('click', () => {
    $('login-correo').value = b.dataset.demo; $('login-pass').value = b.dataset.pass; $('login-pass').focus();
  }));
  $('form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('login-error').hidden = true;
    try {
      const r = await api('POST', '/api/login', { correo: $('login-correo').value, password: $('login-pass').value });
      window.Api.setToken(r.token);
      await entrar();
    } catch (e) { $('login-error').textContent = errorMsg(e); $('login-error').hidden = false; }
  });
  $('btn-logout').addEventListener('click', async () => {
    try { await api('POST', '/api/logout'); } catch (e) { /* sesión ya cerrada */ }
    window.Api.setToken(null); S.user = null; mostrarLogin();
  });
  function mostrarLogin() { $('view-app').hidden = true; $('view-login').hidden = false; $('login-pass').value = ''; }

  async function entrar() {
    const me = await api('GET', '/api/me');
    S.user = me.usuario;
    S.params = await api('GET', '/api/parametros');
    $('user-name').textContent = S.user.nombre;
    $('user-role').textContent = ROLES[S.user.rol];
    document.querySelectorAll('#tabs [data-roles]').forEach(b => { b.hidden = b.dataset.roles.split(',').indexOf(S.user.rol) === -1; });
    $('view-login').hidden = true; $('view-app').hidden = false;
    S.recursos = await api('GET', '/api/recursos');
    if (!S.recursoId || !S.recursos.some(r => r.id === S.recursoId)) {
      const primero = S.recursos.find(r => r.estado === 'DISPONIBLE') || S.recursos[0];
      S.recursoId = primero ? primero.id : null;
    }
    prepararFormularios();
    const inicial = (location.hash || '').replace('#', '');
    navegar(['reservar', 'mias', 'docente', 'admin', 'salas'].indexOf(inicial) !== -1 ? inicial : 'reservar');
    cargarNotificaciones();
  }

  /* ---------- Navegación ---------- */
  function navegar(v) {
    const btn = document.querySelector(`#tabs [data-nav="${v}"]`);
    if (btn && btn.hidden) v = 'reservar';
    S.view = v;
    document.querySelectorAll('#tabs [data-nav]').forEach(b => b.classList.toggle('is-on', b.dataset.nav === v));
    ['reservar', 'mias', 'docente', 'admin', 'salas'].forEach(n => { $('view-' + n).hidden = n !== v; });
    try { history.replaceState(null, '', '#' + v); } catch (e) { /* entorno sin history */ }
    if (v === 'reservar') { renderRooms(); seleccionarRecurso(S.recursoId); }
    if (v === 'mias') cargarMias();
    if (v === 'docente') { /* formulario listo */ }
    if (v === 'admin') cargarAdmin();
    if (v === 'salas') cargarSalas();
    cargarNotificaciones();
  }
  document.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', (ev) => { ev.preventDefault(); navegar(b.dataset.nav); }));

  function prepararFormularios() {
    const ap = S.params.HORA_APERTURA, ci = S.params.HORA_CIERRE;
    horaOptions($('r-inicio'), ap, fromMin(toMin(ci) - 30), '10:00');
    horaOptions($('r-fin'), fromMin(toMin(ap) + 30), ci, '11:00');
    horaOptions($('d-inicio'), ap, fromMin(toMin(ci) - 30), '10:00');
    horaOptions($('d-fin'), fromMin(toMin(ap) + 30), ci, '11:30');
    $('r-fecha').min = hoy(); $('d-fecha').min = hoy();
    if (!$('r-fecha').value) $('r-fecha').value = siguienteHabil(hoy());
    if (!$('d-fecha').value) $('d-fecha').value = siguienteHabil(addDays(hoy(), 1));
    const maxSem = Number(S.params.MAX_SEMANAS_RECURRENCIA || 16);
    $('d-semanas').innerHTML = Array.from({ length: maxSem }, (_, i) => `<option value="${i + 1}">${i === 0 ? 'Solo esa fecha' : `Cada semana · ${i + 1} semanas`}</option>`).join('');
    $('d-recurso').innerHTML = S.recursos.map(r => `<option value="${r.id}"${r.estado !== 'DISPONIBLE' ? ' disabled' : ''}>${esc(r.codigo)} · ${esc(r.nombre)} (${r.capacidad} pers.)${r.estado !== 'DISPONIBLE' ? ' — no disponible' : ''}</option>`).join('');
    const lab = S.recursos.find(r => r.tipo === 'LABORATORIO' && r.estado === 'DISPONIBLE');
    if (lab) $('d-recurso').value = lab.id;
    $('a-recurso').innerHTML = '<option value="">Todos</option>' + S.recursos.map(r => `<option value="${r.id}">${esc(r.codigo)} · ${esc(r.nombre)}</option>`).join('');
  }
  function siguienteHabil(s) { let d = s; if (parseISO(d).getDay() === 0) d = addDays(d, 1); return d; }

  /* =====================================================================
   *  RESERVAR — calendario (HU01, HU02) y formulario (HU03, HU06, HU07)
   * ===================================================================== */
  document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('is-on', x === b));
    S.tipo = b.dataset.tipo; renderRooms();
  }));

  function renderRooms() {
    const lista = S.recursos.filter(r => !S.tipo || r.tipo === S.tipo);
    $('room-list').innerHTML = lista.map(r => {
      const off = r.estado !== 'DISPONIBLE';
      const det = r.tipo === 'LABORATORIO' ? (r.requiere_supervisor ? 'Requiere supervisor' : esc(r.tipo_lab)) : (r.tiene_proyector ? 'Con proyector' : 'Sin proyector');
      return `<li><button type="button" class="room${r.id === S.recursoId ? ' is-on' : ''}${off ? ' is-off' : ''}" data-room="${r.id}">
        <span class="room-code">${esc(r.codigo)}</span>${off ? pill(ESTADO_RECURSO, r.estado) : `<span class="room-code">${r.capacidad} pers.</span>`}
        <span class="room-name">${esc(r.nombre)}</span>
        <span class="room-meta">${esc(r.edificio.split('—')[0].trim())} · ${det}</span></button></li>`;
    }).join('') || '<li class="small muted">No hay espacios de este tipo.</li>';
    $('room-list').querySelectorAll('[data-room]').forEach(b => b.addEventListener('click', () => seleccionarRecurso(Number(b.dataset.room))));
  }

  async function seleccionarRecurso(id) {
    if (!id) { $('calendar').innerHTML = '<div class="cal-empty">No hay espacios registrados.</div>'; return; }
    S.recursoId = id;
    document.querySelectorAll('.room').forEach(b => b.classList.toggle('is-on', Number(b.dataset.room) === id));
    const r = S.recursos.find(x => x.id === id);
    $('form-room-name').textContent = r.nombre;
    const extra = r.tipo === 'LABORATORIO'
      ? `${esc(r.equipamiento || r.tipo_lab)}${r.requiere_supervisor ? ' · Las reservas estudiantiles quedan pendientes de aprobación (requiere supervisor).' : ''}`
      : `${r.tiene_proyector ? 'Con proyector' : 'Sin proyector'} · ${esc(r.distribucion)}`;
    $('form-room-meta').innerHTML = `${esc(r.codigo)} · Capacidad ${r.capacidad} personas · ${esc(r.ubicacion)}<br>${extra}`;
    $('r-asistentes').max = r.capacidad;
    $('r-submit').disabled = r.estado !== 'DISPONIBLE';
    if (r.estado !== 'DISPONIBLE') alertBox($('r-alert'), 'warn', 'Este espacio no recibe reservas', [`Estado actual: ${ESTADO_RECURSO[r.estado][0].toLowerCase()}.`]);
    else $('r-alert').hidden = true;
    await cargarCalendario();
    cargarLibres();
    validarEnVivo();
    cargarCupo();
  }

  async function cargarCalendario() {
    const desde = S.semana, hasta = addDays(S.semana, 5);
    try {
      S.cal = await api('GET', `/api/recursos/${S.recursoId}/calendario?${qs({ desde, hasta })}`);
      renderCalendario();
    } catch (e) { $('calendar').innerHTML = `<div class="cal-empty">${esc(errorMsg(e))}</div>`; }
  }

  function renderCalendario() {
    const c = S.cal, ap = toMin(c.apertura), ci = toMin(c.cierre);
    const filas = (ci - ap) / 30;
    const slotH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--slot-h')) || 22;
    const dias = Array.from({ length: 6 }, (_, i) => addDays(S.semana, i));
    $('cal-title').textContent = `Semana del ${fechaCL(dias[0])} al ${fechaCL(dias[5])}`;
    const n = c.reservas.length;
    $('cal-sub').textContent = `${c.recurso.codigo} · ${n} ${n === 1 ? 'reserva activa' : 'reservas activas'} esta semana · bloques de 30 min, ${c.apertura}–${c.cierre}`;
    const selFecha = $('r-fecha').value, selIni = $('r-inicio').value, selFin = $('r-fin').value;
    let html = '<div class="cal-h" aria-hidden="true"></div>';
    html += dias.map(d => `<div class="cal-h${d === hoy() ? ' is-today' : ''}" role="columnheader"><strong>${diaDe(d)}</strong><span>${fechaCL(d)}</span></div>`).join('');
    html += '<div class="cal-times" aria-hidden="true">' + Array.from({ length: filas }, (_, i) => `<div class="cal-time">${(ap + i * 30) % 60 === 0 ? fromMin(ap + i * 30) : ''}</div>`).join('') + '</div>';
    const off = c.recurso.estado !== 'DISPONIBLE';
    dias.forEach(d => {
      let col = `<div class="cal-day" role="gridcell" aria-label="${diaDe(d)} ${fechaCL(d)}">`;
      for (let i = 0; i < filas; i++) {
        const m = ap + i * 30;
        const pasado = d < hoy() || (d === hoy() && m < ahoraMin());
        const sel = d === selFecha && m >= toMin(selIni || '00:00') && m < toMin(selFin || '00:00');
        const cls = ['slot', m % 60 === 0 ? 'hour' : '', pasado || off ? 'past' : '', sel ? 'sel' : ''].join(' ');
        col += `<button type="button" class="${cls}" data-f="${d}" data-m="${m}" ${pasado || off ? 'disabled' : ''} aria-label="Libre ${fechaCL(d)} ${fromMin(m)}"></button>`;
      }
      c.reservas.filter(r => r.fecha === d).forEach(r => {
        const top = (toMin(r.hora_inicio) - ap) / 30 * slotH, h = (toMin(r.hora_fin) - toMin(r.hora_inicio)) / 30 * slotH;
        const cls = ['blk', r.propia ? 'mine' : '', r.estado === 'PENDIENTE' ? 'pend' : ''].join(' ');
        const quien = r.propia ? 'Mi reserva' : (r.usuario ? esc(r.usuario) : `Ocupado · ${ROLES[r.rol_solicitante] || ''}`);
        col += `<button type="button" class="${cls}" style="top:${top + 1}px;height:${h - 2}px" data-res="${r.id}"
                 aria-label="${quien} de ${r.hora_inicio} a ${r.hora_fin}"><b>${r.hora_inicio}–${r.hora_fin}</b>${quien}</button>`;
      });
      html += col + '</div>';
    });
    $('calendar').innerHTML = html;
    $('calendar').querySelectorAll('.slot:not([disabled])').forEach(b => b.addEventListener('click', () => {
      const m = Number(b.dataset.m), fin = Math.min(m + 60, ci);
      $('r-fecha').value = b.dataset.f;
      $('r-inicio').value = fromMin(m);
      $('r-fin').value = fromMin(fin);
      renderCalendario(); cargarLibres(); validarEnVivo();
      if (window.innerWidth < 1180) document.querySelector('.ticket').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    $('calendar').querySelectorAll('[data-res]').forEach(b => b.addEventListener('click', () => detalleBloque(Number(b.dataset.res))));
  }

  function detalleBloque(id) {
    const r = S.cal.reservas.find(x => x.id === id);
    if (!r) return;
    const filas = [['Espacio', S.cal.recurso.nombre], ['Fecha', `${diaDe(r.fecha)} ${fechaCL(r.fecha)}`], ['Horario', `${r.hora_inicio} – ${r.hora_fin}`], ['Estado', ESTADOS[r.estado][0]]];
    if (r.codigo) filas.unshift(['Código', r.codigo]);
    if (r.motivo) filas.push(['Motivo', r.motivo]);
    if (r.usuario) filas.push(['Solicitante', r.usuario]);
    if (!r.propia && !r.usuario) filas.push(['Reservado por', `${ROLES[r.rol_solicitante]} (datos personales protegidos)`]);
    modal(`<h2>${r.propia ? 'Tu reserva' : 'Horario ocupado'}</h2>
      <dl class="kv">${filas.map(f => `<dt>${esc(f[0])}</dt><dd>${esc(f[1])}</dd>`).join('')}</dl>
      <div class="btn-row" style="margin-top:1.2rem">
        ${r.propia ? '<button type="button" class="btn btn-ghost" data-go="mias">Ver en Mis reservas</button>' : ''}
        <button type="button" class="btn btn-primary" data-close>Cerrar</button></div>`);
  }

  $('cal-prev').addEventListener('click', () => { S.semana = addDays(S.semana, -7); cargarCalendario(); });
  $('cal-next').addEventListener('click', () => { S.semana = addDays(S.semana, 7); cargarCalendario(); });
  $('cal-today').addEventListener('click', () => { S.semana = semanaInicial(); cargarCalendario(); });

  async function cargarLibres() {
    const f = $('r-fecha').value;
    const box = $('free-slots');
    if (!S.recursoId || !f) { box.innerHTML = '<span class="small muted">Elige un espacio y una fecha.</span>'; return; }
    try {
      const libres = await api('GET', `/api/recursos/${S.recursoId}/libres?fecha=${f}`);
      box.innerHTML = libres.length
        ? libres.map(l => `<button type="button" class="chip" data-desde="${l.desde}" data-hasta="${l.hasta}">${l.desde}–${l.hasta}</button>`).join('')
        : '<span class="small muted">Sin horarios libres ese día.</span>';
      box.querySelectorAll('[data-desde]').forEach(b => b.addEventListener('click', () => {
        const d = toMin(b.dataset.desde), h = toMin(b.dataset.hasta);
        $('r-inicio').value = b.dataset.desde; $('r-fin').value = fromMin(Math.min(d + 60, h));
        renderCalendarioSiVisible(); validarEnVivo();
      }));
    } catch (e) { box.innerHTML = `<span class="small muted">${esc(errorMsg(e))}</span>`; }
  }
  function renderCalendarioSiVisible() {
    const f = $('r-fecha').value;
    if (f && (f < S.semana || f > addDays(S.semana, 5))) { S.semana = lunesDe(f); cargarCalendario(); }
    else if (S.cal) renderCalendario();
  }

  function datosReserva() {
    return { recurso_id: S.recursoId, fecha: $('r-fecha').value, hora_inicio: $('r-inicio').value, hora_fin: $('r-fin').value,
      asistentes: Number($('r-asistentes').value || 1), motivo: $('r-motivo').value.trim() || 'pendiente' };
  }
  let valT, valSeq = 0;
  function validarEnVivo() {
    clearTimeout(valT);
    const seq = ++valSeq;
    valT = setTimeout(async () => {
      const r = S.recursos.find(x => x.id === S.recursoId);
      if (!r || r.estado !== 'DISPONIBLE' || !$('r-fecha').value) return;
      try {
        const v = await api('POST', '/api/reservas/validar', datosReserva());
        if (seq !== valSeq) return;   // llegó una validación más reciente
        const errs = v.errores.filter(e => e.code !== 'DATOS_INCOMPLETOS');
        if (!errs.length) { alertBox($('r-alert'), 'ok', 'Horario disponible', [`${diaDe($('r-fecha').value)} ${fechaCL($('r-fecha').value)}, ${$('r-inicio').value} a ${$('r-fin').value}.`]); return; }
        mostrarErrores(errs, v.conflictos);
      } catch (e) { /* la validación final ocurre al enviar */ }
    }, 250);
  }
  function mostrarErrores(errores, conflictos) {
    const items = errores.map(e => esc(e.mensaje));
    (conflictos || []).forEach(c => items.push(`Ocupado de <b>${c.hora_inicio}</b> a <b>${c.hora_fin}</b> · ${c.propia ? 'por ti' : ROLES[c.rol_solicitante]}${c.estado === 'PENDIENTE' ? ' (pendiente)' : ''}`));
    const conflicto = errores.some(e => e.code === 'CONFLICTO_HORARIO');
    alertBox($('r-alert'), 'bad', conflicto ? 'Conflicto de horario' : 'No se puede reservar así', items);
  }
  ['r-fecha', 'r-inicio', 'r-fin', 'r-asistentes'].forEach(id => $(id).addEventListener('change', () => {
    if (id === 'r-inicio' && $('r-fin').value <= $('r-inicio').value) $('r-fin').value = fromMin(Math.min(toMin($('r-inicio').value) + 60, toMin(S.params.HORA_CIERRE)));
    if (id === 'r-fecha') cargarLibres();
    renderCalendarioSiVisible(); validarEnVivo();
  }));

  async function cargarCupo() {
    try {
      const me = await api('GET', '/api/me');
      const p = me.puedeReservar;
      $('r-quota').textContent = S.user.rol === 'ESTUDIANTE'
        ? `Tienes ${p.activas} de ${p.maximo} reservas activas permitidas. Duración máxima: 3 horas.`
        : `${ROLES[S.user.rol]}: sin límite de reservas activas.`;
    } catch (e) { $('r-quota').textContent = ''; }
  }

  $('form-reserva').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = datosReserva();
    if (!$('r-motivo').value.trim() || $('r-motivo').value.trim().length < 3) {
      alertBox($('r-alert'), 'bad', 'Falta el motivo', ['Escribe para qué usarás el espacio (mínimo 3 caracteres).']); $('r-motivo').focus(); return;
    }
    $('r-submit').disabled = true;
    clearTimeout(valT); valSeq++;
    try {
      const out = await api('POST', '/api/reservas', d);
      const r = out.reserva;
      modal(`<div class="voucher">
        <div><p class="eyebrow">${out.requiereAprobacion ? 'Solicitud registrada' : 'Reserva confirmada'}</p><h2 id="modal-title">${out.requiereAprobacion ? 'Pendiente de aprobación' : 'Listo, el espacio es tuyo'}</h2></div>
        <div class="voucher-code" id="v-code">${esc(r.codigo)}</div>
        <dl class="kv"><dt>Espacio</dt><dd>${esc(r.recurso)} (${esc(r.recurso_codigo)})</dd>
          <dt>Fecha</dt><dd>${diaDe(r.fecha)} ${fechaCL(r.fecha)}</dd><dt>Horario</dt><dd>${r.hora_inicio} – ${r.hora_fin}</dd>
          <dt>Asistentes</dt><dd>${r.asistentes}</dd><dt>Motivo</dt><dd>${esc(r.motivo)}</dd><dt>Estado</dt><dd>${pill(ESTADOS, r.estado)}</dd></dl>
        <p class="small muted">${esc(out.mensaje)} Presenta este código en conserjería. Puedes cancelar hasta 2 horas antes.</p>
        <div class="btn-row"><button type="button" class="btn btn-ghost" id="v-copy">Copiar código</button><button type="button" class="btn btn-primary" data-close>Entendido</button></div></div>`);
      $('v-copy').addEventListener('click', () => copiar(r.codigo));
      $('r-motivo').value = '';
      await cargarCalendario(); cargarLibres(); cargarCupo(); cargarNotificaciones();
      $('r-alert').hidden = true;
    } catch (e) {
      if (e.errores) mostrarErrores(e.errores, e.conflictos);
      else alertBox($('r-alert'), 'bad', errorMsg(e));
      cargarCalendario();
    } finally { $('r-submit').disabled = false; }
  });

  /* =====================================================================
   *  MIS RESERVAS (HU04, HU11)
   * ===================================================================== */
  $('filtro-mias').addEventListener('submit', (ev) => { ev.preventDefault(); cargarMias(); });
  $('m-limpiar').addEventListener('click', () => { $('m-desde').value = ''; $('m-hasta').value = ''; $('m-estado').value = ''; cargarMias(); });
  async function cargarMias() {
    const f = { desde: $('m-desde').value, hasta: $('m-hasta').value, estado: $('m-estado').value };
    if (f.desde && f.hasta && f.desde > f.hasta) { toast('La fecha "desde" debe ser anterior a "hasta".'); return; }
    try {
      const filas = await api('GET', '/api/reservas/mias?' + qs(f));
      const rango = f.desde || f.hasta ? ` entre ${f.desde ? fechaCL(f.desde) : 'el inicio'} y ${f.hasta ? fechaCL(f.hasta) : 'hoy en adelante'}` : '';
      $('m-resumen').textContent = `${filas.length} ${filas.length === 1 ? 'reserva' : 'reservas'}${rango}.`;
      $('tabla-mias').innerHTML = filas.length ? `<thead><tr><th>Código</th><th>Espacio</th><th>Fecha</th><th>Horario</th><th>Asist.</th><th>Estado</th><th></th></tr></thead><tbody>` +
        filas.map(r => `<tr><td class="code">${esc(r.codigo)}</td><td>${esc(r.recurso)}<div class="small muted">${esc(r.recurso_codigo)}</div></td>
          <td class="nowrap">${fechaCL(r.fecha)}<div class="small muted">${diaDe(r.fecha)}</div></td><td class="nowrap mono">${r.hora_inicio}–${r.hora_fin}</td>
          <td>${r.asistentes}</td><td>${pill(ESTADOS, r.estado)}${r.motivo_cancelacion && r.estado === 'CANCELADA' ? `<div class="small muted">${esc(r.motivo_cancelacion)}</div>` : ''}</td>
          <td><div class="actions">${r.cancelable ? `<button type="button" class="btn btn-danger btn-sm" data-cancel="${r.id}" data-code="${esc(r.codigo)}">Cancelar</button>`
            : (r.estado === 'PENDIENTE' || r.estado === 'CONFIRMADA') ? '<span class="small muted">Menos de 2 h: ya no se puede cancelar</span>' : ''}</div></td></tr>`).join('') + '</tbody>'
        : '<tbody><tr><td class="table-empty">No tienes reservas en este rango. Ve a Reservar para crear una.</td></tr></tbody>';
      labelTableCells($('tabla-mias'));
      $('tabla-mias').querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => pedirCancelacion(Number(b.dataset.cancel), b.dataset.code, cargarMias)));
    } catch (e) { toast(errorMsg(e)); }
  }

  function pedirCancelacion(id, codigo, despues) {
    modal(`<h2 id="modal-title">¿Cancelar la reserva ${esc(codigo)}?</h2>
      <p class="muted" style="margin-bottom:1rem">El horario quedará libre de inmediato. Esta acción no se puede deshacer.</p>
      <div class="field"><label for="c-motivo">Motivo (opcional)</label><input id="c-motivo" maxlength="200" placeholder="Ej.: se cambió la fecha del trabajo"></div>
      <div id="c-alert" class="alert" hidden style="margin-top:.8rem"></div>
      <div class="btn-row" style="margin-top:1.2rem"><button type="button" class="btn btn-danger" id="c-ok">Cancelar reserva</button>
      <button type="button" class="btn btn-ghost" data-close>Volver</button></div>`);
    $('c-ok').addEventListener('click', async () => {
      try {
        const out = await api('POST', `/api/reservas/${id}/cancelar`, { motivo: $('c-motivo').value });
        closeModal(); toast(out.mensaje); despues && despues(); cargarNotificaciones();
        if (S.cal) cargarCalendario();
      } catch (e) { alertBox($('c-alert'), 'bad', errorMsg(e)); }
    });
  }

  /* =====================================================================
   *  RESERVA DOCENTE (HU05)
   * ===================================================================== */
  function datosDocente(extra) {
    return Object.assign({ recurso_id: Number($('d-recurso').value), fecha: $('d-fecha').value, hora_inicio: $('d-inicio').value, hora_fin: $('d-fin').value,
      asistentes: Number($('d-asistentes').value || 1), motivo: $('d-motivo').value.trim(), semanas: Number($('d-semanas').value), aplicarPrioridad: $('d-prioridad').checked }, extra || {});
  }
  function validarDocenteLocal() {
    if ($('d-motivo').value.trim().length < 3) { alertBox($('d-alert'), 'bad', 'Indica la asignatura o actividad.'); $('d-motivo').focus(); return false; }
    $('d-alert').hidden = true; return true;
  }
  async function simularDocente() {
    if (!validarDocenteLocal()) return null;
    try {
      const plan = await api('POST', '/api/reservas/docente', datosDocente({ simular: true }));
      const cuenta = { LIBRE: 0, DESPLAZA: 0, CONFLICTO: 0, ERROR: 0 };
      plan.ocurrencias.forEach(o => cuenta[o.estado]++);
      $('d-plan-sub').textContent = `${plan.ocurrencias.length} fecha(s): ${cuenta.LIBRE} libres, ${cuenta.DESPLAZA} con reservas estudiantiles, ${cuenta.CONFLICTO} ocupadas por otra actividad docente, ${cuenta.ERROR} no válidas.`;
      $('tabla-plan').innerHTML = '<thead><tr><th>Fecha</th><th>Día</th><th>Disponibilidad</th></tr></thead><tbody>' + plan.ocurrencias.map(o => {
        let est = '<span class="pill pill-ok">Libre</span>';
        if (o.estado === 'DESPLAZA') est = `<span class="pill pill-warn">${o.desplazables.length} reserva(s) estudiantil(es)</span><div class="small muted">${$('d-prioridad').checked ? 'Se cancelarán por prioridad docente' : 'Se omitirá si no aplicas la prioridad'}</div>`;
        if (o.estado === 'CONFLICTO') est = `<span class="pill pill-bad">Ocupado por actividad docente</span><div class="small muted">${o.conflictos.map(c => `${c.hora_inicio}–${c.hora_fin}`).join(', ')} · se omitirá</div>`;
        if (o.estado === 'ERROR') est = `<span class="pill pill-bad">No válida</span><div class="small muted">${esc(o.errores[0].mensaje)}</div>`;
        return `<tr><td class="nowrap">${fechaCL(o.fecha)}</td><td>${diaDe(o.fecha)}</td><td>${est}</td></tr>`;
      }).join('') + '</tbody>';
      labelTableCells($('tabla-plan'));
      return plan;
    } catch (e) { alertBox($('d-alert'), 'bad', errorMsg(e)); return null; }
  }
  $('d-simular').addEventListener('click', simularDocente);
  $('d-prioridad').addEventListener('change', () => { if ($('tabla-plan').innerHTML) simularDocente(); });
  $('form-docente').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!validarDocenteLocal()) return;
    try {
      const out = await api('POST', '/api/reservas/docente', datosDocente());
      const tipo = out.creadas.length ? (out.omitidas.length ? 'warn' : 'ok') : 'bad';
      const items = [];
      if (out.creadas.length) items.push(`${out.creadas.length} reserva(s) confirmada(s): ${out.creadas.map(c => `<span class="mono">${esc(c.codigo)}</span> (${fechaCL(c.fecha)})`).join(', ')}`);
      if (out.serie) items.push(`Serie <span class="mono">${esc(out.serie)}</span>`);
      if (out.desplazadas.length) items.push(`${out.desplazadas.length} reserva(s) estudiantil(es) canceladas por prioridad. Sus titulares fueron notificados.`);
      out.omitidas.forEach(o => items.push(`Omitida ${fechaCL(o.fecha)}: ${esc(o.motivo)}`));
      alertBox($('d-alert'), tipo, out.creadas.length ? 'Reservas docentes registradas' : 'No se registró ninguna reserva', items);
      simularDocente(); cargarNotificaciones();
    } catch (e) { alertBox($('d-alert'), 'bad', errorMsg(e)); }
  });

  /* =====================================================================
   *  ADMINISTRACIÓN (HU10, HU11)
   * ===================================================================== */
  $('a-desde').value = addDays(hoy(), -7); $('a-hasta').value = addDays(hoy(), 30);
  $('filtro-admin').addEventListener('submit', (ev) => { ev.preventDefault(); cargarAdmin(); });
  function filtroAdmin() { return { desde: $('a-desde').value, hasta: $('a-hasta').value, estado: $('a-estado').value, recurso_id: $('a-recurso').value, rol: $('a-rol').value, q: $('a-q').value.trim() }; }
  async function cargarAdmin() {
    const f = filtroAdmin();
    if (f.desde && f.hasta && f.desde > f.hasta) { toast('La fecha "desde" debe ser anterior a "hasta".'); return; }
    try {
      const [filas, st] = await Promise.all([api('GET', '/api/admin/reservas?' + qs(f)), api('GET', '/api/admin/estadisticas?' + qs({ desde: f.desde, hasta: f.hasta }))]);
      const est = {}; st.porEstado.forEach(e => { est[e.estado] = e.n; });
      const total = st.porEstado.reduce((a, e) => a + e.n, 0);
      $('kpis').innerHTML = `
        <div class="kpi${st.pendientes ? ' hot' : ''}"><b>${st.pendientes}</b><span>Pendientes de aprobación</span></div>
        <div class="kpi"><b>${st.hoy}</b><span>Reservas para hoy</span></div>
        <div class="kpi"><b>${(est.CONFIRMADA || 0) + (est.FINALIZADA || 0)}</b><span>Confirmadas o finalizadas en el período</span></div>
        <div class="kpi"><b>${est.CANCELADA || 0}</b><span>Canceladas en el período (${total ? Math.round((est.CANCELADA || 0) * 100 / total) : 0}%)</span></div>`;
      $('a-resumen').textContent = `${filas.length} ${filas.length === 1 ? 'reserva' : 'reservas'} entre ${fechaCL(f.desde) || 'el inicio'} y ${fechaCL(f.hasta) || 'el final'}.`;
      $('tabla-admin').innerHTML = filas.length ? '<thead><tr><th>Código</th><th>Fecha</th><th>Horario</th><th>Espacio</th><th>Solicitante</th><th>Asist.</th><th>Estado</th><th></th></tr></thead><tbody>' +
        filas.map(r => `<tr><td class="code">${esc(r.codigo)}</td><td class="nowrap">${fechaCL(r.fecha)}</td><td class="nowrap mono">${r.hora_inicio}–${r.hora_fin}</td>
          <td>${esc(r.recurso_codigo)}<div class="small muted">${esc(r.recurso)}</div></td><td>${esc(r.usuario)}<div class="small muted">${ROLES[r.rol]} · ${esc(r.motivo)}</div></td>
          <td>${r.asistentes}/${r.capacidad}</td><td>${pill(ESTADOS, r.estado)}</td>
          <td><div class="actions">${r.estado === 'PENDIENTE' ? `<button type="button" class="btn btn-primary btn-sm" data-ok="${r.id}">Aprobar</button>` : ''}
          ${r.estado === 'PENDIENTE' || r.estado === 'CONFIRMADA' ? `<button type="button" class="btn btn-danger btn-sm" data-cancel="${r.id}" data-code="${esc(r.codigo)}">Cancelar</button>` : ''}</div></td></tr>`).join('') + '</tbody>'
        : '<tbody><tr><td class="table-empty">No hay reservas con estos filtros.</td></tr></tbody>';
      labelTableCells($('tabla-admin'));
      $('tabla-admin').querySelectorAll('[data-ok]').forEach(b => b.addEventListener('click', async () => {
        try { const out = await api('POST', `/api/reservas/${b.dataset.ok}/confirmar`); toast(out.mensaje); cargarAdmin(); } catch (e) { toast(errorMsg(e)); }
      }));
      $('tabla-admin').querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => pedirCancelacion(Number(b.dataset.cancel), b.dataset.code, cargarAdmin)));
      const max = Math.max(1, ...st.porRecurso.map(r => r.horas));
      $('occ-sub').textContent = `Del ${fechaCL(st.desde)} al ${fechaCL(st.hasta)}, sin contar cancelaciones.`;
      $('occ-bars').innerHTML = st.porRecurso.map(r => `<div class="bar-row"><span>${esc(r.codigo)} · ${esc(r.nombre)}</span><b>${r.horas.toFixed(1)} h</b>
        <div class="track"><div class="fill" style="width:${(r.horas / max * 100).toFixed(1)}%"></div></div></div>`).join('');
    } catch (e) { toast(errorMsg(e)); }
  }
  $('a-csv').addEventListener('click', async () => {
    const f = filtroAdmin();
    if (window.Api.mode === 'remote') { window.location.href = window.Api.csvUrl(qs(f)); return; }
    try {
      const csv = await api('GET', '/api/admin/reservas.csv?' + qs(f));
      modal(`<h2 id="modal-title">Informe de reservas (CSV)</h2><p class="small muted" style="margin-bottom:.6rem">Copia el contenido y pégalo en Excel. Separador: punto y coma.</p>
        <textarea class="csv-out" id="csv-out" readonly>${esc(csv)}</textarea>
        <div class="btn-row" style="margin-top:1rem"><button type="button" class="btn btn-primary" id="csv-copy">Copiar CSV</button><button type="button" class="btn btn-ghost" data-close>Cerrar</button></div>`);
      $('csv-copy').addEventListener('click', () => copiar(csv, $('csv-out')));
    } catch (e) { toast(errorMsg(e)); }
  });

  /* =====================================================================
   *  SALAS (HU08, HU09)
   * ===================================================================== */
  async function cargarSalas() {
    try {
      S.recursos = await api('GET', '/api/recursos');
      $('tabla-salas').innerHTML = '<thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Capacidad</th><th>Edificio</th><th>Detalle</th><th>Estado</th><th></th></tr></thead><tbody>' +
        S.recursos.map(r => `<tr><td class="code">${esc(r.codigo)}</td><td>${esc(r.nombre)}<div class="small muted">${esc(r.ubicacion)}</div></td>
          <td>${r.tipo === 'LABORATORIO' ? 'Laboratorio' : 'Sala'}</td><td>${r.capacidad}</td><td>${esc(r.edificio)}</td>
          <td class="small">${r.tipo === 'LABORATORIO' ? `${esc(r.tipo_lab)} · ${esc(r.equipamiento)}${r.requiere_supervisor ? ' · <b>requiere supervisor</b>' : ''}` : `${r.tiene_proyector ? 'Proyector' : 'Sin proyector'} · ${esc(r.distribucion)}`}</td>
          <td>${pill(ESTADO_RECURSO, r.estado)}</td>
          <td><div class="actions"><button type="button" class="btn btn-ghost btn-sm" data-edit="${r.id}">Editar</button>
          ${r.estado === 'DISPONIBLE' ? `<button type="button" class="btn btn-danger btn-sm" data-estado="EN_MANTENIMIENTO" data-id="${r.id}">Mantenimiento</button>`
            : `<button type="button" class="btn btn-primary btn-sm" data-estado="DISPONIBLE" data-id="${r.id}">Habilitar</button>`}</div></td></tr>`).join('') + '</tbody>';
      labelTableCells($('tabla-salas'));
      $('tabla-salas').querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => formSala(S.recursos.find(r => r.id === Number(b.dataset.edit)))));
      $('tabla-salas').querySelectorAll('[data-estado]').forEach(b => b.addEventListener('click', async () => {
        try {
          const out = await api('POST', `/api/recursos/${b.dataset.id}/estado`, { estado: b.dataset.estado });
          toast(`${out.recurso.codigo}: ${ESTADO_RECURSO[out.recurso.estado][0].toLowerCase()}${out.afectadas.length ? ` · ${out.afectadas.length} reserva(s) futura(s) por revisar` : ''}`);
          cargarSalas(); prepararFormularios();
        } catch (e) { toast(errorMsg(e)); }
      }));
    } catch (e) { toast(errorMsg(e)); }
  }
  $('btn-nueva-sala').addEventListener('click', () => formSala(null));

  async function formSala(r) {
    const eds = await api('GET', '/api/edificios');
    const v = r || { codigo: '', nombre: '', tipo: 'LABORATORIO', capacidad: 20, ubicacion: '', edificio_id: eds[0] && eds[0].id, estado: 'DISPONIBLE', tipo_lab: '', equipamiento: '', requiere_supervisor: 0, tiene_proyector: 1, distribucion: 'Mesa central' };
    modal(`<h2 id="modal-title">${r ? 'Editar ' + esc(r.codigo) : 'Registrar espacio'}</h2>
      <form id="form-sala" class="stack" novalidate style="margin-top:.8rem">
        <div class="row-2"><div class="field"><label for="s-codigo">Código</label><input id="s-codigo" value="${esc(v.codigo)}" placeholder="LAB-A103" required></div>
          <div class="field"><label for="s-tipo">Tipo</label><select id="s-tipo"><option value="LABORATORIO">Laboratorio</option><option value="SALA">Sala</option></select></div></div>
        <div class="field"><label for="s-nombre">Nombre</label><input id="s-nombre" value="${esc(v.nombre)}" required></div>
        <div class="row-2"><div class="field"><label for="s-capacidad">Capacidad (personas)</label><input id="s-capacidad" type="number" min="1" max="500" value="${v.capacidad}"></div>
          <div class="field"><label for="s-estado">Estado</label><select id="s-estado"><option value="DISPONIBLE">Disponible</option><option value="EN_MANTENIMIENTO">En mantenimiento</option><option value="INACTIVO">Inactivo</option></select></div></div>
        <div class="row-2"><div class="field"><label for="s-edificio">Edificio</label><select id="s-edificio">${eds.map(e => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('')}</select></div>
          <div class="field"><label for="s-ubicacion">Ubicación</label><input id="s-ubicacion" value="${esc(v.ubicacion)}" placeholder="Piso 2, ala norte"></div></div>
        <div id="s-lab" class="stack">
          <div class="field"><label for="s-tipolab">Tipo de laboratorio</label><input id="s-tipolab" value="${esc(v.tipo_lab || '')}" placeholder="Computación, Redes, Electrónica…"></div>
          <div class="field"><label for="s-equip">Equipamiento</label><input id="s-equip" value="${esc(v.equipamiento || '')}" placeholder="30 PC, proyector…"></div>
          <label class="check"><input type="checkbox" id="s-super"${v.requiere_supervisor ? ' checked' : ''}> Requiere supervisor (reservas estudiantiles quedan pendientes)</label>
        </div>
        <div id="s-sala" class="stack">
          <label class="check"><input type="checkbox" id="s-proy"${v.tiene_proyector ? ' checked' : ''}> Tiene proyector</label>
          <div class="field"><label for="s-dist">Distribución</label><input id="s-dist" value="${esc(v.distribucion || 'Mesa central')}"></div>
        </div>
        <div id="s-alert" class="alert" hidden></div>
        <div class="btn-row"><button type="submit" class="btn btn-primary">${r ? 'Guardar cambios' : 'Registrar'}</button><button type="button" class="btn btn-ghost" data-close>Cancelar</button></div>
      </form>`);
    $('s-tipo').value = v.tipo; $('s-estado').value = v.estado; $('s-edificio').value = v.edificio_id;
    const toggle = () => { const lab = $('s-tipo').value === 'LABORATORIO'; $('s-lab').hidden = !lab; $('s-sala').hidden = lab; };
    $('s-tipo').addEventListener('change', toggle); toggle();
    $('form-sala').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const d = { codigo: $('s-codigo').value, nombre: $('s-nombre').value, tipo: $('s-tipo').value, capacidad: Number($('s-capacidad').value), estado: $('s-estado').value,
        edificio_id: Number($('s-edificio').value), ubicacion: $('s-ubicacion').value, tipo_lab: $('s-tipolab').value, equipamiento: $('s-equip').value,
        requiere_supervisor: $('s-super').checked, tiene_proyector: $('s-proy').checked, distribucion: $('s-dist').value };
      try {
        const out = await api(r ? 'PUT' : 'POST', r ? `/api/recursos/${r.id}` : '/api/recursos', d);
        closeModal();
        toast(`${out.recurso.codigo} ${r ? 'actualizado' : 'registrado'}${out.afectadas.length ? ` · ${out.afectadas.length} reserva(s) futura(s) quedan fuera de capacidad o estado; revísalas en Administración` : ''}`);
        cargarSalas(); prepararFormularios();
      } catch (e) { alertBox($('s-alert'), 'bad', errorMsg(e), (e.errores || []).slice(1).map(x => esc(x.mensaje))); }
    });
  }

  /* ---------- Notificaciones ---------- */
  async function cargarNotificaciones() {
    try {
      const ns = await api('GET', '/api/notificaciones');
      const unread = ns.filter(n => !n.leida).length;
      $('notif-count').hidden = !unread; $('notif-count').textContent = unread;
      $('notif-list').innerHTML = ns.length ? ns.map(n => `<li class="${n.leida ? '' : 'unread'}">${esc(n.mensaje)}<time>${fechaCL(n.creada_en.slice(0, 10))} ${n.creada_en.slice(11, 16)}</time></li>`).join('') : '<li class="muted">Sin notificaciones.</li>';
    } catch (e) { /* sin sesión */ }
  }
  $('btn-notif').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const p = $('notif-panel'); p.hidden = !p.hidden; $('btn-notif').setAttribute('aria-expanded', String(!p.hidden));
  });
  $('btn-notif-read').addEventListener('click', async () => { await api('POST', '/api/notificaciones/leer'); cargarNotificaciones(); });
  document.addEventListener('click', (ev) => {
    if (!$('notif-panel').hidden && !ev.target.closest('.notif-wrap')) $('notif-panel').hidden = true;
    if (ev.target.matches('[data-close]')) closeModal();
    const go = ev.target.closest('[data-go]'); if (go) { closeModal(); navegar(go.dataset.go); }
  });
  $('modal-x').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (ev) => { if (ev.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('modal').hidden) closeModal(); });

  /* ---------- Arranque ---------- */
  $('btn-reset-demo').addEventListener('click', async () => { await window.Api.resetDemo(); S.user = null; mostrarLogin(); toast('Datos de demostración restablecidos'); });
  (async function boot() {
    try {
      const mode = await window.Api.init();
      $('demo-banner').hidden = mode !== 'local';
      if (window.Api.token) { try { await entrar(); return; } catch (e) { window.Api.setToken(null); } }
      mostrarLogin();
    } catch (e) {
      document.body.insertAdjacentHTML('afterbegin', `<p class="alert alert-bad" style="margin:16px">No se pudo iniciar la aplicación: ${esc(errorMsg(e))}</p>`);
    }
  })();
})();
