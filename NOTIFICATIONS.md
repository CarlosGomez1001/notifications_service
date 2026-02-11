# Microservicio de Notificaciones

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
│  │  connect → register({ userId, tenant }) → 'new-notification'     │  │
│  │  tenant = state.auth.direct (nombre de base de datos)            │  │
│  │                                                                   │  │
│  │  REST: GET /api/notifications/:tenant/:userId                     │  │
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
│  │  GET  /api/notifications/:tenant/:userId       ← Frontend          │ │
│  │  GET  /api/notifications/:tenant/:userId/unread-count              │ │
│  │  PATCH /api/notifications/:id/read                                 │ │
│  │  PATCH /api/notifications/:tenant/:userId/read-all                 │ │
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

Copiar el resultado y pegarlo en `.env`:

```ini
NOTIFICATIONS_API_KEY=<resultado_del_comando_anterior>
NOTIFICATIONS_CORS_ORIGINS=http://localhost:5173,http://localhost:80
MS_NOTIFICATIONS_PORT=3002
MONGO_NOTIFICATIONS_PORT=27017
```

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

El microservicio es **multi-tenant**: todas las notificaciones están aisladas por `tenant`, que corresponde al nombre de la base de datos del cliente (equivalente a `state.auth.direct` en el frontend y `database` en el payload JWT del backend).

### Cómo funciona el aislamiento

| Capa | Mecanismo |
|---|---|
| **MongoDB** | Cada documento `Notification` tiene un campo `tenant` (requerido, indexado). Todas las consultas filtran por `tenant`. |
| **API REST (público)** | El `tenant` es parte de la URL: `/:tenant/:userId`. El frontend lo obtiene de `state.auth.direct`. |
| **API REST (protegido)** | El `tenant` se envía en el body de los POST (`/send`, `/send-bulk`). El backend lo obtiene del JWT (`database`). |
| **WebSocket** | Cada socket se registra con `{ userId, tenant }`. El room tiene formato `user:{tenant}:{userId}`, impidiendo que usuarios de un tenant reciban notificaciones de otro. |

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

> **Nota:** `tenant` es **opcional** en broadcast. Si se proporciona, solo se emite a los usuarios conectados de ese tenant. Si se omite, se emite a **todos** los usuarios conectados.

---

### Endpoints públicos (Frontend)

---

#### `GET /api/notifications/:tenant/:userId`

Obtiene las notificaciones de un usuario dentro de su tenant, con paginación.

**Path params:**
| Param | Descripción |
|---|---|
| `tenant` | Nombre de la base de datos (= `state.auth.direct` en el frontend) |
| `userId` | IdEmpleado del usuario |

**Query params:**
| Param | Default | Descripción |
|---|---|---|
| `page` | 1 | Página actual |
| `limit` | 20 | Registros por página (max 50) |
| `unread` | false | Si `true`, solo devuelve no leídas |

**Ejemplo:**
```
GET /api/notifications/empresa_a/42?page=1&limit=10&unread=true
```

**Respuesta:**
```json
{
    "success": true,
    "data": [ ... ],
    "pagination": {
        "page": 1,
        "limit": 10,
        "total": 45,
        "pages": 5
    }
}
```

---

#### `GET /api/notifications/:tenant/:userId/unread-count`

Devuelve el conteo de notificaciones no leídas del usuario dentro de su tenant.

```json
{ "success": true, "data": { "count": 12 } }
```

---

#### `PATCH /api/notifications/:id/read`

Marca una notificación individual como leída (`:id` es el `_id` de MongoDB).

---

#### `PATCH /api/notifications/:tenant/:userId/read-all`

Marca todas las notificaciones del usuario dentro de su tenant como leídas.

---

## Integración Frontend (Implementada)

La integración frontend ya está implementada y conectada al ecosistema existente de Redux + React Router.

### Archivos creados en el Frontend

