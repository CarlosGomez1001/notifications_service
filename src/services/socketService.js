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
 * Emite una notificación broadcast a todos los usuarios de un tenant específico.
 * Si no se pasa tenant, emite a todos los conectados.
 */
const emitBroadcast = (notification, tenant) => {
    const io = getIO();
    if (tenant) {
        const rooms = io.sockets.adapter.rooms;
        for (const [roomName] of rooms) {
            if (roomName.startsWith(`user:${tenant}:`)) {
                io.to(roomName).emit('broadcast-notification', notification);
            }
        }
    } else {
        io.emit('broadcast-notification', notification);
    }
};

module.exports = { emitToUser, emitUnreadCount, emitBroadcast };
