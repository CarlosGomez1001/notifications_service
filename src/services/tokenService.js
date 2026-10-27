const jwt = require('jsonwebtoken');
const config = require('../config/env');

const ID_PATTERN = /^[\w.\-]{1,128}$/;

/**
 * Verifica un token de notificaciones emitido por el backend PHP.
 * Valida firma (HS256), expiración, issuer y audience, y que los claims de
 * identidad tengan un formato seguro. Devuelve { tenant, userId, exp }.
 *
 * Lanza un Error con `code`:
 *   - TOKEN_MISSING | TOKEN_EXPIRED | TOKEN_INVALID
 */
const verifyNotificationToken = (token) => {
    if (!token || typeof token !== 'string') {
        throw Object.assign(new Error('Token requerido'), { code: 'TOKEN_MISSING' });
    }

    let payload;
    try {
        payload = jwt.verify(token, config.jwtSecret, {
            algorithms: ['HS256'],
            issuer: config.jwtIssuer,
            audience: config.jwtAudience,
        });
    } catch (error) {
        const code = error.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
        throw Object.assign(new Error(code === 'TOKEN_EXPIRED' ? 'Token expirado' : 'Token invalido'), { code });
    }

    const tenant = typeof payload.tenant === 'string' ? payload.tenant : null;
    const userId = typeof payload.sub === 'string' ? payload.sub : null;

    if (!tenant || !userId || !ID_PATTERN.test(tenant) || !ID_PATTERN.test(userId)) {
        throw Object.assign(new Error('Token invalido'), { code: 'TOKEN_INVALID' });
    }

    return { tenant, userId, exp: payload.exp };
};

module.exports = { verifyNotificationToken, ID_PATTERN };
