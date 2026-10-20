# ReservaLab — Sistema de Reserva de Salas / Laboratorios

Proyecto de **Metodología de Desarrollo Ágil (TI3023) · INACAP Valdivia**.
Aplicación web para consultar la disponibilidad de salas y laboratorios, reservar en bloques de 30 minutos,
recibir un código de confirmación y administrar los espacios.

| Rol Scrum | Integrante |
|---|---|
| Product Owner | Lucas Jiménez |
| Scrum Master | Jonathan Rivera |
| Desarrollador | Matías Pozo |
| Desarrolladora — Base de Datos | Camila Urrutia |
| QA / Diseño de interfaz | José Castro |

## Requisitos

- Node.js 22.13 o superior (recomendado Node.js 24 LTS). Usa el SQLite incluido en Node, sin librerías nativas.
- Opcional: MySQL 8.0.16+ o MariaDB 10.6+ si se quiere revisar el modelo en Workbench / phpMyAdmin.

## Instalación y ejecución

**En Windows, sin comandos:** haz doble clic en `iniciar.bat` (la primera vez instala lo necesario y luego abre la página). Para volver a los datos de `database/seed.sql`, usa `reiniciar-base.bat`.

Con terminal:

```bash
npm install
npm start            # http://localhost:3000
npm run reset-db     # borra data/reservas.db y vuelve a cargar los datos de ejemplo
npm test             # 19 pruebas automatizadas (node --test)
```

Variables opcionales: `PORT` (3000), `DB_FILE` (`data/reservas.db`), `TZ` (`America/Santiago`).

### Cuentas de prueba

| Perfil | Correo | Contraseña |
|---|---|---|
| Administradora | admin@inacap.cl | `camilita1` |
| Docente | ljimenez@inacap.cl | `luquitas1` |
| Docente | jrivera@inacap.cl | `jonathancito1` |
| Estudiante | jose.castro@inacapmail.cl | `eduardito1` |
| Estudiante | matias.pozo@inacapmail.cl | `maaatiaaaspoozooo` |
| Estudiante | sebastian.delgado@inacapmail.cl | `donsebastian` |

### Modo demostración

Si `public/index.html` se sirve sin el backend (por ejemplo, en un hosting estático), la aplicación
levanta la **misma base SQLite en el navegador** con [sql.js](https://sql.js.org) y ejecuta la misma capa de
servicio (`src/service.js`) y tabla de rutas (`src/routes.js`). Los datos quedan en el navegador.

## Estructura

```
server.js                 Servidor Express (API REST + archivos estáticos)
src/service.js            Lógica de negocio: GestorReservas, ValidadorConflictos, Calendario
src/routes.js             Rutas de la API (compartidas por servidor y modo demo)
src/db-node.js            Adaptador SQLite (node:sqlite incluido en Node.js)
database/schema.sql       Esquema SQLite: tablas, triggers, vistas
database/seed.sql         Datos iniciales y de demostración
database/mysql/…sql       Script equivalente para MySQL / MariaDB
public/                   Interfaz web (HTML, CSS, JS) con paleta clara y oscura
tests/reservas.test.js    Pruebas automatizadas de los criterios de aceptación
scripts/capturas.py       Genera capturas de pantalla con Playwright
```

## Historias de usuario implementadas

| HU | Funcionalidad | Dónde |
|---|---|---|
| HU01 | Calendario semanal de disponibilidad con colores (libre / ocupado / mía / pendiente) | Reservar |
| HU02 | Reservas existentes sin datos personales (vista `v_ocupacion_publica`) | Reservar |
| HU03 | Crear reserva con validación y bloqueo del horario (requiere sesión) | Reservar |
| HU04 | Cancelar (borrado lógico) hasta 2 h antes; trigger `CANCELACION_FUERA_DE_PLAZO` | Mis reservas |
| HU05 | Reserva docente por bloque o serie semanal, con prioridad sobre estudiantes | Reserva docente |
| HU06 | Comprobante con código único `RS-XXXXXX` y notificación | Reservar |
| HU07 | Alerta de conflicto en vivo + trigger `CONFLICTO_HORARIO` en la BD | Reservar |
| HU08 | Registrar salas y laboratorios (solo administrador) | Salas |
| HU09 | Editar datos y estado (En mantenimiento bloquea nuevas reservas) | Salas |
| HU10 | Vista administrativa: indicadores, aprobación, cancelación, exportar CSV | Administración |
| HU11 | Filtro por rango de fechas, formato DD-MM-AAAA | Mis reservas / Administración |

## API REST

| Método | Ruta | Descripción |
|---|---|---|
| POST | /api/login · /api/logout | Sesión (token Bearer, 8 h) |
| GET | /api/me | Usuario y cupo de reservas |
| GET | /api/recursos · /api/recursos/:id | Salas y laboratorios |
| POST/PUT | /api/recursos · /api/recursos/:id | Registrar / editar (admin) |
| POST | /api/recursos/:id/estado | Bloquear / habilitar (admin) |
| GET | /api/recursos/:id/calendario?desde&hasta | Ocupación pública |
| GET | /api/recursos/:id/libres?fecha | Horarios libres del día |
| POST | /api/reservas/validar · /api/reservas | Validar / crear reserva |
| POST | /api/reservas/docente | Bloque o serie docente (`simular`, `aplicarPrioridad`) |
| GET | /api/reservas/mias?desde&hasta&estado | Reservas propias |
| POST | /api/reservas/:id/cancelar · /confirmar | Cancelar / aprobar |
| GET | /api/admin/reservas · /estadisticas · /reservas.csv | Vista administrativa |
| GET/POST | /api/notificaciones · /api/notificaciones/leer | Avisos en pantalla |

## Reglas de negocio

- Horario de reservas: lunes a sábado, 08:00–22:00, en bloques de 30 minutos.
- No se permiten dos reservas activas que se crucen en la misma sala (HU07).
- Asistentes ≤ capacidad de la sala. No se reserva en el pasado ni en espacios en mantenimiento.
- Estudiantes: máximo 3 reservas activas y 3 horas por reserva. En laboratorios que requieren supervisor
  la reserva queda **PENDIENTE** hasta que la apruebe la administración.
- Cancelación por el usuario hasta 2 horas antes (parámetro `HORAS_MIN_CANCELACION`).
- Docentes: series semanales de hasta 16 semanas; pueden desplazar reservas estudiantiles (aviso automático).
- Estados: PENDIENTE → CONFIRMADA → FINALIZADA, o → CANCELADA. CANCELADA y FINALIZADA son finales.

> Nota de seguridad: las contraseñas se guardan como SHA-256 con sal, suficiente para el prototipo académico.
> En producción se recomienda bcrypt/argon2, HTTPS y expiración de sesiones con renovación.
