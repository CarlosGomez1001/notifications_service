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

    // Mapa de usuarios conectados: "tenant:userId" -> Set<socketId>
    const connectedUsers = new Map();

    io.on('connection', (socket) => {
        console.log(`[WS] Cliente conectado: ${socket.id}`);

        // El cliente envía { userId, tenant } al conectarse
        socket.on('register', (data) => {
            // Soportar formato objeto { userId, tenant }
            let userId, tenant;
            if (typeof data === 'object' && data !== null) {
                userId = data.userId;
                tenant = data.tenant;
            } else {
                // Legacy: solo userId sin tenant — ignorar registro
                return;
            }

            if (!userId || !tenant) return;

            socket.userId = String(userId);
            socket.tenant = String(tenant);
            const roomKey = `user:${socket.tenant}:${socket.userId}`;

            if (!connectedUsers.has(roomKey)) {
                connectedUsers.set(roomKey, new Set());
            }
            connectedUsers.get(roomKey).add(socket.id);

            socket.join(roomKey);
            console.log(`[WS] Usuario registrado: ${socket.tenant}:${socket.userId} (socket: ${socket.id})`);
        });

        socket.on('disconnect', () => {
            if (socket.userId && socket.tenant) {
                const roomKey = `user:${socket.tenant}:${socket.userId}`;
                if (connectedUsers.has(roomKey)) {
                    connectedUsers.get(roomKey).delete(socket.id);
                    if (connectedUsers.get(roomKey).size === 0) {
                        connectedUsers.delete(roomKey);
                    }
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
