# Microservicio de Notificaciones

> **v2 (seguridad para producción).** El navegador ya no declara su identidad ni conoce ninguna API key:
> pide al backend un **token de notificaciones** (`GET /notificaciones/getToken`, 15 min) y el microservicio
> toma `tenant` y `userId` de ese token, tanto en REST como en Socket.io. Las rutas `/:tenant/:userId` y el
> evento `register` **ya no existen**. Detalle y justificación: `renew-plan-docs/notficaciones/` en la raíz del cluster.

Servicio independiente para notificaciones en tiempo real y persistencia de alertas dentro del ecosistema IT Web Service.

## Stack

| Componente | Tecnología |
|---|---|
| Runtime | Node.js 20 (Alpine) |
| Framework | Express 4 |
| WebSocket | Socket.io 4 |
| Base de datos | MongoDB 7 |
| Contenedor | Docker (multi-stage build) |

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (React)                                │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Socket.io Client                                                 │  │
│  │  connect(auth: { token }) → 'new-notification'                    │  │
│  │  token = GET /notificaciones/getToken (backend PHP, 15 min)       │  │
│  │                                                                   │  │
│  │  REST: GET /api/notifications  (Authorization: Bearer <token>)    │  │
│  │  REST: PATCH /api/notifications/:id/read                          │  │
│  └────────────────────────────┬──────────────────────────────────────┘  │
└───────────────────────────────┼─────────────────────────────────────────┘
                                │
                    WebSocket + HTTP (JSON)
                                │
