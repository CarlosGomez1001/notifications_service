const { Router } = require('express');
const apiKeyAuth = require('../middleware/apiKeyAuth');
const ctrl = require('../controllers/notificationController');

const router = Router();

// ─── Rutas protegidas por API Key (solo backend) ────────────────────────────
router.post('/send', apiKeyAuth, ctrl.sendNotification);
router.post('/send-bulk', apiKeyAuth, ctrl.sendBulkNotification);
router.post('/broadcast', apiKeyAuth, ctrl.broadcastNotification);

// ─── Rutas públicas (frontend consume directamente) ─────────────────────────
router.get('/:userId', ctrl.getUserNotifications);
router.get('/:userId/unread-count', ctrl.getUnreadCount);
router.patch('/:id/read', ctrl.markAsRead);
router.patch('/:userId/read-all', ctrl.markAllAsRead);

module.exports = router;
