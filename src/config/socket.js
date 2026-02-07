const { Server } = require('socket.io');
const config = require('./env');

let io = null;

/**
 * Inicializa Socket.io sobre el servidor HTTP existente.
 * Mantiene un mapa interno `userId -> Set<socketId>` para
 * poder enviar notificaciones dirigidas a usuarios específicos.
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

    // Mapa de usuarios conectados: userId -> Set<socketId>
    const connectedUsers = new Map();

    io.on('connection', (socket) => {
        console.log(`[WS] Cliente conectado: ${socket.id}`);

        // El cliente envía su userId al conectarse
        socket.on('register', (userId) => {
            if (!userId) return;

            socket.userId = String(userId);

            if (!connectedUsers.has(socket.userId)) {
                connectedUsers.set(socket.userId, new Set());
            }
            connectedUsers.get(socket.userId).add(socket.id);

            socket.join(`user:${socket.userId}`);
            console.log(`[WS] Usuario registrado: ${socket.userId} (socket: ${socket.id})`);
        });

        socket.on('disconnect', () => {
            if (socket.userId && connectedUsers.has(socket.userId)) {
                connectedUsers.get(socket.userId).delete(socket.id);
                if (connectedUsers.get(socket.userId).size === 0) {
                    connectedUsers.delete(socket.userId);
                }
            }
            console.log(`[WS] Cliente desconectado: ${socket.id}`);
        });
    });

    return io;
};

const getIO = () => {
    if (!io) throw new Error('Socket.io no ha sido inicializado');
    return io;
};

module.exports = { initSocket, getIO };
