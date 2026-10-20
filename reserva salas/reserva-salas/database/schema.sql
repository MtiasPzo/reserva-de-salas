-- =====================================================================
--  Sistema de Reserva de Salas / Laboratorios — INACAP Valdivia
--  Base de datos (SQLite 3.35+). Responsable BD: Camila Urrutia
--  Modelo derivado del diagrama de clases del proyecto:
--    Usuario (Estudiante, Docente, Administrador) — realiza — Reserva
--    Reserva — reservado en — Recurso (Laboratorio, Sala)
--    Edificio — contiene — Recurso ;  Recurso — tiene — Calendario
--    EstadoReserva = PENDIENTE | CONFIRMADA | CANCELADA | FINALIZADA
--  Las reglas críticas (HU04, HU07, capacidad, horario) se aplican aquí
--  mediante triggers, además de en la capa de servicio (defensa en profundidad).
-- =====================================================================
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- Parámetros de negocio (editables por el administrador)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parametro (
  clave       TEXT PRIMARY KEY,
  valor       TEXT NOT NULL,
  descripcion TEXT
);

-- ---------------------------------------------------------------------
-- Edificio (1) ◇— contiene — (*) Recurso
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edificio (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre  TEXT NOT NULL,
  campus  TEXT NOT NULL,
  UNIQUE (nombre, campus)
);

