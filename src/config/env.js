const isProduction = process.env.NODE_ENV === 'production';

const PLACEHOLDER = /^changeme/i;
const MIN_SECRET_LENGTH = 32;

/**
 * Los secretos no tienen valor por defecto: si faltan (o son el placeholder del
 * .env.example) el servicio no arranca. En producción además se exige
 * MONGO_URI y CORS_ORIGINS explícitos para no heredar valores de desarrollo.
 */
const fail = (message) => {
    console.error(`[Config] ${message}`);
    process.exit(1);
};

const requireSecret = (name) => {
    const value = process.env[name];
    if (!value || PLACEHOLDER.test(value)) {
        fail(`${name} no definida (o usa el placeholder). Generar con: openssl rand -hex 32`);
    }
    if (value.length < MIN_SECRET_LENGTH) {
        fail(`${name} debe tener al menos ${MIN_SECRET_LENGTH} caracteres`);
    }
    return value;
};

const requireInProduction = (name, fallback) => {
    const value = process.env[name];
    if (value) return value;
    if (isProduction) fail(`${name} es obligatoria en producción`);
    return fallback;
};

const apiKey = requireSecret('API_KEY');
const jwtSecret = requireSecret('NOTIFICATIONS_JWT_SECRET');

if (apiKey === jwtSecret) {
    fail('API_KEY y NOTIFICATIONS_JWT_SECRET deben ser valores distintos');
}

const config = {
    port: process.env.PORT || 3002,
    mongoUri: requireInProduction('MONGO_URI', 'mongodb://mongo-notifications:27017/notifications'),
    // Backend -> microservicio (rutas /send, /send-bulk, /broadcast)
    apiKey,
    // Token específico de notificaciones firmado por el backend PHP (HS256).
    // Es distinto de SEC_KEY del backend: el microservicio nunca puede firmar sesiones.
    jwtSecret,
    jwtIssuer: process.env.NOTIFICATIONS_JWT_ISSUER || 'it-backend',
    jwtAudience: process.env.NOTIFICATIONS_JWT_AUDIENCE || 'it-notifications',
    corsOrigins: requireInProduction('CORS_ORIGINS', 'http://localhost:5173,http://localhost:80')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    nodeEnv: process.env.NODE_ENV || 'development',
    isProduction,
};

module.exports = config;
