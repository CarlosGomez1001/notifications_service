const { verifyNotificationToken } = require('../services/tokenService');

/**
 * Middleware para las rutas que consume el frontend.
 * Exige `Authorization: Bearer <token de notificaciones>` emitido por el backend
 * y expone la identidad verificada en `req.auth = { tenant, userId }`.
 *
 * Los controladores deben usar SIEMPRE req.auth y nunca tenant/userId que vengan
 * en la URL o el body: eso es lo que aísla a los usuarios y a los clientes.
 */
const jwtAuth = (req, res, next) => {
    const header = req.headers.authorization || '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);

    try {
        req.auth = verifyNotificationToken(match ? match[1] : null);
        next();
    } catch (error) {
        res.status(401).json({
            success: false,
            code: error.code,
            message: error.message,
        });
    }
};

module.exports = jwtAuth;