-- ---------------------------------------------------------------------
-- Usuario y especializaciones (herencia: tabla por subclase)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuario (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre        TEXT NOT NULL,
  correo        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,          -- SHA-256(salt || contraseña)
  salt          TEXT NOT NULL,
  rol           TEXT NOT NULL CHECK (rol IN ('ESTUDIANTE','DOCENTE','ADMINISTRADOR')),
  activo        INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  creado_en     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS estudiante (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuario(id) ON DELETE CASCADE,
  matricula  TEXT NOT NULL UNIQUE,
  carrera    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS docente (
  usuario_id   INTEGER PRIMARY KEY REFERENCES usuario(id) ON DELETE CASCADE,
  departamento TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS administrador (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuario(id) ON DELETE CASCADE,
  area       TEXT NOT NULL DEFAULT 'Administración de espacios'
);

-- Sesiones de autenticación (token opaco, expira)
CREATE TABLE IF NOT EXISTS sesion (
  token      TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  expira_en  TEXT NOT NULL
);

-- ---------------------------------------------------------------------
-- Recurso y especializaciones (Laboratorio, Sala)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recurso (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nombre      TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('LABORATORIO','SALA')),
  capacidad   INTEGER NOT NULL CHECK (capacidad BETWEEN 1 AND 500),
  ubicacion   TEXT NOT NULL,
  edificio_id INTEGER NOT NULL REFERENCES edificio(id),
  estado      TEXT NOT NULL DEFAULT 'DISPONIBLE'
              CHECK (estado IN ('DISPONIBLE','EN_MANTENIMIENTO','INACTIVO')),
  creado_en      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS laboratorio (
  recurso_id          INTEGER PRIMARY KEY REFERENCES recurso(id) ON DELETE CASCADE,
  tipo_lab            TEXT NOT NULL,
  equipamiento        TEXT NOT NULL DEFAULT '',
  requiere_supervisor INTEGER NOT NULL DEFAULT 0 CHECK (requiere_supervisor IN (0,1))
);

CREATE TABLE IF NOT EXISTS sala (
  recurso_id      INTEGER PRIMARY KEY REFERENCES recurso(id) ON DELETE CASCADE,
  tiene_proyector INTEGER NOT NULL DEFAULT 0 CHECK (tiene_proyector IN (0,1)),
  distribucion    TEXT NOT NULL DEFAULT 'Mesa central'
);

-- ---------------------------------------------------------------------
-- Reserva  (Usuario 1 — * Reserva * — 1 Recurso)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reserva (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo        TEXT NOT NULL UNIQUE,                -- HU06: código único
  usuario_id    INTEGER NOT NULL REFERENCES usuario(id),
  recurso_id    INTEGER NOT NULL REFERENCES recurso(id),
  fecha         TEXT NOT NULL CHECK (fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  hora_inicio   TEXT NOT NULL CHECK (hora_inicio GLOB '[0-2][0-9]:[0-5][0-9]'),
  hora_fin      TEXT NOT NULL CHECK (hora_fin    GLOB '[0-2][0-9]:[0-5][0-9]'),
  motivo        TEXT NOT NULL CHECK (length(trim(motivo)) >= 3),
  asistentes    INTEGER NOT NULL DEFAULT 1 CHECK (asistentes >= 1),
  estado        TEXT NOT NULL DEFAULT 'CONFIRMADA'
                CHECK (estado IN ('PENDIENTE','CONFIRMADA','CANCELADA','FINALIZADA')),
  serie_id      TEXT,                                 -- HU05: reservas recurrentes
  tipo_cancelacion TEXT CHECK (tipo_cancelacion IN ('USUARIO','ADMINISTRADOR','PRIORIDAD_DOCENTE','SISTEMA')),
  motivo_cancelacion TEXT,
  creada_en      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  actualizada_en TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  cancelada_en   TEXT,
  CHECK (hora_fin > hora_inicio)
);

CREATE INDEX IF NOT EXISTS ix_reserva_recurso_fecha ON reserva (recurso_id, fecha, estado);
CREATE INDEX IF NOT EXISTS ix_reserva_usuario       ON reserva (usuario_id, fecha);
CREATE INDEX IF NOT EXISTS ix_reserva_serie         ON reserva (serie_id);

-- Historial de cambios de estado (trazabilidad / auditoría)
CREATE TABLE IF NOT EXISTS historial_reserva (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  reserva_id      INTEGER NOT NULL REFERENCES reserva(id) ON DELETE CASCADE,
  estado_anterior TEXT,
  estado_nuevo    TEXT NOT NULL,
  detalle         TEXT,
  registrado_en   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Notificaciones en pantalla (confirmaciones, desplazamientos por prioridad docente)
CREATE TABLE IF NOT EXISTS notificacion (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  mensaje    TEXT NOT NULL,
  leida      INTEGER NOT NULL DEFAULT 0 CHECK (leida IN (0,1)),
  creada_en  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- =====================================================================
--  TRIGGERS — ValidadorConflictos a nivel de base de datos
-- =====================================================================

-- Validaciones al crear una reserva activa (PENDIENTE o CONFIRMADA)
CREATE TRIGGER IF NOT EXISTS trg_reserva_validar_insert
BEFORE INSERT ON reserva
WHEN NEW.estado IN ('PENDIENTE','CONFIRMADA')
BEGIN
  -- Recurso debe existir y estar disponible (HU09: "En mantenimiento" bloquea)
  SELECT RAISE(ABORT, 'RECURSO_NO_DISPONIBLE')
   WHERE (SELECT estado FROM recurso WHERE id = NEW.recurso_id) IS NOT 'DISPONIBLE';
  -- fueraDeHorario(): dentro del horario de atención y de lunes a sábado
  SELECT RAISE(ABORT, 'FUERA_DE_HORARIO')
   WHERE NEW.hora_inicio < (SELECT valor FROM parametro WHERE clave = 'HORA_APERTURA')
      OR NEW.hora_fin    > (SELECT valor FROM parametro WHERE clave = 'HORA_CIERRE')
      OR strftime('%w', NEW.fecha) = '0';
  -- No se reserva en el pasado
  SELECT RAISE(ABORT, 'FECHA_PASADA')
   WHERE datetime(NEW.fecha || ' ' || NEW.hora_inicio) < datetime('now','localtime');
  -- excedeCapacidad()
  SELECT RAISE(ABORT, 'EXCEDE_CAPACIDAD')
   WHERE NEW.asistentes > (SELECT capacidad FROM recurso WHERE id = NEW.recurso_id);
  -- HU07 existeSolapamiento(): misma sala, mismo día, intervalos que se cruzan
  SELECT RAISE(ABORT, 'CONFLICTO_HORARIO')
   WHERE EXISTS (
     SELECT 1 FROM reserva r
      WHERE r.recurso_id = NEW.recurso_id
        AND r.fecha      = NEW.fecha
        AND r.estado IN ('PENDIENTE','CONFIRMADA')
        AND r.hora_inicio < NEW.hora_fin
        AND NEW.hora_inicio < r.hora_fin);
END;

-- Transiciones válidas de EstadoReserva
--   PENDIENTE  -> CONFIRMADA | CANCELADA | FINALIZADA
--   CONFIRMADA -> CANCELADA  | FINALIZADA
--   CANCELADA / FINALIZADA son estados finales
CREATE TRIGGER IF NOT EXISTS trg_reserva_transicion
BEFORE UPDATE OF estado ON reserva
WHEN NEW.estado <> OLD.estado
BEGIN
  SELECT RAISE(ABORT, 'TRANSICION_INVALIDA')
   WHERE OLD.estado IN ('CANCELADA','FINALIZADA')
      OR (OLD.estado = 'CONFIRMADA' AND NEW.estado = 'PENDIENTE');
  -- HU04: el usuario no puede cancelar con menos de 2 horas de anticipación
  SELECT RAISE(ABORT, 'CANCELACION_FUERA_DE_PLAZO')
   WHERE NEW.estado = 'CANCELADA'
     AND COALESCE(NEW.tipo_cancelacion,'USUARIO') = 'USUARIO'
     AND (julianday(OLD.fecha || ' ' || OLD.hora_inicio) - julianday('now','localtime')) * 24.0
         < CAST((SELECT valor FROM parametro WHERE clave = 'HORAS_MIN_CANCELACION') AS REAL);
END;

-- Una reserva reactivada/modificada tampoco puede solaparse
CREATE TRIGGER IF NOT EXISTS trg_reserva_validar_update
BEFORE UPDATE OF fecha, hora_inicio, hora_fin, recurso_id ON reserva
WHEN NEW.estado IN ('PENDIENTE','CONFIRMADA')
BEGIN
  SELECT RAISE(ABORT, 'CONFLICTO_HORARIO')
   WHERE EXISTS (
     SELECT 1 FROM reserva r
      WHERE r.id <> NEW.id
        AND r.recurso_id = NEW.recurso_id
        AND r.fecha      = NEW.fecha
        AND r.estado IN ('PENDIENTE','CONFIRMADA')
        AND r.hora_inicio < NEW.hora_fin
        AND NEW.hora_inicio < r.hora_fin);
END;

-- Auditoría: alta y cambios de estado + sello de actualización
CREATE TRIGGER IF NOT EXISTS trg_reserva_historial_insert
AFTER INSERT ON reserva
BEGIN
  INSERT INTO historial_reserva (reserva_id, estado_anterior, estado_nuevo, detalle)
  VALUES (NEW.id, NULL, NEW.estado, 'Reserva creada ' || NEW.codigo);
END;

CREATE TRIGGER IF NOT EXISTS trg_reserva_historial_update
AFTER UPDATE OF estado ON reserva
WHEN NEW.estado <> OLD.estado
BEGIN
  INSERT INTO historial_reserva (reserva_id, estado_anterior, estado_nuevo, detalle)
  VALUES (NEW.id, OLD.estado, NEW.estado, COALESCE(NEW.motivo_cancelacion, 'Cambio de estado'));
  UPDATE reserva
     SET actualizada_en = datetime('now','localtime'),
         cancelada_en   = CASE WHEN NEW.estado = 'CANCELADA' THEN datetime('now','localtime') ELSE cancelada_en END
   WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_recurso_actualizado
AFTER UPDATE ON recurso
WHEN NEW.actualizado_en = OLD.actualizado_en
BEGIN
  UPDATE recurso SET actualizado_en = datetime('now','localtime') WHERE id = NEW.id;
END;

-- =====================================================================
--  VISTAS
-- =====================================================================

-- Recursos con datos de su especialización (Laboratorio / Sala) y edificio
CREATE VIEW IF NOT EXISTS v_recurso AS
SELECT r.id, r.codigo, r.nombre, r.tipo, r.capacidad, r.ubicacion, r.estado,
       (r.estado = 'DISPONIBLE') AS activo,
       e.id AS edificio_id, e.nombre AS edificio, e.campus,
       l.tipo_lab, l.equipamiento, l.requiere_supervisor,
       s.tiene_proyector, s.distribucion
  FROM recurso r
  JOIN edificio e      ON e.id = r.edificio_id
  LEFT JOIN laboratorio l ON l.recurso_id = r.id
  LEFT JOIN sala s        ON s.recurso_id = r.id;

-- HU02: ocupación pública SIN datos personales (solo rol de quien reservó)
CREATE VIEW IF NOT EXISTS v_ocupacion_publica AS
SELECT r.id, r.recurso_id, r.fecha, r.hora_inicio, r.hora_fin, r.estado,
       u.rol AS rol_solicitante, r.usuario_id
  FROM reserva r
  JOIN usuario u ON u.id = r.usuario_id
 WHERE r.estado IN ('PENDIENTE','CONFIRMADA');

-- HU10: vista administrativa consolidada
CREATE VIEW IF NOT EXISTS v_reserva_detalle AS
SELECT r.id, r.codigo, r.fecha, r.hora_inicio, r.hora_fin, r.motivo, r.asistentes,
       r.estado, r.serie_id, r.tipo_cancelacion, r.motivo_cancelacion,
       r.creada_en, r.cancelada_en,
       u.id AS usuario_id, u.nombre AS usuario, u.correo, u.rol,
       rc.id AS recurso_id, rc.codigo AS recurso_codigo, rc.nombre AS recurso,
       rc.tipo AS recurso_tipo, rc.capacidad, e.nombre AS edificio
  FROM reserva r
  JOIN usuario u  ON u.id  = r.usuario_id
  JOIN recurso rc ON rc.id = r.recurso_id
  JOIN edificio e ON e.id  = rc.edificio_id;

-- Calendario (clase del diagrama): agrupación lógica de reservas por recurso y mes
CREATE VIEW IF NOT EXISTS v_calendario AS
SELECT recurso_id, substr(fecha,1,7) AS mes,
       COUNT(*) AS total_reservas,
       SUM(estado IN ('PENDIENTE','CONFIRMADA')) AS activas,
       COALESCE(SUM((CAST(substr(hora_fin,1,2) AS INTEGER)*60 + CAST(substr(hora_fin,4,2) AS INTEGER)) -
           (CAST(substr(hora_inicio,1,2) AS INTEGER)*60 + CAST(substr(hora_inicio,4,2) AS INTEGER)))
         FILTER (WHERE estado IN ('CONFIRMADA','FINALIZADA')), 0) AS minutos_ocupados
  FROM reserva
 GROUP BY recurso_id, substr(fecha,1,7);
