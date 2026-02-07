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
│  │  connect → register(userId) → escuchar 'new-notification'        │  │
│  │                                                                   │  │
│  │  REST: GET /api/notifications/:userId                             │  │
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
│  ┌────────────────────────────▼───────────────────────────────────────┐ │
│  │  Notifications Microservice (Node.js :3002)                        │ │
│  │                                                                    │ │
│  │  POST /api/notifications/send          ← Backend PHP (API Key)     │ │
│  │  POST /api/notifications/send-bulk     ← Backend PHP (API Key)     │ │
│  │  POST /api/notifications/broadcast     ← Backend PHP (API Key)     │ │
│  │  GET  /api/notifications/:userId       ← Frontend (público)        │ │
│  │  GET  /api/notifications/:userId/unread-count                      │ │
│  │  PATCH /api/notifications/:id/read                                 │ │
│  │  PATCH /api/notifications/:userId/read-all                         │ │
│  │                                                                    │ │
│  │  Socket.io Events:                                                 │ │
│  │    → 'new-notification'      (al usuario destino)                  │ │
│  │    → 'unread-count'          (actualización de badge)              │ │
│  │    → 'broadcast-notification' (a todos)                            │ │
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
    "type": "alert",
    "title": "Actualización del sistema",
    "message": "Se ha desplegado la versión 2.5.0."
}
```

---

### Endpoints públicos (Frontend)

---

#### `GET /api/notifications/:userId`

Obtiene las notificaciones de un usuario con paginación.

**Query params:**
| Param | Default | Descripción |
|---|---|---|
| `page` | 1 | Página actual |
| `limit` | 20 | Registros por página (max 50) |
| `unread` | false | Si `true`, solo devuelve no leídas |

**Ejemplo:**
```
GET /api/notifications/42?page=1&limit=10&unread=true
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

#### `GET /api/notifications/:userId/unread-count`

Devuelve el conteo de notificaciones no leídas.

```json
{ "success": true, "data": { "count": 12 } }
```

---

#### `PATCH /api/notifications/:id/read`

Marca una notificación individual como leída (`:id` es el `_id` de MongoDB).

---

#### `PATCH /api/notifications/:userId/read-all`

Marca todas las notificaciones del usuario como leídas.

---

## Integración con WebSocket (Frontend)

### Instalación

```bash
cd it_web_service-Front
npm install socket.io-client
```

### Conexión y escucha de eventos

```javascript
// src/services/notificationSocket.js
import { io } from 'socket.io-client';

const NOTIFICATIONS_URL = import.meta.env.VITE_NOTIFICATIONS_URL
    || 'http://localhost:3002';

let socket = null;

/**
 * Conecta al microservicio de notificaciones y registra el userId.
 */
export const connectNotifications = (userId) => {
    if (socket?.connected) return socket;

    socket = io(NOTIFICATIONS_URL, {
        path: '/notifications/socket.io',
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 10,
    });

    socket.on('connect', () => {
        console.log('[Notifications] Conectado:', socket.id);
        socket.emit('register', userId);
    });

    socket.on('disconnect', (reason) => {
        console.log('[Notifications] Desconectado:', reason);
    });

    return socket;
};

/**
 * Desconecta del servicio de notificaciones.
 */
export const disconnectNotifications = () => {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
};

export const getSocket = () => socket;
```

### Uso en un componente React

```jsx
// src/app/components/NotificationBell.jsx
import { useEffect, useState } from 'react';
import { connectNotifications, disconnectNotifications, getSocket } from '../../services/notificationSocket';

const NOTIF_API = 'http://localhost:3002/api/notifications';

export const NotificationBell = ({ userId }) => {
    const [unreadCount, setUnreadCount] = useState(0);
    const [notifications, setNotifications] = useState([]);

    useEffect(() => {
        // Conectar WebSocket
        const socket = connectNotifications(userId);

        // Escuchar notificaciones en tiempo real
        socket.on('new-notification', (notification) => {
            setNotifications((prev) => [notification, ...prev]);
        });

        socket.on('unread-count', ({ count }) => {
            setUnreadCount(count);
        });

        socket.on('broadcast-notification', (notification) => {
            setNotifications((prev) => [notification, ...prev]);
        });

        // Cargar conteo inicial
        fetch(`${NOTIF_API}/${userId}/unread-count`)
            .then((r) => r.json())
            .then((res) => setUnreadCount(res.data.count));

        return () => disconnectNotifications();
    }, [userId]);

    const markAsRead = async (id) => {
        await fetch(`${NOTIF_API}/${id}/read`, { method: 'PATCH' });
    };

    const markAllRead = async () => {
        await fetch(`${NOTIF_API}/${userId}/read-all`, { method: 'PATCH' });
    };

    return (
        <div>
            <button>
                Notificaciones {unreadCount > 0 && <span>({unreadCount})</span>}
            </button>
            {/* Panel de notificaciones */}
        </div>
    );
};
```

---

## Integración con Backend PHP

### Ejemplo: Disparar notificación desde un Controller

```php
// En cualquier Controller del backend PHP existente
// Ejemplo: al crear una cotización, notificar al vendedor asignado

private static function notificarUsuario(
    string $recipientId,
    string $title,
    string $message,
    string $module = 'general',
    string $type = 'system',
    array  $metadata = []
): void {
    $notificationsUrl = 'http://notifications:3002/api/notifications/send';
    $apiKey = getenv('NOTIFICATIONS_API_KEY') ?: 'changeme-generate-a-secure-key';

    $payload = json_encode([
        'recipientId' => $recipientId,
        'type'        => $type,
        'module'      => $module,
        'title'       => $title,
        'message'     => $message,
        'metadata'    => $metadata,
    ]);

    $ch = curl_init($notificationsUrl);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 5,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'x-api-key: ' . $apiKey,
        ],
    ]);

    $result = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 201) {
        error_log("[Notifications] Error al enviar notificacion: HTTP $httpCode - $result");
    }
}
```

### Ejemplo de uso en CRMController

```php
public static function insertCotizacion_v2(): void
{
    // ... lógica existente de crear cotización ...

    $resultado = $cotizacion->insert();

    if ($resultado['success']) {
        // Notificar al vendedor asignado
        self::notificarUsuario(
            $resultado['data']['IdEmpleado'],
            'Nueva cotización asignada',
            "Se te asignó la cotización #{$resultado['data']['IdCotizacion']}",
            'crm',
            'system',
            ['route' => "/crmModulo/cotizacion/{$resultado['data']['IdCotizacion']}"]
        );
    }

    HTTPreponse(1, 200, "Exito", $resultado['data']);
}
```

### Agregar la API Key al `.env` del backend

Agregar al archivo `it_web_service-Backend_R/.env`:

```ini
NOTIFICATIONS_API_KEY=<misma_clave_que_en_el_.env_raiz>
```

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
- `recipientId` (simple) - Consultas por usuario
- `read` (simple) - Filtro leído/no leído
- `{ recipientId, read, createdAt }` (compuesto) - Consulta principal del frontend

## Eventos WebSocket

| Evento | Dirección | Payload | Descripción |
|---|---|---|---|
| `register` | Cliente → Servidor | `userId` (string) | Registra al usuario para recibir sus notificaciones |
| `new-notification` | Servidor → Cliente | `Notification` (objeto completo) | Nueva notificación individual |
| `unread-count` | Servidor → Cliente | `{ count: number }` | Actualización del badge de no leídas |
| `broadcast-notification` | Servidor → Todos | `Notification` (sin _id) | Mensaje global a todos los conectados |

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