┌───────────────────────────────┼─────────────────────────────────────────┐
│                               ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Nginx Reverse Proxy                                               │ │
│  │  /api/notifications/*        → notifications:3002 (HTTP)           │ │
│  │  /notifications/socket.io/*  → notifications:3002 (WebSocket)      │ │
│  └────────────────────────────┬───────────────────────────────────────┘ │
│                               │                                         │
│  ┌─ ───────────────────────────▼───────────────────────────────────────┐ │
│  │  Notifications Microservice (Node.js :3002)                       │ │
│  │                                                                    │ │
│  │  POST /api/notifications/send          ← Backend PHP (API Key)     │ │
│  │  POST /api/notifications/send-bulk     ← Backend PHP (API Key)     │ │
│  │  POST /api/notifications/broadcast     ← Backend PHP (API Key)     │ │
│  │  GET  /api/notifications               ← Frontend (JWT notif.)     │ │
│  │  GET  /api/notifications/unread-count                              │ │
│  │  PATCH /api/notifications/:id/read                                 │ │
│  │  PATCH /api/notifications/read-all                                 │ │
│  │                                                                    │ │
│  │  Socket.io Rooms: user:{tenant}:{userId}                          │ │
│  │  Socket.io Events:                                                 │ │
│  │    → 'new-notification'      (al usuario en su tenant)             │ │
│  │    → 'unread-count'          (actualización de badge)              │ │
│  │    → 'broadcast-notification' (a todos o por tenant)               │ │
│  └────────────────────────────┬───────────────────────────────────────┘ │
│                               │                                         │
│  ┌────────────────────────────▼───────────────────────────────────────┐ │
│  │  MongoDB 7  (mongo-notifications:27017)                            │ │
│  │  DB: notifications                                                 │ │
│  │  Collection: notifications                                         │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Backend PHP (existente)                                           │ │
│  │  Dispara notificaciones via POST + API Key                         │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│                        Docker Network: it-web-service-network           │
└─────────────────────────────────────────────────────────────────────────┘
```

## Inicio rápido

### 1. Configurar variables de entorno

Editar el archivo `.env` en la raíz del cluster:

```bash
# Generar una API Key segura
openssl rand -hex 32
```

Copiar el resultado y pegarlo en `.env`. Se necesitan **dos secretos distintos** (y ninguno puede ser `SEC_KEY`):

```ini
NOTIFICATIONS_API_KEY=<openssl rand -hex 32>        # backend -> microservicio (/send, /send-bulk, /broadcast)
NOTIFICATIONS_JWT_SECRET=<openssl rand -hex 32>     # con él el BACKEND firma el token del navegador (>= 32 chars)
NOTIFICATIONS_CORS_ORIGINS=http://localhost:5173,http://localhost:80
MS_NOTIFICATIONS_PORT=3002
MONGO_NOTIFICATIONS_PORT=27017
```

Los mismos `NOTIFICATIONS_API_KEY` y `NOTIFICATIONS_JWT_SECRET` (más `NOTIFICATIONS_URL` y, opcionalmente, las listas
`NOTIFICATIONS_BROADCAST_*`) van en el `.env` del **backend** (ver su `.env.example`). El servicio **no arranca** si faltan,
si usan el placeholder `changeme…`, si tienen menos de 32 caracteres o si son iguales entre sí.

### 2. Levantar el servicio

```bash
# Solo notificaciones
docker compose --profile notifications up -d --build

# Notificaciones + stack completo de desarrollo
docker compose --profile dev --profile notifications up -d --build

# Notificaciones + producción + proxy
docker compose --profile prod --profile proxy --profile notifications up -d --build
```

### 3. Verificar estado

```bash
# Health check
curl http://localhost:3002/notifications/health

# Respuesta esperada:
# {"status":"ok","service":"notifications","uptime":12.345}
```

## Multi-Tenancy

El microservicio es **multi-tenant**: todas las notificaciones están aisladas por `tenant`, que corresponde al nombre de la base de datos del cliente (equivalente a `database` en el JWT de sesión del backend; viaja como claim `tenant` del token de notificaciones).

### Cómo funciona el aislamiento

| Capa | Mecanismo |
|---|---|
| **MongoDB** | Cada documento `Notification` tiene un campo `tenant` (requerido, indexado). Todas las consultas filtran por `tenant`. |
| **API REST (usuario)** | `tenant` y `userId` salen del **token de notificaciones** (claims `tenant` y `sub`), nunca de la URL ni del body. |
| **API REST (protegido)** | El `tenant` se envía en el body de los POST (`/send`, `/send-bulk`). El backend lo obtiene del JWT (`database`). |
| **WebSocket** | El handshake exige `auth.token`; el servidor une el socket al room `user:{tenant}:{userId}` derivado del token. El cliente no puede registrarse como otro usuario. |

### Diagrama de aislamiento

```
Tenant A (bd: empresa_a)              Tenant B (bd: empresa_b)
┌─────────────────────────┐           ┌─────────────────────────┐
│ Room: user:empresa_a:42 │           │ Room: user:empresa_b:42 │
│ Room: user:empresa_a:15 │           │ Room: user:empresa_b:7  │
└─────────────────────────┘           └─────────────────────────┘
         ↓                                      ↓
   Notificaciones con                    Notificaciones con
   tenant="empresa_a"                    tenant="empresa_b"
         ↓                                      ↓
         └──────────── MongoDB ─────────────────┘
                    (misma colección,
                     filtrado por tenant)
```

> **Importante:** Un mismo `userId` (ej. `42`) puede existir en múltiples tenants. El par `(tenant, userId)` es lo que identifica de forma única a un usuario en el sistema de notificaciones.

---

## Autenticación

Hay dos mecanismos, para dos tipos de llamador:

| Llamador | Rutas | Credencial |
|---|---|---|
| Backend PHP (red Docker interna) | `POST /send`, `/send-bulk`, `/broadcast` | Header `x-api-key` (comparación en tiempo constante) |
| Navegador | `GET /`, `GET /unread-count`, `PATCH /:id/read`, `PATCH /read-all` y el socket | `Authorization: Bearer <token de notificaciones>` / `auth: { token }` |

**Token de notificaciones** – lo emite el backend (`GET /notificaciones/getToken`, requiere sesión válida):
HS256 firmado con `NOTIFICATIONS_JWT_SECRET`; claims `iss=it-backend`, `aud=it-notifications`, `sub=<IdEmpleado>`,
`tenant=<BD del cliente>`, `exp` = +15 min. El microservicio verifica firma, `iss`, `aud`, `exp` y formato de `tenant`/`sub`.
Errores 401 llevan `code`: `TOKEN_MISSING` | `TOKEN_INVALID` | `TOKEN_EXPIRED`.

**Expiración y reconexión** – al llegar `exp` el servidor emite `token-expired` y cierra el socket
(`io server disconnect`). El cliente pide un token nuevo y reconecta (en el frontend: `src/services/notificationSocket.js`).
`auth` se evalúa en cada intento, así que toda reconexión usa un token vigente.

**Exposición pública** – `/send`, `/send-bulk` y `/broadcast` **no deben publicarse** en el proxy de internet
(`nginx/nginx.conf` y el snippet de `renew-plan-docs/notficaciones/` responden 404). El navegador envía mensajes
**a través del backend** (`POST /notificaciones/enviar`, `POST /notificaciones/broadcast`), que valida la sesión.

---

## API Reference

### Endpoints protegidos (API Key)

Estos endpoints requieren el header `x-api-key` y son para uso exclusivo del backend PHP.

---

#### `POST /api/notifications/send`

Envía una notificación a un usuario específico.

**Headers:**
```
x-api-key: <NOTIFICATIONS_API_KEY>
Content-Type: application/json
```

**Body:**
```json
{
    "tenant": "nombre_base_datos",
    "recipientId": "42",
    "senderId": "7",
    "type": "manual",
    "module": "crm",
    "title": "Nueva cotización asignada",
    "message": "Se te ha asignado la cotización #1234 del cliente Acme Corp.",
    "metadata": {
        "route": "/crmModulo/cotizacion/1234",
        "entityId": 1234
    }
}
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `tenant` | string | **Si** | Nombre de la base de datos del cliente (aislamiento multi-tenant) |
| `recipientId` | string | Si | IdEmpleado del usuario destino |
| `senderId` | string | No | IdEmpleado del usuario origen (null = sistema) |
| `type` | string | No | `manual`, `system`, `reminder`, `alert` (default: `manual`) |
| `module` | string | No | `crm`, `logistica`, `mtto`, `general` (default: `general`) |
| `title` | string | Si | Título de la notificación (max 200 chars) |
| `message` | string | Si | Cuerpo del mensaje (max 1000 chars) |
| `metadata` | object | No | Datos extra para deep-linking en el frontend |

**Respuesta (201):**
```json
{
    "success": true,
    "message": "Notificacion enviada",
    "data": {
        "_id": "65a1b2c3d4e5f6...",
        "tenant": "nombre_base_datos",
        "recipientId": "42",
        "senderId": "7",
        "type": "manual",
        "module": "crm",
        "title": "Nueva cotización asignada",
        "message": "Se te ha asignado la cotización #1234...",
        "metadata": { "route": "/crmModulo/cotizacion/1234" },
        "read": false,
        "readAt": null,
        "createdAt": "2026-02-07T10:30:00.000Z",
        "updatedAt": "2026-02-07T10:30:00.000Z"
    }
}
```

---

#### `POST /api/notifications/send-bulk`

Envía la misma notificación a múltiples usuarios.

**Body:**
```json
{
    "tenant": "nombre_base_datos",
    "recipientIds": ["42", "15", "8"],
    "type": "system",
    "module": "general",
    "title": "Mantenimiento programado",
    "message": "El sistema estará en mantenimiento el sábado de 22:00 a 02:00."
}
```

---

#### `POST /api/notifications/broadcast`

Envía un evento a todos los usuarios conectados por WebSocket (sin persistir en MongoDB).

**Body:**
```json
{
    "tenant": "nombre_base_datos",
    "type": "alert",
    "title": "Actualización del sistema",
    "message": "Se ha desplegado la versión 2.5.0."
}
```

> **Nota:** el destino es opcional y se elige con **uno** de estos campos (enviar ambos responde `400`):
> - `tenant` (string): solo a los usuarios conectados de ese tenant.
> - `tenants` (array de 1 a 200 strings, sin duplicados): a los usuarios conectados de esos tenants.
> - ninguno: a **todos** los usuarios conectados.
>
> El microservicio no decide quién puede hacerlo: lo autoriza el backend (`POST /notificaciones/broadcast`).

---

### Endpoints del usuario (JWT de notificaciones)

Todos requieren `Authorization: Bearer <token de notificaciones>`. El usuario y el tenant son los del token.

---

#### `GET /api/notifications`

Notificaciones del usuario autenticado, con paginación.

**Query params:**
| Param | Default | Descripción |
|---|---|---|
| `page` | 1 | Página actual |
| `limit` | 20 | Registros por página (max 50) |
| `unread` | false | Si `true`, solo devuelve no leídas |

**Ejemplo:** `GET /api/notifications?page=1&limit=10&unread=true`

**Respuesta:**
```json
{
    "success": true,
    "data": [ ... ],
    "pagination": { "page": 1, "limit": 10, "total": 45, "pages": 5 }
}
```

---

#### `GET /api/notifications/unread-count`

```json
{ "success": true, "data": { "count": 12 } }
```

---

#### `PATCH /api/notifications/:id/read`

Marca una notificación **propia** como leída (`:id` = `_id` de MongoDB). Si la notificación es de otro usuario o de
otro tenant responde `404` (no revela su existencia). `400` si el `id` no es un ObjectId.

---

#### `PATCH /api/notifications/read-all`

Marca como leídas todas las notificaciones del usuario autenticado.

---

#### `GET /notifications/health`

Health check (sin autenticación).

---

### Validación de entrada (rutas de API key)

`tenant`, `recipientId`, `senderId` deben ser string/número con formato `^[\w.\-]{1,128}$` (los objetos tipo `{"$ne":null}` se rechazan);
`title` ≤ 200, `message` ≤ 1000, `type` ∈ `manual|system|reminder|alert`, `module` ∈ `crm|logistica|mtto|general`;
`metadata` objeto ≤ 4 KB y, si trae `route`, debe iniciar con `/` (no `//`); `send-bulk` ≤ 500 destinatarios (se deduplican);
body JSON ≤ 50 KB. Errores de validación responden `400`.

---

## Integración Frontend (Implementada)

La integración frontend ya está implementada y conectada al ecosistema existente de Redux + React Router.

### Archivos creados en el Frontend

```
it_web_service-Front/src/
├── global/
│   └── notificationsURL.js                          # URL base (VITE_NOTIFICATIONS_URL; vacía = mismo origen)
├── services/
│   ├── notificationsAuth.js                         # Token de notificaciones (caché/renovación) + fetch autenticado
│   └── notificationSocket.js                        # Cliente Socket.io (auth con función, reconexión al expirar)
├── store/slices/notificationsSlice/
│   ├── notificationsSlice.js                        # Redux slice (state + reducers)
│   ├── notificationsThunks.js                       # Thunks (fetch, markRead) + envío manual/broadcast vía backend
│   └── index.js                                     # Barrel export
└── app/
    ├── hooks/
    │   └── useNotifications.js                      # Hook principal (socket + redux + lifecycle)
    └── components/notifications/
        ├── NotificationBell.jsx                     # Campana con badge (integrada en Navbar)
        ├── NotificationPanel.jsx                    # Panel desplegable con lista
        └── NotificationItem.jsx                     # Item individual con deep-linking
```

### Archivos modificados en el Frontend

| Archivo | Cambio |
|---|---|
| `src/store/store.js` | Se agrego `notifications: notificationsSlice.reducer` |
| `src/app/components/Navbar.jsx` | Se reemplazo el boton hardcodeado por `<NotificationBell />` |
| `src/store/slices/authtentication/thunks.js` | Se agrego `disconnectNotifications()` + `clearNotifications()` al logout |

### Flujo de datos

```
1. Usuario hace login
   ↓
2. AppRoutes renderiza Navbar → NotificationBell
   ↓
3. NotificationBell usa useNotifications()
   ↓
4. useNotifications():
   ├── Espera sesión (IdEmpleado y direct en Redux state.auth)
   ├── Pide el token al backend (GET /notificaciones/getToken) y conecta Socket.io con auth: { token }
   ├── El servidor une al socket al room "user:{tenant}:{userId}" tomado del token
   ├── Escucha eventos: 'new-notification', 'unread-count', 'broadcast-notification'
   ├── Despacha fetchNotifications() y fetchUnreadCount() (Bearer; el servidor filtra por el token)
   └── Al desmontar: disconnectNotifications() + clearNotifications()
   ↓
5. Cuando llega un evento WebSocket:
   ├── 'new-notification' → dispatch(addNewNotification) → se agrega al inicio de la lista
   ├── 'unread-count' → dispatch(setUnreadCount) → actualiza el badge rojo
   └── 'broadcast-notification' → dispatch(addNewNotification) → se agrega como nueva
   ↓
6. Usuario interactua:
   ├── Click en campana → abre/cierra NotificationPanel
   ├── Click en notificación → markAsRead + navegar a metadata.route (deep-link)
   ├── "Marcar todas como leidas" → markAllAsRead() → badge se pone en 0
   └── "Cargar mas" → fetchMoreNotifications (paginación)
   ↓
7. Usuario hace logout:
   ├── disconnectNotifications() → cierra socket (sale del room)
   └── clearNotifications() → limpia Redux state
```

> **Nota:** El `tenant` ya no lo envía el navegador: el backend lo toma de la sesión (`database` del JWT) y lo firma dentro del token de notificaciones. Así el aislamiento multi-tenant no depende de datos controlados por el cliente.
>
> Al vencer el token (15 min) el servidor cierra el socket; el cliente obtiene uno nuevo, reconecta y vuelve a cargar lista y contador.

### Uso del hook useNotifications

```jsx
import { useNotifications } from '../../hooks/useNotifications';

const MiComponente = () => {
    const {
        notifications,   // Array de notificaciones
        unreadCount,      // Numero para el badge
        isLoading,        // true mientras carga
        hasMore,          // true si hay mas paginas
        isConnected,      // true si WebSocket esta conectado
        markAsRead,       // (notificationId) => void
        markAllAsRead,    // () => void
        loadMore,         // () => void - carga siguiente pagina
        refresh,          // () => void - recarga desde pagina 1
    } = useNotifications();

    return <div>No leidas: {unreadCount}</div>;
};
```

### Configurar URL en produccion

La URL se inyecta en build con `VITE_NOTIFICATIONS_URL` (ver `Dockerfile.prod` y `docker-compose.yml`).
Front, backend y microservicio comparten host (`https://crm.itwebservices.net`), así que en producción se deja
**vacía** (= mismo origen) y el proxy del servidor enruta `/api/notifications` y `/notifications/socket.io`
al microservicio (snippet en `renew-plan-docs/notficaciones/nginx-servidor-crm.snippet.conf`).
En desarrollo, si no se define, usa `http://localhost:3002`.

> Nunca definir secretos con prefijo `VITE_`: terminan en el bundle público.

### Socket.io client (ya incluido)

El paquete `socket.io-client` ya existe en `package.json` del frontend (version 4.8.3). No se requiere instalacion adicional.

---

## Integración Backend PHP (Implementada)

Se creo la clase `NotificationService` en `classes/NotificationService.php` que cualquier Controller puede usar.

### Archivo creado

```
it_web_service-Backend_R/
└── classes/
    └── NotificationService.php    # Clase estática con send(), sendBulk(), broadcast()
```

### Variables agregadas al .env del backend

```ini
NOTIFICATIONS_URL=http://notifications:3002
NOTIFICATIONS_API_KEY=<igual a NOTIFICATIONS_API_KEY del .env raíz>
NOTIFICATIONS_JWT_SECRET=<igual a NOTIFICATIONS_JWT_SECRET del .env raíz; distinto de SEC_KEY>
# Broadcast: lista blanca "tenant:Usuario" separada por comas (vacío = nadie)
NOTIFICATIONS_BROADCAST_USERS=          # gerentes: solo su tenant
NOTIFICATIONS_BROADCAST_GLOBAL_USERS=   # soporte: su tenant o todos
```

### API de la clase NotificationService

```php
use Classes\NotificationService;

// Enviar a un usuario (tenant = nombre de base de datos del JWT)
NotificationService::send(
    tenant: $dataTokenDecoded['database'],  // REQUERIDO: aislamiento multi-tenant
    recipientId: '42',
    title: 'Nueva cotización asignada',
    message: 'Se te asignó la cotización #1234',
    module: 'crm',            // 'crm' | 'logistica' | 'mtto' | 'general'
    type: 'system',            // 'manual' | 'system' | 'reminder' | 'alert'
    senderId: '7',             // null = notificacion del sistema
    metadata: ['route' => '/crmModulo/cotizacion/1234']
);

// Enviar a multiples usuarios
NotificationService::sendBulk(
    tenant: $dataTokenDecoded['database'],  // REQUERIDO
    recipientIds: ['42', '15', '8'],
    title: 'Mantenimiento programado',
    message: 'El sistema estará en mantenimiento el sábado.',
    module: 'general',
    type: 'system'
);

// Broadcast a todos los conectados (tenant opcional)
NotificationService::broadcast(
    title: 'Actualización del sistema',
    message: 'Se ha desplegado la versión 2.5.0.',
    tenant: $dataTokenDecoded['database']  // Opcional: si se omite, llega a TODOS los tenants
);
```

> **Importante:** El `tenant` se obtiene del campo `database` del JWT decodificado (`$dataTokenDecoded['database']`). Este valor es el mismo que `state.auth.direct` en el frontend.

### Ejemplo: CRMController - Notificar al crear cotización

```php
use Classes\NotificationService;

public static function insertCotizacion_v2(): void
{
    $headers = getallheaders();
    $data = json_decode(file_get_contents("php://input"), true);

    // ... validación de tokens y datos existente ...

    $dataTokenDecoded = validadorTokenCrm($headers['Authorization'], $headers['X-Refresh-Token']);

    $cotizacion = new Cotizacion($data);
    $resultado = $cotizacion->insertCotizacion($dataTokenDecoded['database']);

    if ($resultado['success']) {
        // Notificar al vendedor asignado
        NotificationService::send(
            tenant: $dataTokenDecoded['database'],  // Tenant del JWT
            recipientId: $data['IdEmpleado'],
            title: 'Nueva cotización asignada',
            message: "Se te asignó la cotización #{$resultado['data']['IdCotizacion']} del cliente {$data['RazonSocial']}",
            module: 'crm',
            type: 'system',
            senderId: $dataTokenDecoded[0]->IdEmpleado,  // quien creo la cotización
            metadata: ['route' => "/crmModulo/cotizacion/{$resultado['data']['IdCotizacion']}"]
        );
    }

    $refreshToken = $dataTokenDecoded['nuevoToken'] ?? null;
    HTTPreponse(1, 200, "Exito", $resultado['data'], $refreshToken);
}
```

### Ejemplo: LogisticaControl - Notificar al cerrar ruta

```php
use Classes\NotificationService;

public static function setStateRfso(): void
{
    // ... lógica existente de actualizar RFSO ...

    $resultado = logisticaModel::setUpdateRFSOStatus($bd, $idRfso, 1);

    if ($resultado) {
        // Notificar al operador de logística
        NotificationService::send(
            tenant: $bd,  // Tenant (base de datos del JWT)
            recipientId: $idEmpleadoOperador,
            title: 'RFSO actualizado',
            message: "El RFSO #{$idRfso} fue marcado como entregado",
            module: 'logistica',
            type: 'system',
            metadata: ['route' => "/logisticaModulo/entregas/{$idOrd}/{$idRfso}"]
        );
    }

    HTTPreponse(1, 200, "Exito", $resultado);
}
```

### Ejemplo: MantenimientoController - Notificar al crear OT

```php
use Classes\NotificationService;

public static function CreateOT(): void
{
    // ... lógica existente de crear Orden de Trabajo ...

    $resultado = $ordenTrabajo->crearBlock($dataTokenDecoded['database']);

    if ($resultado[0]) {
        // Notificar al técnico asignado
        NotificationService::send(
            tenant: $dataTokenDecoded['database'],  // Tenant del JWT
            recipientId: $data['IdEmpleadoTecnico'],
            title: 'Nueva Orden de Trabajo',
            message: "Se te asignó la OT #{$resultado[1]} para el equipo {$data['NombreEquipo']}",
            module: 'mtto',
            type: 'system',
            senderId: $dataTokenDecoded[0]->IdEmpleado,
            metadata: ['route' => "/mttoModulo/ordenes/{$resultado[1]}/{$data['IdEquipo']}"]
        );
    }

    HTTPreponse(1, 200, "Exito", $resultado);
}
```

### Ejemplo: Recordatorio automático (cron o trigger)

```php
use Classes\NotificationService;

// Desde un script PHP ejecutado por cron o un endpoint de sistema
NotificationService::sendBulk(
    tenant: 'nombre_base_datos',  // Tenant específico
    recipientIds: ['42', '15', '8', '23'],
    title: 'Recordatorio: Revisión semanal',
    message: 'Recuerda completar tu revisión semanal de equipos asignados antes del viernes.',
    module: 'mtto',
    type: 'reminder',
    metadata: ['route' => '/mttoModulo']
);
```

### Notificación manual (usuario a usuario) y broadcast

Ya no es un ejemplo: están implementados en `controllers/NotificacionesController.php` (+ `services/Notificaciones/NotificacionesService.php`):

| Ruta (backend) | Descripción |
|---|---|
| `GET /notificaciones/getToken` | Emite el token de notificaciones (15 min) para el usuario de la sesión |
| `POST /notificaciones/enviar` | `{ recipientId, title, message, module?, metadata? }` → cualquier empleado **del mismo tenant**. `tenant` y remitente salen de la sesión |
| `GET /notificaciones/getTenants` | Lista de clientes `[{ IdEmpresa, BaseDatos }]` (tabla maestra `Empresa`) para armar el selector de destinos. Solo soporte |
| `POST /notificaciones/broadcast` | `{ title, message, scope, tenants?, module?, metadata? }`. `scope`: `"tenant"` (mi cliente), `"tenants"` (los de `tenants`, 1 o varios) o `"all"` (todos). **Solo soporte** (`NOTIFICATIONS_BROADCAST_GLOBAL_USERS`, entradas `tenant:Usuario`). El broadcast de gerentes (`NOTIFICATIONS_BROADCAST_USERS`) está **en pausa** |

---

## Configuración de Nginx

Los cambios necesarios en `nginx/nginx.conf` ya fueron aplicados. Se agregaron tres bloques:

### 1. Upstream del microservicio

```nginx
upstream notifications_servers {
    server notifications:3002;
    keepalive 32;
}
```

### 2. Mapa para WebSocket upgrade

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

### 3. Bloques location

```nginx
# REST API
location /api/notifications {
    proxy_pass http://notifications_servers;
    # ... headers estándar
}

# WebSocket (Socket.io)
location /notifications/socket.io {
    proxy_pass http://notifications_servers;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 86400s;    # 24h para conexiones persistentes
    proxy_send_timeout 86400s;
    proxy_buffering off;
}
```

### Sin proxy (desarrollo directo)

Si no se usa Nginx, el frontend se conecta directamente al microservicio en el puerto `3002`. No se necesita configuración adicional.

---

## Estructura de archivos

```
microservices/notifications/
├── Dockerfile                          # Multi-stage build (deps → producción)
├── .dockerignore
├── .env.example                        # Template de variables
├── package.json
├── NOTIFICATIONS.md                    # Este archivo
└── src/
    ├── server.js                       # Entry point (Express + HTTP + Socket.io)
    ├── config/
    │   ├── env.js                      # Variables de entorno centralizadas
    │   ├── database.js                 # Conexión a MongoDB
    │   └── socket.js                   # Socket.io: handshake con JWT, room por token, cierre al expirar
    ├── middleware/
    │   ├── apiKeyAuth.js               # Validación de API Key (tiempo constante)
    │   ├── jwtAuth.js                  # Valida el token de notificaciones -> req.auth
    │   └── errorHandler.js             # Manejo global de errores
    ├── models/
    │   └── Notification.js             # Schema de Mongoose (con índices)
    ├── routes/
    │   └── notifications.js            # Definición de rutas Express
    ├── controllers/
    │   └── notificationController.js   # Lógica de negocio
    ├── services/
    │   ├── tokenService.js             # Verificación del token de notificaciones (HS256, iss, aud, exp)
    │   └── socketService.js            # Emisión de eventos WebSocket
    └── utils/
        └── validators.js               # Validación/sanitización de entradas
```

## Modelo de datos (MongoDB)

```javascript
{
    _id:          ObjectId,
    tenant:       String,       // Nombre de base de datos (requerido, aislamiento multi-tenant)
    recipientId:  String,       // IdEmpleado destino
    senderId:     String|null,  // IdEmpleado origen (null = sistema)
    type:         "manual" | "system" | "reminder" | "alert",
    module:       "crm" | "logistica" | "mtto" | "general",
    title:        String,       // max 200 chars
    message:      String,       // max 1000 chars
    metadata:     Object,       // Datos libres (deep-link, entityId, etc.)
    read:         Boolean,      // default: false
    readAt:       Date|null,
    createdAt:    Date,         // auto (timestamps)
    updatedAt:    Date          // auto (timestamps)
}
```

**Indices:**
- `tenant` (simple) - Filtro por tenant
- `recipientId` (simple) - Consultas por usuario
- `read` (simple) - Filtro leído/no leído
- `{ tenant, recipientId, read, createdAt }` (compuesto) - Consulta principal del frontend (todas las queries filtran por tenant + usuario)

## Eventos WebSocket

| Evento | Dirección | Payload | Descripción |
|---|---|---|---|
| `token-expired` | Servidor → Cliente | — | El token venció; el servidor cierra el socket y el cliente debe pedir uno nuevo y reconectar |
| `new-notification` | Servidor → Cliente | `Notification` (objeto completo) | Nueva notificación individual (emitida al room del tenant+usuario) |
| `unread-count` | Servidor → Cliente | `{ count: number }` | Actualización del badge de no leídas (scoped por tenant) |
| `broadcast-notification` | Servidor → Todos/Tenant | `Notification` (sin _id) | Si se proporcionó tenant: solo a rooms de ese tenant. Si no: a todos. |

## Seguridad

- **Dos credenciales distintas**: `x-api-key` (backend → microservicio) y token de notificaciones HS256 (navegador → microservicio), este último firmado por el backend con `NOTIFICATIONS_JWT_SECRET`, **distinto de `SEC_KEY`**: el microservicio no puede forjar sesiones del CRM.
- **Identidad solo desde el token**: REST y WebSocket ignoran `tenant`/`userId` enviados por el cliente. `PATCH /:id/read` filtra por `_id + tenant + recipientId`.
- **Sin secretos por defecto**: el servicio aborta si faltan `API_KEY`/`NOTIFICATIONS_JWT_SECRET`, son placeholder, < 32 caracteres o iguales; en producción exige `MONGO_URI` y `CORS_ORIGINS`.
- **Rutas de servicio no públicas**: `/send`, `/send-bulk`, `/broadcast` se bloquean en el proxy (404) y solo se usan por la red Docker.
- **Validación de entrada** y límite de body (ver *Validación de entrada*). `metadata.route` solo admite rutas internas.
- **CORS**: solo los orígenes de `CORS_ORIGINS`.
- **Usuario no-root** en el contenedor; Mongo con autenticación y puerto solo en loopback.

### Antes de salir a producción

1. Generar `NOTIFICATIONS_API_KEY` y `NOTIFICATIONS_JWT_SECRET` nuevos (`openssl rand -hex 32`) y **rotar** la contraseña de Mongo: el `.env` del microservicio estuvo versionado en el historial git.
2. `NODE_ENV=production` y `NOTIFICATIONS_CORS_ORIGINS=https://crm.itwebservices.net`.
3. Añadir los `location` del snippet al nginx del servidor y servir todo por HTTPS (el WebSocket requiere `wss`).
4. Cargar en el `.env` del backend los mismos secretos y las listas `NOTIFICATIONS_BROADCAST_*`.
5. Desplegar microservicio, backend y frontend **juntos** (las rutas `/:tenant/:userId` desaparecieron).

## Comandos útiles

```bash
# Ver logs del microservicio
docker compose logs -f notifications

# Ver logs de MongoDB
docker compose logs -f mongo-notifications

# Reiniciar solo el microservicio
docker compose --profile notifications restart notifications

# Reconstruir imagen después de cambios en código
docker compose --profile notifications up -d --build notifications

# Conectarse a MongoDB para inspeccionar datos
docker exec -it it-mongo-notifications mongosh notifications

# Detener todo el stack de notificaciones
docker compose --profile notifications down
```

## Troubleshooting

| Problema | Solución |
|---|---|
| `API Key requerida` al llamar desde PHP | Verificar que `x-api-key` header se envía correctamente y que el valor coincide con `NOTIFICATIONS_API_KEY` en el `.env` raíz |
| WebSocket no conecta detrás de Nginx | Verificar que los bloques `location /notifications/socket.io` están presentes y que los headers `Upgrade` y `Connection` se propagan |
| `ECONNREFUSED` desde el backend PHP | Verificar que ambos servicios están en la misma red Docker (`it-web-service-network`) y usar `http://notifications:3002` como URL |
| MongoDB no inicia | Verificar que el volumen `mongo_notifications_data` tiene permisos correctos. Eliminar con `docker volume rm it-mongo-notifications-data` y reiniciar |
| Frontend no recibe eventos | Verificar que el `path` de Socket.io en el cliente coincide: `/notifications/socket.io` |
