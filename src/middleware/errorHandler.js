/**
 * Middleware global de manejo de errores.
 */
const errorHandler = (err, _req, res, _next) => {
    console.error(`[ERROR] ${err.message}`, err.stack);

    res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || 'Error interno del servidor',
    });
};

module.exports = errorHandler;
