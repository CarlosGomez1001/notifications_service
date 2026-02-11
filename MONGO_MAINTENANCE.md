# MongoDB Notifications - Guia de Gestion y Mantenimiento

> Base de datos: `notifications` | Coleccion: `notifications`
> Motor: MongoDB 7 (imagen `mongo:7-jammy`)
> ODM: Mongoose 8
> Contenedor Docker: `it-mongo-notifications`

---

## Tabla de Contenidos

1. [Conexion a la Base de Datos](#1-conexion-a-la-base-de-datos)
2. [Esquema de Datos](#2-esquema-de-datos)
3. [Indices](#3-indices)
4. [Protocolos de Depuracion de Registros](#4-protocolos-de-depuracion-de-registros)
5. [Mantenimiento Preventivo](#5-mantenimiento-preventivo)
6. [Monitoreo y Alertas](#6-monitoreo-y-alertas)
7. [Respaldos y Recuperacion](#7-respaldos-y-recuperacion)
8. [Seguridad](#8-seguridad)
9. [Troubleshooting](#9-troubleshooting)
10. [Referencia Rapida de Comandos](#10-referencia-rapida-de-comandos)

---

## 1. Conexion a la Base de Datos

### MongoDB Compass (GUI)

| Entorno | Connection String |
|---------|-------------------|
| Desde host local | `mongodb://localhost:27017/notifications` |
| Desde otro contenedor Docker | `mongodb://mongo-notifications:27017/notifications` |

**Pasos:**
1. Asegurar que el contenedor esta corriendo: `docker ps \| grep mongo-notifications`
2. Abrir MongoDB Compass
3. Pegar la URI: `mongodb://localhost:27017/notifications`
4. Click en **Connect**

### mongosh (Shell)

```bash
# Desde el host
mongosh "mongodb://localhost:27017/notifications"

# Desde dentro del contenedor
docker exec -it it-mongo-notifications mongosh notifications
```

### Aplicacion (Mongoose)

```
MONGO_URI=mongodb://mongo-notifications:27017/notifications
```

> **Nota:** Actualmente la base de datos **no tiene autenticacion** habilitada.
> Ver seccion [8. Seguridad](#8-seguridad) para recomendaciones de hardening.

---

## 2. Esquema de Datos

Coleccion: `notifications`

| Campo | Tipo | Requerido | Default | Descripcion |
|-------|------|-----------|---------|-------------|
| `_id` | ObjectId | Auto | Auto | Identificador unico del documento |
| `tenant` | String | Si | - | Nombre de la base de datos del cliente (multi-tenant) |
| `recipientId` | String | Si | - | IdEmpleado del usuario destino |
| `senderId` | String | No | `null` | IdEmpleado del remitente (`null` = sistema) |
| `type` | String (enum) | No | `"manual"` | Valores: `manual`, `system`, `reminder`, `alert` |
| `module` | String (enum) | No | `"general"` | Valores: `crm`, `logistica`, `mtto`, `general` |
| `title` | String | Si | - | Titulo (max 200 caracteres) |
| `message` | String | Si | - | Cuerpo del mensaje (max 1000 caracteres) |
| `metadata` | Mixed | No | `{}` | Datos adicionales para deep-linking |
| `read` | Boolean | No | `false` | Estado de lectura |
| `readAt` | Date | No | `null` | Fecha en que se marco como leida |
| `createdAt` | Date | Auto | `Date.now` | Fecha de creacion (Mongoose timestamps) |
| `updatedAt` | Date | Auto | `Date.now` | Fecha de ultima actualizacion |

### Documento de Ejemplo

```json
{
  "_id": "683d2f1a4b5c6d7e8f901234",
  "tenant": "empresa_produccion",
  "recipientId": "42",
  "senderId": "7",
  "type": "system",
  "module": "crm",
  "title": "Nueva cotizacion asignada",
  "message": "Se te ha asignado la cotizacion #1205 del cliente Acme Corp.",
  "metadata": {
    "route": "/crmModulo/cotizacion/1205",
    "IdCotizacion": 1205
  },
  "read": true,
  "readAt": "2025-07-15T14:30:00.000Z",
  "createdAt": "2025-07-15T10:00:00.000Z",
  "updatedAt": "2025-07-15T14:30:00.000Z"
}
```

---

## 3. Indices

### Indices Actuales

| Nombre | Campos | Tipo | Proposito |
|--------|--------|------|-----------|
| `_id_` | `{ _id: 1 }` | Default | Clave primaria |
| `tenant_1` | `{ tenant: 1 }` | Simple | Filtrado por tenant |
| `recipientId_1` | `{ recipientId: 1 }` | Simple | Filtrado por usuario |
| `read_1` | `{ read: 1 }` | Simple | Filtrado leidas/no leidas |
| Compuesto | `{ tenant: 1, recipientId: 1, read: 1, createdAt: -1 }` | Compuesto | Query principal del frontend |

### Verificar Indices

```javascript
// En mongosh
db.notifications.getIndexes()
```

### Verificar Uso de Indices

```javascript
// Analizar si una query usa indice
db.notifications.find({
  tenant: "empresa_produccion",
  recipientId: "42",
  read: false
}).sort({ createdAt: -1 }).explain("executionStats")
```

> El campo `winningPlan.stage` debe mostrar `IXSCAN` (no `COLLSCAN`).

---

## 4. Protocolos de Depuracion de Registros

### 4.1 Estrategia de Retencion Recomendada

La base de datos actualmente **no tiene politica de expiracion automatica**. Las notificaciones
persisten indefinidamente. Se recomienda implementar una estrategia de depuracion basada en
la siguiente clasificacion:

| Categoria | Criterio | Retencion Sugerida |
|-----------|----------|--------------------|
| Leidas antiguas | `read: true` + mas de 90 dias | Eliminar |
| No leidas antiguas | `read: false` + mas de 180 dias | Eliminar |
| Todas | Cualquier estado + mas de 365 dias | Eliminar |

### 4.2 Depuracion Manual (mongosh)

#### Eliminar notificaciones leidas con mas de 90 dias

```javascript
// Conectar a la base de datos
use notifications

// Primero CONTAR cuantos registros se eliminarian (dry run)
const cutoff90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
db.notifications.countDocuments({
  read: true,
  createdAt: { $lt: cutoff90 }
})

// Si el conteo es aceptable, proceder con la eliminacion
db.notifications.deleteMany({
  read: true,
  createdAt: { $lt: cutoff90 }
})
```

#### Eliminar notificaciones no leidas con mas de 180 dias

```javascript
const cutoff180 = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

// Dry run
db.notifications.countDocuments({
  read: false,
  createdAt: { $lt: cutoff180 }
})

// Ejecutar
db.notifications.deleteMany({
  read: false,
  createdAt: { $lt: cutoff180 }
})
```

#### Eliminar TODAS las notificaciones con mas de 1 ano

```javascript
const cutoff365 = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

// Dry run
db.notifications.countDocuments({
  createdAt: { $lt: cutoff365 }
})

// Ejecutar
db.notifications.deleteMany({
  createdAt: { $lt: cutoff365 }
})
```

#### Depuracion por tenant especifico

```javascript
// Limpiar registros viejos de un solo tenant
db.notifications.deleteMany({
  tenant: "empresa_produccion",
  read: true,
  createdAt: { $lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
})
```

### 4.3 Depuracion Automatica con TTL Index

La forma mas robusta de depurar registros es delegar la responsabilidad a MongoDB
mediante un **TTL Index**. Este indice elimina documentos automaticamente cuando
superan la edad configurada.

#### Opcion A: TTL sobre `createdAt` (elimina todo despues de N dias)

```javascript
// Eliminar automaticamente documentos con mas de 180 dias
db.notifications.createIndex(
  { "createdAt": 1 },
  { expireAfterSeconds: 15552000 }  // 180 dias = 180 * 24 * 60 * 60
)
```

> **Advertencia:** Esto elimina TODAS las notificaciones despues de 180 dias,
> sin importar si fueron leidas o no.

#### Opcion B: Campo dedicado `expiresAt` (control granular)

Para tener control diferenciado (ej: leidas expiran antes que no leidas),
agregar un campo `expiresAt` al esquema:

**1. Agregar al modelo Mongoose** (`src/models/Notification.js`):

```javascript
expiresAt: {
    type: Date,
    default: null,
    index: { expires: 0 },  // TTL index: elimina cuando Date.now() >= expiresAt
},
```

**2. Calcular `expiresAt` al crear la notificacion** (en el controller):

```javascript
const RETENTION_DAYS = 180;
const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
```

**3. Reducir TTL al marcar como leida** (en `markAsRead`):

```javascript
const READ_RETENTION_DAYS = 30;
const expiresAt = new Date(Date.now() + READ_RETENTION_DAYS * 24 * 60 * 60 * 1000);

await Notification.findByIdAndUpdate(req.params.id, {
    read: true,
    readAt: new Date(),
    expiresAt,
});
```

> MongoDB ejecuta el proceso de limpieza TTL cada ~60 segundos. Los documentos
> pueden persistir hasta 60 segundos mas alla de su tiempo de expiracion.

### 4.4 Depuracion con Script Programado (Cron Job)

Para escenarios donde se necesita logica de limpieza mas compleja, crear un script
que se ejecute periodicamente.

**Archivo: `scripts/cleanup-notifications.js`**

```javascript
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/notifications';

const POLICIES = {
  readOlderThanDays: 90,       // Leidas: eliminar despues de 90 dias
  unreadOlderThanDays: 180,    // No leidas: eliminar despues de 180 dias
  absoluteMaxDays: 365,        // Maximo absoluto: 1 ano
};

async function cleanup() {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  const collection = db.collection('notifications');

  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;

  // 1. Eliminar leidas antiguas
  const readResult = await collection.deleteMany({
    read: true,
    createdAt: { $lt: new Date(now - POLICIES.readOlderThanDays * msPerDay) },
  });
  console.log(`[Cleanup] Leidas eliminadas: ${readResult.deletedCount}`);

  // 2. Eliminar no leidas muy antiguas
  const unreadResult = await collection.deleteMany({
    read: false,
    createdAt: { $lt: new Date(now - POLICIES.unreadOlderThanDays * msPerDay) },
  });
  console.log(`[Cleanup] No leidas eliminadas: ${unreadResult.deletedCount}`);

  // 3. Eliminar todo lo que supere el maximo absoluto
  const absoluteResult = await collection.deleteMany({
    createdAt: { $lt: new Date(now - POLICIES.absoluteMaxDays * msPerDay) },
  });
  console.log(`[Cleanup] Eliminadas por edad absoluta: ${absoluteResult.deletedCount}`);

  // 4. Estadisticas finales
  const remaining = await collection.countDocuments();
  const dbStats = await db.stats();
  console.log(`[Cleanup] Documentos restantes: ${remaining}`);
  console.log(`[Cleanup] Tamano de la BD: ${(dbStats.dataSize / 1024 / 1024).toFixed(2)} MB`);

  await mongoose.disconnect();
}

cleanup().catch((err) => {
  console.error('[Cleanup] Error:', err);
  process.exit(1);
});
```

**Ejecucion manual:**

```bash
docker exec -it it-mongo-notifications mongosh notifications --eval '
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const count = db.notifications.countDocuments({ read: true, createdAt: { $lt: cutoff } });
  print("Registros a eliminar: " + count);
  if (count > 0) {
    const result = db.notifications.deleteMany({ read: true, createdAt: { $lt: cutoff } });
    print("Eliminados: " + result.deletedCount);
  }
'
```

**Programar con cron (host Linux/Mac):**

```bash
# Ejecutar limpieza todos los domingos a las 3:00 AM
# Agregar al crontab: crontab -e
0 3 * * 0 docker exec it-mongo-notifications mongosh notifications --eval 'db.notifications.deleteMany({ read: true, createdAt: { $lt: new Date(Date.now() - 90*24*60*60*1000) } })' >> /var/log/mongo-cleanup.log 2>&1
```

---

## 5. Mantenimiento Preventivo

### 5.1 Monitoreo del Tamano de la Base de Datos

```javascript
// En mongosh
use notifications

// Tamano general de la base de datos
db.stats()

// Tamano de la coleccion de notificaciones
db.notifications.stats()

// Informacion resumida
const stats = db.notifications.stats();
print(`Documentos: ${stats.count}`);
print(`Tamano datos: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
print(`Tamano almacenamiento: ${(stats.storageSize / 1024 / 1024).toFixed(2)} MB`);
print(`Tamano indices: ${(stats.totalIndexSize / 1024 / 1024).toFixed(2)} MB`);
print(`Tamano promedio por doc: ${stats.avgObjSize} bytes`);
```

### 5.2 Umbrales de Alerta Sugeridos

| Metrica | Umbral Atencion | Umbral Critico | Accion |
|---------|-----------------|----------------|--------|
| Total de documentos | > 500,000 | > 1,000,000 | Ejecutar depuracion |
| Tamano de datos | > 500 MB | > 1 GB | Ejecutar depuracion + revisar retencion |
| Tamano de indices | > 100 MB | > 250 MB | Verificar indices redundantes |
| Ratio storage/data | > 2.0 | > 3.0 | Ejecutar `compact` |

### 5.3 Compactacion de la Coleccion

Despues de eliminar grandes volumenes de datos, MongoDB no libera espacio en disco
automaticamente. Es necesario ejecutar una compactacion:

```javascript
// En mongosh (requiere que no haya operaciones pesadas en curso)
db.runCommand({ compact: "notifications" })
```

> **Nota:** Durante la compactacion, la coleccion queda bloqueada para escritura.
> Ejecutar en ventanas de bajo trafico.

### 5.4 Validacion de Integridad

```javascript
// Verificar integridad de la coleccion
db.notifications.validate({ full: true })
```

### 5.5 Revision de Indices Periodica

```javascript
// Listar todos los indices y su tamano
db.notifications.stats().indexSizes

// Verificar que no hay indices duplicados o sin uso
db.notifications.aggregate([{ $indexStats: {} }])
```

> Revisar que todos los indices tengan `accesses.ops > 0`. Un indice con
> cero accesos es candidato a eliminacion.

### 5.6 Fragmentacion por Tenant

Revisar la distribucion de documentos por tenant para detectar desbalances:

```javascript
db.notifications.aggregate([
  { $group: { _id: "$tenant", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
])
```

Si un tenant concentra un porcentaje desproporcionado, considerar una depuracion
mas agresiva para ese tenant o revisar si hay un flujo de notificaciones excesivo.

---

## 6. Monitoreo y Alertas

### 6.1 Queries de Diagnostico

```javascript
// Notificaciones creadas en las ultimas 24 horas
db.notifications.countDocuments({
  createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
})

// Notificaciones no leidas por tenant
db.notifications.aggregate([
  { $match: { read: false } },
  { $group: { _id: "$tenant", unread: { $sum: 1 } } },
  { $sort: { unread: -1 } }
])

// Top 10 usuarios con mas notificaciones acumuladas
db.notifications.aggregate([
  { $group: { _id: { tenant: "$tenant", user: "$recipientId" }, total: { $sum: 1 } } },
  { $sort: { total: -1 } },
  { $limit: 10 }
])

// Distribucion por tipo de notificacion
db.notifications.aggregate([
  { $group: { _id: "$type", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
])

// Distribucion por modulo
db.notifications.aggregate([
  { $group: { _id: "$module", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
])

// Notificaciones por dia (ultimos 30 dias)
db.notifications.aggregate([
  { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
  { $group: {
      _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
      count: { $sum: 1 }
  }},
  { $sort: { _id: 1 } }
])
```

### 6.2 Health Check del Servicio

```bash
# Verificar estado del microservicio
curl http://localhost:3002/notifications/health

# Verificar estado del contenedor MongoDB
docker inspect --format='{{.State.Health.Status}}' it-mongo-notifications
```

### 6.3 Logs del Contenedor

```bash
# Ver logs en tiempo real
docker logs -f it-mongo-notifications

# Ultimas 100 lineas
docker logs --tail 100 it-mongo-notifications

# Logs del microservicio de notificaciones
docker logs -f it-notifications-service
```

---

## 7. Respaldos y Recuperacion

### 7.1 Respaldo (mongodump)

```bash
# Respaldo completo de la base de datos notifications
docker exec it-mongo-notifications mongodump \
  --db notifications \
  --out /data/backup/$(date +%Y%m%d)

# Copiar respaldo al host
docker cp it-mongo-notifications:/data/backup ./backups/

# Respaldo directo al host (una sola linea)
docker exec it-mongo-notifications mongodump \
  --db notifications \
  --archive \
  | gzip > ./backups/notifications_$(date +%Y%m%d_%H%M%S).gz
```

### 7.2 Restauracion (mongorestore)

```bash
# Restaurar desde archivo comprimido
gunzip -c ./backups/notifications_20250715_030000.gz \
  | docker exec -i it-mongo-notifications mongorestore \
    --archive \
    --db notifications \
    --drop
```

> **`--drop`** elimina la coleccion existente antes de restaurar.
> Omitir si se desea un merge.

### 7.3 Exportar/Importar Selectivo (JSON)

```bash
# Exportar notificaciones de un tenant especifico
docker exec it-mongo-notifications mongoexport \
  --db notifications \
  --collection notifications \
  --query '{"tenant": "empresa_produccion"}' \
  --out /data/export_empresa.json

# Importar desde JSON
docker exec it-mongo-notifications mongoimport \
  --db notifications \
  --collection notifications \
  --file /data/export_empresa.json
```

### 7.4 Programacion de Respaldos Automaticos

```bash
# Agregar al crontab del host: crontab -e
# Respaldo diario a las 2:00 AM, conservar ultimos 30 dias
0 2 * * * docker exec it-mongo-notifications mongodump --db notifications --archive | gzip > /opt/backups/mongo/notifications_$(date +\%Y\%m\%d).gz && find /opt/backups/mongo/ -name "notifications_*.gz" -mtime +30 -delete
```

---

## 8. Seguridad

### 8.1 Estado Actual

La instancia de MongoDB actualmente opera **sin autenticacion**. Esto es aceptable
en un entorno de desarrollo donde el puerto solo es accesible desde `localhost`,
pero **no es aceptable en produccion**.

### 8.2 Habilitar Autenticacion (Recomendado para Produccion)

**1. Modificar `docker-compose.yml`:**

```yaml
mongo-notifications:
  image: mongo:7-jammy
  container_name: it-mongo-notifications
  environment:
    MONGO_INITDB_ROOT_USERNAME: admin
    MONGO_INITDB_ROOT_PASSWORD: ${MONGO_ROOT_PASSWORD}
    MONGO_INITDB_DATABASE: notifications
  command: ["mongod", "--auth"]
  # ... resto de la configuracion
```

**2. Agregar al `.env` raiz:**

```ini
MONGO_ROOT_PASSWORD=una_contrasena_segura_aqui
```

**3. Actualizar URI de conexion del microservicio:**

```ini
MONGO_URI=mongodb://admin:una_contrasena_segura_aqui@mongo-notifications:27017/notifications?authSource=admin
```

**4. Actualizar URI de Compass:**

```
mongodb://admin:una_contrasena_segura_aqui@localhost:27017/notifications?authSource=admin
```

### 8.3 Restringir Acceso por Red

En produccion, no exponer el puerto `27017` al host. Eliminar el mapeo de puertos
en `docker-compose.yml`:

```yaml
mongo-notifications:
  # ELIMINAR esta seccion en produccion:
  # ports:
  #   - "${MONGO_NOTIFICATIONS_PORT:-27017}:27017"
```

De esta forma MongoDB solo es accesible desde la red interna de Docker
(`it-web-service-network`).

### 8.4 Checklist de Seguridad

- [ ] Autenticacion habilitada con contrasena segura
- [ ] Puerto 27017 no expuesto al host en produccion
- [ ] API Key del microservicio rotada (no usar la de ejemplo)
- [ ] CORS origins restringidos a dominios de produccion
- [ ] Volumen de datos respaldado periodicamente
- [ ] Logs de acceso monitoreados

---

## 9. Troubleshooting

### El contenedor MongoDB no arranca

```bash
# Verificar logs
docker logs it-mongo-notifications

# Verificar que el volumen no este corrupto
docker volume inspect it_web_service-cluster_mongo_notifications_data

# Recrear contenedor (datos persistidos en volumen)
docker compose --profile notifications up -d mongo-notifications
```

### Conexion rechazada desde Compass

| Problema | Solucion |
|----------|----------|
| `connect ECONNREFUSED` | Verificar que el contenedor esta corriendo |
| `Authentication failed` | Revisar usuario/password en URI |
| Timeout | Verificar que el puerto 27017 esta mapeado al host |

```bash
# Verificar que el puerto esta expuesto
docker port it-mongo-notifications
```

### La base de datos crece demasiado rapido

1. Identificar el tenant con mas documentos (ver seccion 5.6)
2. Revisar si hay un endpoint generando notificaciones en exceso
3. Implementar politica de TTL (ver seccion 4.3)
4. Ejecutar depuracion manual inmediata (ver seccion 4.2)
5. Compactar despues de la limpieza (ver seccion 5.3)

### Queries lentas

```javascript
// Activar profiling para queries lentas (> 100ms)
db.setProfilingLevel(1, { slowms: 100 })

// Revisar queries lentas
db.system.profile.find().sort({ ts: -1 }).limit(5).pretty()

// Desactivar profiling cuando termine el diagnostico
db.setProfilingLevel(0)
```

### Microservicio no se conecta a MongoDB

```bash
# Verificar que ambos contenedores estan en la misma red
docker network inspect it-web-service-network

# Probar conectividad desde el contenedor del microservicio
docker exec it-notifications-service sh -c "wget -qO- http://mongo-notifications:27017 || echo 'No alcanzable'"
```

---

## 10. Referencia Rapida de Comandos

### Desde el Host

```bash
# Conectar a mongosh
docker exec -it it-mongo-notifications mongosh notifications

# Contar documentos totales
docker exec it-mongo-notifications mongosh notifications --eval 'db.notifications.countDocuments()'

# Ver tamano de la BD
docker exec it-mongo-notifications mongosh notifications --eval 'const s = db.stats(); print((s.dataSize/1024/1024).toFixed(2) + " MB")'

# Eliminar leidas > 90 dias
docker exec it-mongo-notifications mongosh notifications --eval 'db.notifications.deleteMany({ read: true, createdAt: { $lt: new Date(Date.now() - 90*24*60*60*1000) } })'

# Respaldo rapido
docker exec it-mongo-notifications mongodump --db notifications --archive | gzip > backup_$(date +%Y%m%d).gz
```

### Dentro de mongosh

```javascript
// Estadisticas generales
db.notifications.stats()

// Conteo por tenant
db.notifications.aggregate([{ $group: { _id: "$tenant", n: { $sum: 1 } } }])

// Documento mas antiguo
db.notifications.find().sort({ createdAt: 1 }).limit(1)

// Documento mas reciente
db.notifications.find().sort({ createdAt: -1 }).limit(1)

// Verificar indices
db.notifications.getIndexes()

// Compact (liberar espacio tras borrado masivo)
db.runCommand({ compact: "notifications" })
```

---

## Calendario de Mantenimiento Sugerido

| Frecuencia | Tarea | Referencia |
|------------|-------|------------|
| Diario | Verificar health check del servicio | Seccion 6.2 |
| Diario | Respaldo automatico de la BD | Seccion 7.4 |
| Semanal | Revisar tamano de la BD y conteo de documentos | Seccion 5.1 |
| Semanal | Depuracion de notificaciones leidas > 90 dias | Seccion 4.2 |
| Mensual | Revisar distribucion por tenant | Seccion 5.6 |
| Mensual | Revisar uso de indices (`$indexStats`) | Seccion 5.5 |
| Trimestral | Ejecutar `validate` de integridad | Seccion 5.4 |
| Trimestral | Compactar coleccion si ratio storage/data > 2.0 | Seccion 5.3 |
| Semestral | Revisar y rotar API Keys | Seccion 8.4 |
| Semestral | Limpiar respaldos antiguos (> 90 dias) | Seccion 7.4 |
