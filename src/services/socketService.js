const { getIO } = require('../config/socket');

/**
 * Emite una notificación en tiempo real al usuario destino.
 * Si el usuario tiene múltiples pestañas/dispositivos, todas reciben el evento.
 */
const emitToUser = (recipientId, notification) => {
    const io = getIO();
    io.to(`user:${recipientId}`).emit('new-notification', notification);
};

/**
 * Emite un evento de actualización de contador de no leídas.
 */
const emitUnreadCount = (recipientId, count) => {
    const io = getIO();
    io.to(`user:${recipientId}`).emit('unread-count', { count });
};

/**
 * Emite una notificación broadcast a todos los usuarios conectados.
 */
const emitBroadcast = (notification) => {
    const io = getIO();
    io.emit('broadcast-notification', notification);
};

module.exports = { emitToUser, emitUnreadCount, emitBroadcast };
