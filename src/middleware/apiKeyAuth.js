const config = require('../config/env');

/**
 * Middleware de autenticación por API Key.
 * Valida el header `x-api-key` contra la clave configurada.
 * Solo el backend PHP autorizado debe conocer esta clave.
 */
const apiKeyAuth = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        return res.status(401).json({
            success: false,
            message: 'API Key requerida (header x-api-key)',
        });
    }

    if (apiKey !== config.apiKey) {
        return res.status(403).json({
            success: false,
            message: 'API Key invalida',
        });
    }

    next();
};

module.exports = apiKeyAuth;
