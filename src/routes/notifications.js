const { Router } = require('express');
const apiKeyAuth = require('../middleware/apiKeyAuth');
const jwtAuth = require('../middleware/jwtAuth');
const ctrl = require('../controllers/notificationController');

const router = Router();

// ─── Rutas protegidas por API Key (solo backend, red Docker interna) ────────
// No deben exponerse en el proxy público (ver nginx/nginx.conf).
router.post('/send', apiKeyAuth, ctrl.sendNotification);
router.post('/send-bulk', apiKeyAuth, ctrl.sendBulkNotification);
router.post('/broadcast', apiKeyAuth, ctrl.broadcastNotification);

// ─── Rutas del usuario (JWT de notificaciones emitido por el backend) ───────
// La identidad (tenant + userId) se toma del token, no de la URL.
// Las rutas estáticas van antes que '/:id/read'.
router.get('/', jwtAuth, ctrl.getUserNotifications);
router.get('/unread-count', jwtAuth, ctrl.getUnreadCount);
router.patch('/read-all', jwtAuth, ctrl.markAllAsRead);
router.patch('/:id/read', jwtAuth, ctrl.markAsRead);

module.exports = router;
