const Notification = require('../models/Notification');
const { emitToUser, emitUnreadCount, emitBroadcast } = require('../services/socketService');

/**
 * POST /api/notifications/send
 * Crea y envía una notificación a un usuario específico.
 * Protegido por API Key (uso exclusivo del backend).
 */
const sendNotification = async (req, res, next) => {
    try {
        const { recipientId, senderId, type, module, title, message, metadata } = req.body;

        if (!recipientId || !title || !message) {
            return res.status(400).json({
                success: false,
                message: 'Campos requeridos: recipientId, title, message',
            });
        }

        const notification = await Notification.create({
            recipientId,
            senderId: senderId || null,
            type: type || 'manual',
            module: module || 'general',
            title,
            message,
            metadata: metadata || {},
        });

        // Enviar en tiempo real vía WebSocket
        emitToUser(recipientId, notification);

        // Actualizar contador de no leídas
        const unreadCount = await Notification.countDocuments({
            recipientId,
            read: false,
        });
        emitUnreadCount(recipientId, unreadCount);

        res.status(201).json({
            success: true,
            message: 'Notificacion enviada',
            data: notification,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/notifications/send-bulk
 * Envía la misma notificación a múltiples usuarios.
 * Protegido por API Key.
 */
const sendBulkNotification = async (req, res, next) => {
    try {
        const { recipientIds, senderId, type, module, title, message, metadata } = req.body;

        if (!Array.isArray(recipientIds) || recipientIds.length === 0 || !title || !message) {
            return res.status(400).json({
                success: false,
                message: 'Campos requeridos: recipientIds (array), title, message',
            });
        }

        const docs = recipientIds.map((recipientId) => ({
            recipientId,
            senderId: senderId || null,
            type: type || 'system',
            module: module || 'general',
            title,
            message,
            metadata: metadata || {},
        }));

        const notifications = await Notification.insertMany(docs);

        // Emitir a cada usuario
        for (const notif of notifications) {
            emitToUser(notif.recipientId, notif);
        }

        res.status(201).json({
            success: true,
            message: `Notificacion enviada a ${notifications.length} usuarios`,
            data: { count: notifications.length },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/notifications/broadcast
 * Envía una notificación global a todos los conectados.
 * Protegido por API Key.
 */
const broadcastNotification = async (req, res, next) => {
    try {
        const { senderId, type, module, title, message, metadata } = req.body;

        if (!title || !message) {
            return res.status(400).json({
                success: false,
                message: 'Campos requeridos: title, message',
            });
        }

        const notification = {
            senderId: senderId || null,
            type: type || 'system',
            module: module || 'general',
            title,
            message,
            metadata: metadata || {},
            createdAt: new Date(),
        };

        emitBroadcast(notification);

        res.status(200).json({
            success: true,
            message: 'Broadcast enviado',
            data: notification,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/notifications/:userId
 * Obtiene las notificaciones de un usuario con paginación.
 * Público (el frontend llama directamente).
 */
const getUserNotifications = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const onlyUnread = req.query.unread === 'true';

        const filter = { recipientId: userId };
        if (onlyUnread) filter.read = false;

        const [notifications, total] = await Promise.all([
            Notification.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            Notification.countDocuments(filter),
        ]);

        res.json({
            success: true,
            data: notifications,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/notifications/:userId/unread-count
 * Devuelve la cantidad de notificaciones no leídas.
 */
const getUnreadCount = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const count = await Notification.countDocuments({
            recipientId: userId,
            read: false,
        });

        res.json({ success: true, data: { count } });
    } catch (error) {
        next(error);
    }
};

/**
 * PATCH /api/notifications/:id/read
 * Marca una notificación como leída.
 */
const markAsRead = async (req, res, next) => {
    try {
        const notification = await Notification.findByIdAndUpdate(
            req.params.id,
            { read: true, readAt: new Date() },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notificacion no encontrada',
            });
        }

        // Actualizar contador en tiempo real
        const unreadCount = await Notification.countDocuments({
            recipientId: notification.recipientId,
            read: false,
        });
        emitUnreadCount(notification.recipientId, unreadCount);

        res.json({ success: true, data: notification });
    } catch (error) {
        next(error);
    }
};

/**
 * PATCH /api/notifications/:userId/read-all
 * Marca todas las notificaciones de un usuario como leídas.
 */
const markAllAsRead = async (req, res, next) => {
    try {
        const { userId } = req.params;

        await Notification.updateMany(
            { recipientId: userId, read: false },
            { read: true, readAt: new Date() }
        );

        emitUnreadCount(userId, 0);

        res.json({ success: true, message: 'Todas las notificaciones marcadas como leidas' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    sendNotification,
    sendBulkNotification,
    broadcastNotification,
    getUserNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
};