```
it_web_service-Front/src/
├── global/
│   └── notificationsURL.js                          # URL base del microservicio
├── services/
│   └── notificationSocket.js                        # Cliente Socket.io (connect/disconnect/getSocket)
├── store/slices/notificationsSlice/
│   ├── notificationsSlice.js                        # Redux slice (state + reducers)
│   ├── notificationsThunks.js                       # Thunks (fetch, markRead, sendManual)
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
   ├── Lee IdEmpleado y direct (tenant) del Redux state.auth
   ├── Conecta Socket.io y emite 'register' con { userId: IdEmpleado, tenant: direct }
   ├── El servidor une al socket al room "user:{tenant}:{userId}"
   ├── Escucha eventos: 'new-notification', 'unread-count', 'broadcast-notification'
   ├── Despacha fetchNotifications(tenant, userId) y fetchUnreadCount(tenant, userId)
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
   ├── "Marcar todas como leidas" → markAllAsRead(tenant, userId) → badge se pone en 0
   └── "Cargar mas" → fetchMoreNotifications (paginación con tenant)
   ↓
7. Usuario hace logout:
   ├── disconnectNotifications() → cierra socket (sale del room)
   └── clearNotifications() → limpia Redux state
```

> **Nota:** El `tenant` se obtiene de `state.auth.direct`, que corresponde al nombre de la base de datos seleccionada durante el login. Todas las llamadas REST y el registro del socket incluyen este valor para garantizar el aislamiento multi-tenant.

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

Editar `src/global/notificationsURL.js`:

```javascript
// export const NOTIFICATIONS_URL = 'http://localhost:3002'; //* Local
export const NOTIFICATIONS_URL = 'https://tu-dominio.com'; //* Produccion (Nginx proxea)
```

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
NOTIFICATIONS_API_KEY=changeme-generate-a-secure-key
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

### Ejemplo: Notificación manual (usuario a usuario)

```php
use Classes\NotificationService;

// Endpoint para que un usuario envie un mensaje a otro
public static function enviarNotificacionManual(): void
{
    $headers = getallheaders();
    $data = json_decode(file_get_contents("php://input"), true);

    $dataTokenDecoded = validadorTokenCrm($headers['Authorization'], $headers['X-Refresh-Token']);

    NotificationService::send(
        tenant: $dataTokenDecoded['database'],  // Tenant del JWT
        recipientId: $data['recipientId'],
        title: $data['title'],
        message: $data['message'],
        module: $data['module'] ?? 'general',
        type: 'manual',
        senderId: $dataTokenDecoded[0]->IdEmpleado   // El que envia
    );

    HTTPreponse(1, 200, "Notificacion enviada");
}

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
    │   └── socket.js                   # Configuración Socket.io + registro de usuarios
    ├── middleware/
    │   ├── apiKeyAuth.js               # Validación de API Key
    │   └── errorHandler.js             # Manejo global de errores
    ├── models/
    │   └── Notification.js             # Schema de Mongoose (con índices)
    ├── routes/
    │   └── notifications.js            # Definición de rutas Express
    ├── controllers/
    │   └── notificationController.js   # Lógica de negocio
    └── services/
        └── socketService.js            # Emisión de eventos WebSocket
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
| `register` | Cliente → Servidor | `{ userId, tenant }` | Registra al usuario en el room `user:{tenant}:{userId}` |
| `new-notification` | Servidor → Cliente | `Notification` (objeto completo) | Nueva notificación individual (emitida al room del tenant+usuario) |
| `unread-count` | Servidor → Cliente | `{ count: number }` | Actualización del badge de no leídas (scoped por tenant) |
| `broadcast-notification` | Servidor → Todos/Tenant | `Notification` (sin _id) | Si se proporcionó tenant: solo a rooms de ese tenant. Si no: a todos. |

## Seguridad

- **API Key**: Los endpoints de escritura (`/send`, `/send-bulk`, `/broadcast`) requieren el header `x-api-key`. Solo el backend PHP debe conocer esta clave.
- **CORS**: Configurado para aceptar solo los orígenes definidos en `CORS_ORIGINS`.
- **Usuario no-root**: El contenedor se ejecuta como `appuser`, no como root.
- **Red interna**: El microservicio se comunica con el backend via la red Docker interna (`it-web-service-network`), sin exponer MongoDB al host en producción.

### Recomendaciones para producción

1. Cambiar `NOTIFICATIONS_API_KEY` por un valor generado con `openssl rand -hex 32`.
2. Restringir `CORS_ORIGINS` al dominio real de producción.
3. Eliminar el mapeo de puertos de MongoDB (`MONGO_NOTIFICATIONS_PORT`) para que no sea accesible desde fuera de Docker.
4. Habilitar autenticación en MongoDB si se requiere mayor seguridad.

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
