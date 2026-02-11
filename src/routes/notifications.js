const { Router } = require('express');
const apiKeyAuth = require('../middleware/apiKeyAuth');
const ctrl = require('../controllers/notificationController');

const router = Router();

// ─── Rutas protegidas por API Key (solo backend) ────────────────────────────
router.post('/send', apiKeyAuth, ctrl.sendNotification);
router.post('/send-bulk', apiKeyAuth, ctrl.sendBulkNotification);
router.post('/broadcast', apiKeyAuth, ctrl.broadcastNotification);

// ─── Rutas públicas (frontend consume directamente) ─────────────────────────
// Todas las rutas de lectura requieren tenant + userId para aislar datos entre clientes
router.get('/:tenant/:userId', ctrl.getUserNotifications);
router.get('/:tenant/:userId/unread-count', ctrl.getUnreadCount);
router.patch('/:id/read', ctrl.markAsRead);
router.patch('/:tenant/:userId/read-all', ctrl.markAllAsRead);

module.exports = router;
