-- =====================================================================
--  Sistema de Reserva de Salas / Laboratorios — INACAP Valdivia
--  Script para MySQL 8.0.16+ / MariaDB 10.6+ (MySQL Workbench, XAMPP, phpMyAdmin)
--  Equivalente al esquema SQLite que usa la aplicación (database/schema.sql).
--  Crea la base, tablas, triggers de reglas de negocio, vistas y datos de prueba.
--  Contraseña de todos los usuarios de demostración: Reserva2026!
-- =====================================================================
DROP DATABASE IF EXISTS reserva_salas;
CREATE DATABASE reserva_salas CHARACTER SET utf8mb4 COLLATE utf8mb4_spanish_ci;
USE reserva_salas;
SET time_zone = '-03:00';   -- America/Santiago (horario de verano). Ajustar si corresponde.

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
CREATE TABLE parametro (
  clave       VARCHAR(40)  PRIMARY KEY,
  valor       VARCHAR(40)  NOT NULL,
  descripcion VARCHAR(150)
) ENGINE=InnoDB;

CREATE TABLE edificio (
  id      INT AUTO_INCREMENT PRIMARY KEY,
  nombre  VARCHAR(80) NOT NULL,
  campus  VARCHAR(60) NOT NULL,
  UNIQUE KEY uq_edificio (nombre, campus)
) ENGINE=InnoDB;

CREATE TABLE usuario (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(100) NOT NULL,
  correo        VARCHAR(120) NOT NULL UNIQUE,
  password_hash CHAR(64)     NOT NULL,
  salt          VARCHAR(32)  NOT NULL,
  rol           VARCHAR(15)  NOT NULL,
  activo        TINYINT(1)   NOT NULL DEFAULT 1,
  creado_en     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_usuario_rol CHECK (rol IN ('ESTUDIANTE','DOCENTE','ADMINISTRADOR'))
) ENGINE=InnoDB;

