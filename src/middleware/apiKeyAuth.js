const crypto = require('node:crypto');
const config = require('../config/env');

// Se comparan hashes de longitud fija para poder usar timingSafeEqual sin
// filtrar la longitud de la clave real.
const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();
const expectedDigest = digest(config.apiKey);

/**
 * Middleware de autenticación por API Key.
 * Valida el header `x-api-key` contra la clave configurada (tiempo constante).
 * Solo el backend PHP (red Docker interna) debe conocer esta clave.
 */
const apiKeyAuth = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        return res.status(401).json({
            success: false,
            message: 'API Key requerida (header x-api-key)',
        });
    }

    if (!crypto.timingSafeEqual(digest(apiKey), expectedDigest)) {
        return res.status(403).json({
            success: false,
            message: 'API Key invalida',
        });
    }

    next();
};

module.exports = apiKeyAuth;
