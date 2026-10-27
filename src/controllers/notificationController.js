const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const { emitToUser, emitUnreadCount, emitBroadcast } = require('../services/socketService');
const { asId, asIdList, parseNotificationBody, MAX_BULK_RECIPIENTS, MAX_BROADCAST_TENANTS } = require('../utils/validators');

const badRequest = (res, message) => res.status(400).json({ success: false, message });

// ═════════════════════════════════════════════════════════════════════════════
// Rutas protegidas por API Key (las invoca únicamente el backend PHP)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/notifications/send
 * Crea y envía una notificación a un usuario específico.
 * Requiere: tenant, recipientId, title, message
 */
const sendNotification = async (req, res, next) => {
    try {
        const tenant = asId(req.body?.tenant);
        const recipientId = asId(req.body?.recipientId);
        if (!tenant || !recipientId) return badRequest(res, 'tenant y recipientId requeridos (formato invalido)');

        const { value, error } = parseNotificationBody(req.body, { defaultType: 'manual' });
        if (error) return badRequest(res, error);

        const notification = await Notification.create({ tenant, recipientId, ...value });

        emitToUser(tenant, recipientId, notification);

        const unreadCount = await Notification.countDocuments({ tenant, recipientId, read: false });
        emitUnreadCount(tenant, recipientId, unreadCount);

        res.status(201).json({ success: true, message: 'Notificacion enviada', data: notification });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/notifications/send-bulk
 * Envía la misma notificación a múltiples usuarios de un mismo tenant.
 * Requiere: tenant, recipientIds, title, message
 */
const sendBulkNotification = async (req, res, next) => {
    try {
        const tenant = asId(req.body?.tenant);
        const rawIds = req.body?.recipientIds;
        if (!tenant || !Array.isArray(rawIds) || rawIds.length === 0) {
            return badRequest(res, 'tenant y recipientIds (array) requeridos');
        }
        if (rawIds.length > MAX_BULK_RECIPIENTS) {
            return badRequest(res, `recipientIds admite maximo ${MAX_BULK_RECIPIENTS} destinatarios`);
        }

        const recipientIds = rawIds.map(asId);
        if (recipientIds.some((id) => !id)) return badRequest(res, 'recipientIds contiene valores invalidos');

        const { value, error } = parseNotificationBody(req.body, { defaultType: 'system' });
        if (error) return badRequest(res, error);

        const uniqueIds = [...new Set(recipientIds)];
        const notifications = await Notification.insertMany(
            uniqueIds.map((recipientId) => ({ tenant, recipientId, ...value }))
        );

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
 * Emite a los conectados de: un tenant (`tenant`), varios tenants (`tenants`, array)
 * o todos (sin ninguno de los dos). `tenant` y `tenants` son excluyentes.
 * No se persiste. La autorización de quién puede hacerlo vive en el backend PHP.
 */
const broadcastNotification = async (req, res, next) => {
    try {
        const hasTenant = req.body?.tenant !== undefined && req.body?.tenant !== null;
        const hasTenants = req.body?.tenants !== undefined && req.body?.tenants !== null;
        if (hasTenant && hasTenants) return badRequest(res, 'Use tenant o tenants, no ambos');

        let target = null; // null = todos
        if (hasTenant) {
            target = asId(req.body.tenant);
            if (!target) return badRequest(res, 'tenant invalido');
        } else if (hasTenants) {
            target = asIdList(req.body.tenants, MAX_BROADCAST_TENANTS);
            if (!target) return badRequest(res, `tenants invalido (array de 1 a ${MAX_BROADCAST_TENANTS} ids)`);
        }

        const { value, error } = parseNotificationBody(req.body, { defaultType: 'system' });
        if (error) return badRequest(res, error);

        // Si va a un solo tenant se informa en la notificación; con varios o todos queda null
        const notification = {
            tenant: typeof target === 'string' ? target : null,
            ...value,
            createdAt: new Date(),
        };

        emitBroadcast(notification, target);

        let message = 'Broadcast enviado a todos';
        if (typeof target === 'string') message = `Broadcast enviado al tenant ${target}`;
        else if (Array.isArray(target)) message = `Broadcast enviado a ${target.length} tenants`;

        res.status(200).json({ success: true, message, data: notification });
    } catch (error) {
        next(error);
    }
};

// ═════════════════════════════════════════════════════════════════════════════
// Rutas del usuario autenticado (JWT de notificaciones). tenant/userId salen
// SIEMPRE de req.auth; nunca de la URL ni del body.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/notifications?page=1&limit=20&unread=true
 */
const getUserNotifications = async (req, res, next) => {
    try {
        const { tenant, userId } = req.auth;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
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
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/notifications/unread-count
 */
const getUnreadCount = async (req, res, next) => {
    try {
        const { tenant, userId } = req.auth;
        const count = await Notification.countDocuments({ tenant, recipientId: userId, read: false });
        res.json({ success: true, data: { count } });
    } catch (error) {
        next(error);
    }
};

/**
 * PATCH /api/notifications/:id/read
 * Solo puede marcar notificaciones propias (mismo tenant y mismo destinatario).
 */
const markAsRead = async (req, res, next) => {
    try {
        const { tenant, userId } = req.auth;
        const { id } = req.params;

        if (!mongoose.isValidObjectId(id)) return badRequest(res, 'Id de notificacion invalido');

        const notification = await Notification.findOneAndUpdate(
            { _id: id, tenant, recipientId: userId },
            { read: true, readAt: new Date() },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notificacion no encontrada' });
        }

        const unreadCount = await Notification.countDocuments({ tenant, recipientId: userId, read: false });
        emitUnreadCount(tenant, userId, unreadCount);

        res.json({ success: true, data: notification });
    } catch (error) {
        next(error);
    }
};

/**
 * PATCH /api/notifications/read-all
 */
const markAllAsRead = async (req, res, next) => {
    try {
        const { tenant, userId } = req.auth;

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
