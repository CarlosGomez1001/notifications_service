const { Server } = require('socket.io');
const config = require('./env');
const { verifyNotificationToken } = require('../services/tokenService');

let io = null;

/**
 * Inicializa Socket.io sobre el servidor HTTP existente.
 *
 * Autenticación: el cliente se conecta con `auth: { token }` (token de
 * notificaciones emitido por el backend). La identidad (tenant + userId) sale
 * del token verificado; el cliente ya no puede declararla. Cada socket se une
 * automáticamente al room `user:{tenant}:{userId}`.
 *
 * Expiración: al vencer el token el servidor emite `token-expired` y cierra el
 * socket. El cliente solicita un token nuevo y reconecta (ver notificationSocket.js).
 */
const initSocket = (httpServer) => {
    io = new Server(httpServer, {
        cors: {
            origin: config.corsOrigins,
            methods: ['GET', 'POST'],
        },
        path: '/notifications/socket.io',
        pingInterval: 25000,
        pingTimeout: 20000,
    });

    // ─── Handshake: rechaza conexiones sin token válido ─────────────────────
    io.use((socket, next) => {
        try {
            socket.data.auth = verifyNotificationToken(socket.handshake.auth?.token);
            next();
        } catch (error) {
            const err = new Error(error.message);
            err.data = { code: error.code };
            next(err);
        }
    });

    io.on('connection', (socket) => {
        const { tenant, userId, exp } = socket.data.auth;
        const roomKey = `user:${tenant}:${userId}`;

        socket.join(roomKey);
        console.log(`[WS] Conectado ${tenant}:${userId} (socket: ${socket.id})`);

        // Cierra el socket exactamente cuando vence el token para forzar la renovación.
        const msUntilExpiry = Math.max(0, exp * 1000 - Date.now());
        const expiryTimer = setTimeout(() => {
            socket.emit('token-expired');
            socket.disconnect(true);
        }, msUntilExpiry);

        socket.on('disconnect', (reason) => {
            clearTimeout(expiryTimer);
            console.log(`[WS] Desconectado ${tenant}:${userId} (${reason})`);
        });
    });

    return io;
};

const getIO = () => {
    if (!io) throw new Error('Socket.io no ha sido inicializado');
    return io;
};

module.exports = { initSocket, getIO };
