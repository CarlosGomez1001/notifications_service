const { getIO } = require('../config/socket');

/**
 * Emite una notificación en tiempo real al usuario destino dentro de su tenant.
 * Room format: "user:{tenant}:{recipientId}"
 */
const emitToUser = (tenant, recipientId, notification) => {
    const io = getIO();
    io.to(`user:${tenant}:${recipientId}`).emit('new-notification', notification);
};

/**
 * Emite un evento de actualización de contador de no leídas (scoped por tenant).
 */
const emitUnreadCount = (tenant, recipientId, count) => {
    const io = getIO();
    io.to(`user:${tenant}:${recipientId}`).emit('unread-count', { count });
};

/**
 * Emite una notificación broadcast a los usuarios de uno o varios tenants.
 * `tenants` puede ser un string, un array de strings, o null/undefined para emitir a todos los conectados.
 */
const emitBroadcast = (notification, tenants) => {
    const io = getIO();
    if (tenants) {
        const prefixes = (Array.isArray(tenants) ? tenants : [tenants]).map((tenant) => `user:${tenant}:`);
        const rooms = io.sockets.adapter.rooms;
        for (const [roomName] of rooms) {
            if (prefixes.some((prefix) => roomName.startsWith(prefix))) {
                io.to(roomName).emit('broadcast-notification', notification);
            }
        }
    } else {
        io.emit('broadcast-notification', notification);
    }
};

module.exports = { emitToUser, emitUnreadCount, emitBroadcast };
