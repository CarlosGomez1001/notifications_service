const Notification = require('../models/Notification');
const { emitToUser, emitUnreadCount, emitBroadcast } = require('../services/socketService');

/**
 * POST /api/notifications/send
 * Crea y envía una notificación a un usuario específico.
 * Protegido por API Key (uso exclusivo del backend).
 * Requiere: tenant, recipientId, title, message
 */
const sendNotification = async (req, res, next) => {
    try {
        const { tenant, recipientId, senderId, type, module, title, message, metadata } = req.body;

        if (!tenant || !recipientId || !title || !message) {
            return res.status(400).json({
                success: false,
                message: 'Campos requeridos: tenant, recipientId, title, message',
            });
        }

        const notification = await Notification.create({
            tenant,
            recipientId,
            senderId: senderId || null,
            type: type || 'manual',
            module: module || 'general',
            title,
            message,
            metadata: metadata || {},
        });

        // Enviar en tiempo real vía WebSocket (scoped por tenant)
        emitToUser(tenant, recipientId, notification);

        // Actualizar contador de no leídas (scoped por tenant)
        const unreadCount = await Notification.countDocuments({
            tenant,
            recipientId,
            read: false,
        });
        emitUnreadCount(tenant, recipientId, unreadCount);

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
 * Envía la misma notificación a múltiples usuarios de un mismo tenant.
 * Protegido por API Key.
 * Requiere: tenant, recipientIds, title, message
 */
const sendBulkNotification = async (req, res, next) => {
    try {
        const { tenant, recipientIds, senderId, type, module, title, message, metadata } = req.body;

        if (!tenant || !Array.isArray(recipientIds) || recipientIds.length === 0 || !title || !message) {
            return res.status(400).json({
                success: false,
                message: 'Campos requeridos: tenant, recipientIds (array), title, message',
            });
        }

        const docs = recipientIds.map((recipientId) => ({
            tenant,
            recipientId,
            senderId: senderId || null,
            type: type || 'system',
            module: module || 'general',
            title,
            message,
            metadata: metadata || {},
        }));

        const notifications = await Notification.insertMany(docs);

        // Emitir a cada usuario dentro del tenant
        for (const notif of notifications) {
            emitToUser(tenant, notif.recipientId, notif);
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
 * Envía una notificación a todos los conectados de un tenant (o a todos si no se especifica).
 * Protegido por API Key.
 */
const broadcastNotification = async (req, res, next) => {
    try {
        const { tenant, senderId, type, module, title, message, metadata } = req.body;

        if (!title || !message) {
            return res.status(400).json({
                success: false,
                message: 'Campos requeridos: title, message',
            });
        }

        const notification = {
            tenant: tenant || null,
            senderId: senderId || null,
            type: type || 'system',
            module: module || 'general',
            title,
            message,
            metadata: metadata || {},
            createdAt: new Date(),
        };

        emitBroadcast(notification, tenant);

        res.status(200).json({
            success: true,
            message: tenant ? `Broadcast enviado al tenant ${tenant}` : 'Broadcast enviado a todos',
            data: notification,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/notifications/:tenant/:userId
 * Obtiene las notificaciones de un usuario dentro de su tenant con paginación.
 */
const getUserNotifications = async (req, res, next) => {
    try {
        const { tenant, userId } = req.params;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const onlyUnread = req.query.unread === 'true';

        const filter = { tenant, recipientId: userId };
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
 * GET /api/notifications/:tenant/:userId/unread-count
 * Devuelve la cantidad de notificaciones no leídas para un usuario en su tenant.
 */
const getUnreadCount = async (req, res, next) => {
    try {
        const { tenant, userId } = req.params;
        const count = await Notification.countDocuments({
            tenant,
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

        // Actualizar contador en tiempo real (scoped por tenant)
        const unreadCount = await Notification.countDocuments({
            tenant: notification.tenant,
            recipientId: notification.recipientId,
            read: false,
        });
        emitUnreadCount(notification.tenant, notification.recipientId, unreadCount);

        res.json({ success: true, data: notification });
    } catch (error) {
        next(error);
    }
};

/**
 * PATCH /api/notifications/:tenant/:userId/read-all
 * Marca todas las notificaciones de un usuario en su tenant como leídas.
 */
const markAllAsRead = async (req, res, next) => {
    try {
        const { tenant, userId } = req.params;

        await Notification.updateMany(
            { tenant, recipientId: userId, read: false },
            { read: true, readAt: new Date() }
        );

        emitUnreadCount(tenant, userId, 0);

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
