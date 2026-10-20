-- =====================================================================
--  Datos iniciales y de demostración (SQLite)
--  Contraseña de todos los usuarios de demostración: Reserva2026!
--  Las fechas de las reservas se calculan desde el día de carga,
--  para que el calendario siempre muestre ocupación futura.
-- =====================================================================

INSERT INTO parametro (clave, valor, descripcion) VALUES
 ('HORA_APERTURA',               '08:00', 'Inicio del horario de reservas'),
 ('HORA_CIERRE',                 '22:00', 'Término del horario de reservas'),
 ('HORAS_MIN_CANCELACION',       '2',     'HU04: anticipación mínima para cancelar (horas)'),
 ('MAX_RESERVAS_ACTIVAS_ESTUD',  '3',     'Reservas futuras activas permitidas por estudiante'),
 ('MAX_MINUTOS_ESTUDIANTE',      '180',   'Duración máxima de una reserva estudiantil (min)'),
 ('MAX_SEMANAS_RECURRENCIA',     '16',    'HU05: semanas máximas de una serie docente');

INSERT INTO edificio (id, nombre, campus) VALUES
 (1, 'Edificio A — Informática', 'Sede Valdivia'),
 (2, 'Edificio B — Biblioteca y Salas', 'Sede Valdivia'),
 (3, 'Edificio C — Electricidad y Electrónica', 'Sede Valdivia');

INSERT INTO usuario (id, nombre, correo, password_hash, salt, rol) VALUES
 (1, 'Marcela Vidal Torres',   'admin@inacap.cl',        '1e9dbe233fd987a32c567b9b2d195052c5c42ddbceb4ecabe48a5d3a5da668c6', 's4lt-adm1', 'ADMINISTRADOR'),
 (2, 'Paula Fernández Rojas',  'pfernandez@inacap.cl',   'c237409fc666a97d81a3ff31b6c81dac6fcbaac663d57595e3e62505a9968efc', 's4lt-doc1', 'DOCENTE'),
 (3, 'Rodrigo Saavedra Paz',   'rsaavedra@inacap.cl',    '37a0bd278e46ac9132cf80ce68559610a58625ac2e0003e0dc8a51b51e1bc8f9', 's4lt-doc2', 'DOCENTE'),
 (4, 'Ana Soto Henríquez',     'ana.soto@inacapmail.cl', '7971c9acc807eb8ea6bc2ab4d086d348eae96f51ea1233ed53fb71d939384f2d', 's4lt-est1', 'ESTUDIANTE'),
 (5, 'Diego Muñoz Carrasco',   'diego.munoz@inacapmail.cl','83e02d1054b23ec7a74ed09c62432e75cfc959885124475a8a1f47c0c6d6bf50', 's4lt-est2', 'ESTUDIANTE'),
 (6, 'Valentina Reyes Ojeda',  'valentina.reyes@inacapmail.cl','2b299ed2d125c288b0b9f52ab10cc99eeb5044b23d3ce0f9242c5f4fd77921e1', 's4lt-est3', 'ESTUDIANTE');

INSERT INTO administrador (usuario_id, area) VALUES (1, 'Dirección de Operaciones — Sede Valdivia');
INSERT INTO docente (usuario_id, departamento) VALUES
 (2, 'Área Informática y Telecomunicaciones'),
 (3, 'Área Electricidad y Electrónica');
INSERT INTO estudiante (usuario_id, matricula, carrera) VALUES
 (4, '2024-11872', 'Ingeniería en Informática'),
 (5, '2025-03341', 'Analista Programador'),
 (6, '2023-09015', 'Ingeniería en Electricidad y Electrónica');

INSERT INTO recurso (id, codigo, nombre, tipo, capacidad, ubicacion, edificio_id, estado) VALUES
 (1, 'LAB-A101', 'Laboratorio de Computación 1', 'LABORATORIO', 30, 'Piso 1, ala norte', 1, 'DISPONIBLE'),
 (2, 'LAB-A102', 'Laboratorio de Redes',         'LABORATORIO', 24, 'Piso 1, ala sur',   1, 'DISPONIBLE'),
 (3, 'LAB-C201', 'Laboratorio de Electrónica',   'LABORATORIO', 20, 'Piso 2',            3, 'DISPONIBLE'),
 (4, 'LAB-C202', 'Laboratorio de Física',        'LABORATORIO', 18, 'Piso 2',            3, 'EN_MANTENIMIENTO'),
 (5, 'SAL-B101', 'Sala de Estudio 1',            'SALA',         8, 'Biblioteca, piso 1',2, 'DISPONIBLE'),
 (6, 'SAL-B102', 'Sala de Estudio 2',            'SALA',         6, 'Biblioteca, piso 1',2, 'DISPONIBLE'),
 (7, 'SAL-A201', 'Sala Multiuso',                'SALA',        40, 'Piso 2',            1, 'DISPONIBLE');