CREATE TABLE estudiante (
  usuario_id INT PRIMARY KEY,
  matricula  VARCHAR(20) NOT NULL UNIQUE,
  carrera    VARCHAR(80) NOT NULL,
  CONSTRAINT fk_est_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE docente (
  usuario_id   INT PRIMARY KEY,
  departamento VARCHAR(80) NOT NULL,
  CONSTRAINT fk_doc_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE administrador (
  usuario_id INT PRIMARY KEY,
  area       VARCHAR(80) NOT NULL DEFAULT 'Administración de espacios',
  CONSTRAINT fk_adm_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE sesion (
  token      VARCHAR(80) PRIMARY KEY,
  usuario_id INT NOT NULL,
  expira_en  DATETIME NOT NULL,
  CONSTRAINT fk_ses_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE recurso (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  codigo      VARCHAR(12)  NOT NULL UNIQUE,
  nombre      VARCHAR(80)  NOT NULL,
  tipo        VARCHAR(12)  NOT NULL,
  capacidad   SMALLINT     NOT NULL,
  ubicacion   VARCHAR(80)  NOT NULL,
  edificio_id INT          NOT NULL,
  estado      VARCHAR(20)  NOT NULL DEFAULT 'DISPONIBLE',
  creado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_rec_edificio FOREIGN KEY (edificio_id) REFERENCES edificio(id),
  CONSTRAINT ck_rec_tipo   CHECK (tipo IN ('LABORATORIO','SALA')),
  CONSTRAINT ck_rec_cap    CHECK (capacidad BETWEEN 1 AND 500),
  CONSTRAINT ck_rec_estado CHECK (estado IN ('DISPONIBLE','EN_MANTENIMIENTO','INACTIVO'))
) ENGINE=InnoDB;

CREATE TABLE laboratorio (
  recurso_id          INT PRIMARY KEY,
  tipo_lab            VARCHAR(40)  NOT NULL,
  equipamiento        VARCHAR(200) NOT NULL DEFAULT '',
  requiere_supervisor TINYINT(1)   NOT NULL DEFAULT 0,
  CONSTRAINT fk_lab_recurso FOREIGN KEY (recurso_id) REFERENCES recurso(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE sala (
  recurso_id      INT PRIMARY KEY,
  tiene_proyector TINYINT(1)  NOT NULL DEFAULT 0,
  distribucion    VARCHAR(40) NOT NULL DEFAULT 'Mesa central',
  CONSTRAINT fk_sala_recurso FOREIGN KEY (recurso_id) REFERENCES recurso(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE reserva (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  codigo        VARCHAR(12)  NOT NULL UNIQUE,
  usuario_id    INT          NOT NULL,
  recurso_id    INT          NOT NULL,
  fecha         DATE         NOT NULL,
  hora_inicio   TIME         NOT NULL,
  hora_fin      TIME         NOT NULL,
  motivo        VARCHAR(200) NOT NULL,
  asistentes    SMALLINT     NOT NULL DEFAULT 1,
  estado        VARCHAR(12)  NOT NULL DEFAULT 'CONFIRMADA',
  serie_id      VARCHAR(12),
  tipo_cancelacion   VARCHAR(20),
  motivo_cancelacion VARCHAR(200),
  creada_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelada_en   DATETIME NULL,
  CONSTRAINT fk_res_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id),
  CONSTRAINT fk_res_recurso FOREIGN KEY (recurso_id) REFERENCES recurso(id),
  CONSTRAINT ck_res_horas  CHECK (hora_fin > hora_inicio),
  CONSTRAINT ck_res_asist  CHECK (asistentes >= 1),
  CONSTRAINT ck_res_estado CHECK (estado IN ('PENDIENTE','CONFIRMADA','CANCELADA','FINALIZADA')),
  CONSTRAINT ck_res_tcanc  CHECK (tipo_cancelacion IS NULL OR tipo_cancelacion IN ('USUARIO','ADMINISTRADOR','PRIORIDAD_DOCENTE','SISTEMA')),
  INDEX ix_reserva_recurso_fecha (recurso_id, fecha, estado),
  INDEX ix_reserva_usuario (usuario_id, fecha),
  INDEX ix_reserva_serie (serie_id)
) ENGINE=InnoDB;

CREATE TABLE historial_reserva (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  reserva_id      INT NOT NULL,
  estado_anterior VARCHAR(12),
  estado_nuevo    VARCHAR(12) NOT NULL,
  detalle         VARCHAR(200),
  registrado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_hist_reserva FOREIGN KEY (reserva_id) REFERENCES reserva(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE notificacion (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  mensaje    VARCHAR(300) NOT NULL,
  leida      TINYINT(1) NOT NULL DEFAULT 0,
  creada_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Triggers (ValidadorConflictos en la base de datos)
-- ---------------------------------------------------------------------
DELIMITER $$

CREATE TRIGGER trg_reserva_validar_insert
BEFORE INSERT ON reserva FOR EACH ROW
BEGIN
  IF NEW.estado IN ('PENDIENTE','CONFIRMADA') THEN
    IF (SELECT estado FROM recurso WHERE id = NEW.recurso_id) <> 'DISPONIBLE' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RECURSO_NO_DISPONIBLE';
    END IF;
    IF NEW.hora_inicio < (SELECT CAST(valor AS TIME) FROM parametro WHERE clave = 'HORA_APERTURA')
       OR NEW.hora_fin > (SELECT CAST(valor AS TIME) FROM parametro WHERE clave = 'HORA_CIERRE')
       OR DAYOFWEEK(NEW.fecha) = 1 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FUERA_DE_HORARIO';
    END IF;
    IF TIMESTAMP(NEW.fecha, NEW.hora_inicio) < NOW() THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FECHA_PASADA';
    END IF;
    IF NEW.asistentes > (SELECT capacidad FROM recurso WHERE id = NEW.recurso_id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'EXCEDE_CAPACIDAD';
    END IF;
    IF EXISTS (SELECT 1 FROM reserva r
                WHERE r.recurso_id = NEW.recurso_id AND r.fecha = NEW.fecha
                  AND r.estado IN ('PENDIENTE','CONFIRMADA')
                  AND r.hora_inicio < NEW.hora_fin AND NEW.hora_inicio < r.hora_fin) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CONFLICTO_HORARIO';
    END IF;
  END IF;
END$$

CREATE TRIGGER trg_reserva_validar_update
BEFORE UPDATE ON reserva FOR EACH ROW
BEGIN
  IF NEW.estado <> OLD.estado THEN
    IF OLD.estado IN ('CANCELADA','FINALIZADA') OR (OLD.estado = 'CONFIRMADA' AND NEW.estado = 'PENDIENTE') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TRANSICION_INVALIDA';
    END IF;
    IF NEW.estado = 'CANCELADA' AND COALESCE(NEW.tipo_cancelacion,'USUARIO') = 'USUARIO'
       AND TIMESTAMPDIFF(MINUTE, NOW(), TIMESTAMP(OLD.fecha, OLD.hora_inicio))
           < 60 * (SELECT CAST(valor AS DECIMAL(10,2)) FROM parametro WHERE clave = 'HORAS_MIN_CANCELACION') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANCELACION_FUERA_DE_PLAZO';
    END IF;
    IF NEW.estado = 'CANCELADA' THEN SET NEW.cancelada_en = NOW(); END IF;
  END IF;
  IF NEW.estado IN ('PENDIENTE','CONFIRMADA')
     AND (NEW.fecha <> OLD.fecha OR NEW.hora_inicio <> OLD.hora_inicio OR NEW.hora_fin <> OLD.hora_fin OR NEW.recurso_id <> OLD.recurso_id)
     AND EXISTS (SELECT 1 FROM reserva r
                  WHERE r.id <> NEW.id AND r.recurso_id = NEW.recurso_id AND r.fecha = NEW.fecha
                    AND r.estado IN ('PENDIENTE','CONFIRMADA')
                    AND r.hora_inicio < NEW.hora_fin AND NEW.hora_inicio < r.hora_fin) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CONFLICTO_HORARIO';
  END IF;
  SET NEW.actualizada_en = NOW();
END$$

CREATE TRIGGER trg_reserva_historial_insert
AFTER INSERT ON reserva FOR EACH ROW
BEGIN
  INSERT INTO historial_reserva (reserva_id, estado_anterior, estado_nuevo, detalle)
  VALUES (NEW.id, NULL, NEW.estado, CONCAT('Reserva creada ', NEW.codigo));
END$$

CREATE TRIGGER trg_reserva_historial_update
AFTER UPDATE ON reserva FOR EACH ROW
BEGIN
  IF NEW.estado <> OLD.estado THEN
    INSERT INTO historial_reserva (reserva_id, estado_anterior, estado_nuevo, detalle)
    VALUES (NEW.id, OLD.estado, NEW.estado, COALESCE(NEW.motivo_cancelacion, 'Cambio de estado'));
  END IF;
END$$

-- Procedimiento de mantenimiento: marca como FINALIZADA lo que ya terminó
CREATE PROCEDURE sp_finalizar_vencidas()
BEGIN
  UPDATE reserva SET estado = 'FINALIZADA'
   WHERE estado = 'CONFIRMADA' AND TIMESTAMP(fecha, hora_fin) <= NOW();
  UPDATE reserva SET estado = 'CANCELADA', tipo_cancelacion = 'SISTEMA',
         motivo_cancelacion = 'Vencida sin aprobación del administrador'
   WHERE estado = 'PENDIENTE' AND TIMESTAMP(fecha, hora_inicio) <= NOW();
END$$

-- Calendario.horariosLibres(dia): bloques ocupados de un recurso en un día
CREATE PROCEDURE sp_ocupacion_dia(IN p_recurso INT, IN p_fecha DATE)
BEGIN
  SELECT hora_inicio, hora_fin, estado, u.rol AS rol_solicitante
    FROM reserva r JOIN usuario u ON u.id = r.usuario_id
   WHERE r.recurso_id = p_recurso AND r.fecha = p_fecha AND r.estado IN ('PENDIENTE','CONFIRMADA')
   ORDER BY hora_inicio;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------
-- Vistas
-- ---------------------------------------------------------------------
CREATE VIEW v_recurso AS
SELECT r.id, r.codigo, r.nombre, r.tipo, r.capacidad, r.ubicacion, r.estado,
       (r.estado = 'DISPONIBLE') AS activo, e.id AS edificio_id, e.nombre AS edificio, e.campus,
       l.tipo_lab, l.equipamiento, l.requiere_supervisor, s.tiene_proyector, s.distribucion
  FROM recurso r
  JOIN edificio e ON e.id = r.edificio_id
  LEFT JOIN laboratorio l ON l.recurso_id = r.id
  LEFT JOIN sala s ON s.recurso_id = r.id;

CREATE VIEW v_ocupacion_publica AS          -- HU02: sin datos personales
SELECT r.id, r.recurso_id, r.fecha, r.hora_inicio, r.hora_fin, r.estado, u.rol AS rol_solicitante
  FROM reserva r JOIN usuario u ON u.id = r.usuario_id
 WHERE r.estado IN ('PENDIENTE','CONFIRMADA');

CREATE VIEW v_reserva_detalle AS            -- HU10
SELECT r.id, r.codigo, r.fecha, r.hora_inicio, r.hora_fin, r.motivo, r.asistentes, r.estado, r.serie_id,
       r.tipo_cancelacion, r.motivo_cancelacion, r.creada_en, r.cancelada_en,
       u.id AS usuario_id, u.nombre AS usuario, u.correo, u.rol,
       rc.id AS recurso_id, rc.codigo AS recurso_codigo, rc.nombre AS recurso, rc.tipo AS recurso_tipo,
       rc.capacidad, e.nombre AS edificio
  FROM reserva r
  JOIN usuario u  ON u.id = r.usuario_id
  JOIN recurso rc ON rc.id = r.recurso_id
  JOIN edificio e ON e.id = rc.edificio_id;

CREATE VIEW v_calendario AS
SELECT recurso_id, DATE_FORMAT(fecha, '%Y-%m') AS mes, COUNT(*) AS total_reservas,
       SUM(estado IN ('PENDIENTE','CONFIRMADA')) AS activas,
       COALESCE(SUM(CASE WHEN estado IN ('CONFIRMADA','FINALIZADA')
                THEN TIMESTAMPDIFF(MINUTE, hora_inicio, hora_fin) END), 0) AS minutos_ocupados
  FROM reserva
 GROUP BY recurso_id, DATE_FORMAT(fecha, '%Y-%m');

-- ---------------------------------------------------------------------
-- Datos iniciales
-- ---------------------------------------------------------------------
INSERT INTO parametro (clave, valor, descripcion) VALUES
 ('HORA_APERTURA','08:00','Inicio del horario de reservas'),
 ('HORA_CIERRE','22:00','Término del horario de reservas'),
 ('HORAS_MIN_CANCELACION','2','HU04: anticipación mínima para cancelar (horas)'),
 ('MAX_RESERVAS_ACTIVAS_ESTUD','3','Reservas futuras activas permitidas por estudiante'),
 ('MAX_MINUTOS_ESTUDIANTE','180','Duración máxima de una reserva estudiantil (min)'),
 ('MAX_SEMANAS_RECURRENCIA','16','HU05: semanas máximas de una serie docente');

INSERT INTO edificio (id, nombre, campus) VALUES
 (1,'Edificio A — Informática','Sede Valdivia'),
 (2,'Edificio B — Biblioteca y Salas','Sede Valdivia'),
 (3,'Edificio C — Electricidad y Electrónica','Sede Valdivia');

INSERT INTO usuario (id, nombre, correo, password_hash, salt, rol) VALUES
 (1,'Marcela Vidal Torres','admin@inacap.cl','1e9dbe233fd987a32c567b9b2d195052c5c42ddbceb4ecabe48a5d3a5da668c6','s4lt-adm1','ADMINISTRADOR'),
 (2,'Paula Fernández Rojas','pfernandez@inacap.cl','c237409fc666a97d81a3ff31b6c81dac6fcbaac663d57595e3e62505a9968efc','s4lt-doc1','DOCENTE'),
 (3,'Rodrigo Saavedra Paz','rsaavedra@inacap.cl','37a0bd278e46ac9132cf80ce68559610a58625ac2e0003e0dc8a51b51e1bc8f9','s4lt-doc2','DOCENTE'),
 (4,'Ana Soto Henríquez','ana.soto@inacapmail.cl','7971c9acc807eb8ea6bc2ab4d086d348eae96f51ea1233ed53fb71d939384f2d','s4lt-est1','ESTUDIANTE'),
 (5,'Diego Muñoz Carrasco','diego.munoz@inacapmail.cl','83e02d1054b23ec7a74ed09c62432e75cfc959885124475a8a1f47c0c6d6bf50','s4lt-est2','ESTUDIANTE'),
 (6,'Valentina Reyes Ojeda','valentina.reyes@inacapmail.cl','2b299ed2d125c288b0b9f52ab10cc99eeb5044b23d3ce0f9242c5f4fd77921e1','s4lt-est3','ESTUDIANTE');

INSERT INTO administrador (usuario_id, area) VALUES (1,'Dirección de Operaciones — Sede Valdivia');
INSERT INTO docente (usuario_id, departamento) VALUES (2,'Área Informática y Telecomunicaciones'),(3,'Área Electricidad y Electrónica');
INSERT INTO estudiante (usuario_id, matricula, carrera) VALUES
 (4,'2024-11872','Ingeniería en Informática'),(5,'2025-03341','Analista Programador'),(6,'2023-09015','Ingeniería en Electricidad y Electrónica');

INSERT INTO recurso (id, codigo, nombre, tipo, capacidad, ubicacion, edificio_id, estado) VALUES
 (1,'LAB-A101','Laboratorio de Computación 1','LABORATORIO',30,'Piso 1, ala norte',1,'DISPONIBLE'),
 (2,'LAB-A102','Laboratorio de Redes','LABORATORIO',24,'Piso 1, ala sur',1,'DISPONIBLE'),
 (3,'LAB-C201','Laboratorio de Electrónica','LABORATORIO',20,'Piso 2',3,'DISPONIBLE'),
 (4,'LAB-C202','Laboratorio de Física','LABORATORIO',18,'Piso 2',3,'EN_MANTENIMIENTO'),
 (5,'SAL-B101','Sala de Estudio 1','SALA',8,'Biblioteca, piso 1',2,'DISPONIBLE'),
 (6,'SAL-B102','Sala de Estudio 2','SALA',6,'Biblioteca, piso 1',2,'DISPONIBLE'),
 (7,'SAL-A201','Sala Multiuso','SALA',40,'Piso 2',1,'DISPONIBLE');

INSERT INTO laboratorio VALUES
 (1,'Computación','30 PC i5, proyector, pizarra interactiva',0),
 (2,'Redes','Racks Cisco, switches, routers, 12 PC',1),
 (3,'Electrónica','Osciloscopios, fuentes, multímetros',1),
 (4,'Física','Kits de mecánica y óptica',1);
INSERT INTO sala VALUES (5,1,'Mesa central'),(6,0,'Mesa central'),(7,1,'Auditorio');

-- Próximos días hábiles (lunes a sábado) desde mañana
CREATE TEMPORARY TABLE dia AS
WITH RECURSIVE c (n, d) AS (
  SELECT 1, CURDATE() + INTERVAL 1 DAY
  UNION ALL SELECT n + 1, d + INTERVAL 1 DAY FROM c WHERE n < 12)
SELECT ROW_NUMBER() OVER (ORDER BY d) AS n, d FROM c WHERE DAYOFWEEK(d) <> 1;

INSERT INTO reserva (codigo, usuario_id, recurso_id, fecha, hora_inicio, hora_fin, motivo, asistentes, estado)
SELECT x.codigo, x.u, x.r, dia.d, x.hi, x.hf, x.motivo, x.a, x.estado
  FROM (
   SELECT 'RS-DEMO01' codigo, 2 u, 1 r, 1 n, '08:30' hi, '10:00' hf, 'Clase práctica de Programación Orientada a Objetos' motivo, 28 a, 'CONFIRMADA' estado UNION ALL
   SELECT 'RS-DEMO02', 4, 1, 1, '14:00', '15:30', 'Estudio grupal de Base de Datos', 5, 'CONFIRMADA' UNION ALL
   SELECT 'RS-DEMO03', 5, 5, 1, '10:00', '12:00', 'Preparación de prueba de Cálculo', 4, 'CONFIRMADA' UNION ALL
   SELECT 'RS-DEMO04', 6, 3, 2, '15:00', '17:00', 'Montaje de circuito para proyecto', 3, 'PENDIENTE' UNION ALL
   SELECT 'RS-DEMO05', 3, 3, 2, '09:00', '11:30', 'Laboratorio de Circuitos Digitales', 18, 'CONFIRMADA' UNION ALL
   SELECT 'RS-DEMO06', 6, 6, 2, '11:00', '12:30', 'Reunión de equipo Scrum — Sprint Review', 5, 'CONFIRMADA' UNION ALL
   SELECT 'RS-DEMO07', 2, 7, 3, '18:00', '20:00', 'Charla de Metodologías Ágiles', 35, 'CONFIRMADA' UNION ALL
   SELECT 'RS-DEMO08', 5, 2, 3, '16:00', '17:30', 'Práctica de configuración VLAN', 4, 'PENDIENTE' UNION ALL
   SELECT 'RS-DEMO09', 6, 5, 4, '12:00', '13:30', 'Estudio individual', 1, 'CONFIRMADA' UNION ALL
   SELECT 'RS-DEMO10', 2, 1, 5, '08:30', '10:00', 'Clase práctica de Programación Orientada a Objetos', 28, 'CONFIRMADA'
  ) x JOIN dia ON dia.n = x.n
 ORDER BY x.codigo;

INSERT INTO reserva (codigo, usuario_id, recurso_id, fecha, hora_inicio, hora_fin, motivo, asistentes, estado, tipo_cancelacion, motivo_cancelacion) VALUES
 ('RS-HIST01',4,5,CURDATE() - INTERVAL 6 DAY,'10:00','11:30','Estudio grupal de Programación',4,'FINALIZADA',NULL,NULL),
 ('RS-HIST02',2,1,CURDATE() - INTERVAL 5 DAY,'08:30','10:00','Clase práctica de Programación Orientada a Objetos',27,'FINALIZADA',NULL,NULL),
 ('RS-HIST03',5,2,CURDATE() - INTERVAL 4 DAY,'15:00','16:00','Práctica de subnetting',3,'CANCELADA','USUARIO','Cancelada por el usuario'),
 ('RS-HIST04',6,3,CURDATE() - INTERVAL 3 DAY,'09:00','10:30','Medición con osciloscopio',2,'FINALIZADA',NULL,NULL),
 ('RS-HIST05',3,7,CURDATE() - INTERVAL 2 DAY,'18:00','19:30','Seminario de Energías Renovables',32,'FINALIZADA',NULL,NULL);

INSERT INTO notificacion (usuario_id, mensaje) VALUES
 (4,'Tu reserva RS-DEMO02 en Laboratorio de Computación 1 está confirmada.'),
 (6,'Tu reserva RS-DEMO04 en Laboratorio de Electrónica requiere aprobación: el laboratorio exige supervisor.');

DROP TEMPORARY TABLE dia;

-- ---------------------------------------------------------------------
-- Consultas de ejemplo
-- ---------------------------------------------------------------------
-- Disponibilidad pública de un laboratorio en la semana (HU01/HU02):
--   SELECT * FROM v_ocupacion_publica WHERE recurso_id = 1 AND fecha BETWEEN CURDATE() AND CURDATE() + INTERVAL 6 DAY;
-- Reservas filtradas por rango de fechas (HU10/HU11):
--   SELECT codigo, DATE_FORMAT(fecha,'%d-%m-%Y') AS fecha, hora_inicio, hora_fin, recurso, usuario, estado
--     FROM v_reserva_detalle WHERE fecha BETWEEN '2026-10-19' AND '2026-10-24' ORDER BY fecha, hora_inicio;
-- Prueba de la regla HU07 (debe fallar con CONFLICTO_HORARIO):
--   INSERT INTO reserva (codigo, usuario_id, recurso_id, fecha, hora_inicio, hora_fin, motivo)
--   SELECT 'RS-PRUEBA', 5, recurso_id, fecha, hora_inicio, hora_fin, 'Duplicada' FROM reserva WHERE codigo = 'RS-DEMO02';