INSERT INTO laboratorio (recurso_id, tipo_lab, equipamiento, requiere_supervisor) VALUES
 (1, 'Computación', '30 PC i5, proyector, pizarra interactiva', 0),
 (2, 'Redes',       'Racks Cisco, switches, routers, 12 PC',    1),
 (3, 'Electrónica', 'Osciloscopios, fuentes, multímetros',      1),
 (4, 'Física',      'Kits de mecánica y óptica',                1);

INSERT INTO sala (recurso_id, tiene_proyector, distribucion) VALUES
 (5, 1, 'Mesa central'),
 (6, 0, 'Mesa central'),
 (7, 1, 'Auditorio');

-- Próximos 8 días hábiles (lunes a sábado) desde mañana
CREATE TEMP TABLE dia AS
WITH RECURSIVE c(n, d) AS (
  SELECT 1, date('now','localtime','+1 day')
  UNION ALL SELECT n + 1, date(d, '+1 day') FROM c WHERE n < 12)
SELECT row_number() OVER (ORDER BY d) AS n, d FROM c WHERE strftime('%w', d) <> '0';

INSERT INTO reserva (codigo, usuario_id, recurso_id, fecha, hora_inicio, hora_fin, motivo, asistentes, estado) VALUES
 ('RS-DEMO01', 2, 1, (SELECT d FROM dia WHERE n=1), '08:30', '10:00', 'Clase práctica de Programación Orientada a Objetos', 28, 'CONFIRMADA'),
 ('RS-DEMO02', 4, 1, (SELECT d FROM dia WHERE n=1), '14:00', '15:30', 'Estudio grupal de Base de Datos', 5, 'CONFIRMADA'),
 ('RS-DEMO03', 5, 5, (SELECT d FROM dia WHERE n=1), '10:00', '12:00', 'Preparación de prueba de Cálculo', 4, 'CONFIRMADA'),
 ('RS-DEMO04', 6, 3, (SELECT d FROM dia WHERE n=2), '15:00', '17:00', 'Montaje de circuito para proyecto', 3, 'PENDIENTE'),
 ('RS-DEMO05', 3, 3, (SELECT d FROM dia WHERE n=2), '09:00', '11:30', 'Laboratorio de Circuitos Digitales', 18, 'CONFIRMADA'),
 ('RS-DEMO06', 6, 6, (SELECT d FROM dia WHERE n=2), '11:00', '12:30', 'Reunión de equipo Scrum — Sprint Review', 5, 'CONFIRMADA'),
 ('RS-DEMO07', 2, 7, (SELECT d FROM dia WHERE n=3), '18:00', '20:00', 'Charla de Metodologías Ágiles', 35, 'CONFIRMADA'),
 ('RS-DEMO08', 5, 2, (SELECT d FROM dia WHERE n=3), '16:00', '17:30', 'Práctica de configuración VLAN', 4, 'PENDIENTE'),
 ('RS-DEMO09', 6, 5, (SELECT d FROM dia WHERE n=4), '12:00', '13:30', 'Estudio individual', 1, 'CONFIRMADA'),
 ('RS-DEMO10', 2, 1, (SELECT d FROM dia WHERE n=5), '08:30', '10:00', 'Clase práctica de Programación Orientada a Objetos', 28, 'CONFIRMADA');

-- Historial (reservas pasadas, para métricas e informes)
INSERT INTO reserva (codigo, usuario_id, recurso_id, fecha, hora_inicio, hora_fin, motivo, asistentes, estado, tipo_cancelacion, motivo_cancelacion) VALUES
 ('RS-HIST01', 4, 5, date('now','localtime','-6 days'), '10:00', '11:30', 'Estudio grupal de Programación', 4, 'FINALIZADA', NULL, NULL),
 ('RS-HIST02', 2, 1, date('now','localtime','-5 days'), '08:30', '10:00', 'Clase práctica de Programación Orientada a Objetos', 27, 'FINALIZADA', NULL, NULL),
 ('RS-HIST03', 5, 2, date('now','localtime','-4 days'), '15:00', '16:00', 'Práctica de subnetting', 3, 'CANCELADA', 'USUARIO', 'Cancelada por el usuario'),
 ('RS-HIST04', 6, 3, date('now','localtime','-3 days'), '09:00', '10:30', 'Medición con osciloscopio', 2, 'FINALIZADA', NULL, NULL),
 ('RS-HIST05', 3, 7, date('now','localtime','-2 days'), '18:00', '19:30', 'Seminario de Energías Renovables', 32, 'FINALIZADA', NULL, NULL);

INSERT INTO notificacion (usuario_id, mensaje) VALUES
 (4, 'Tu reserva RS-DEMO02 en Laboratorio de Computación 1 está confirmada.'),
 (6, 'Tu reserva RS-DEMO04 en Laboratorio de Electrónica requiere aprobación: el laboratorio exige supervisor.');

DROP TABLE dia;
