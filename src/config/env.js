const config = {
    port: process.env.PORT || 3002,
    mongoUri: process.env.MONGO_URI || 'mongodb://mongo-notifications:27017/notifications',
    apiKey: process.env.API_KEY || 'changeme-generate-a-secure-key',
    corsOrigins: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',')
        : ['http://localhost:5173', 'http://localhost:80'],
    nodeEnv: process.env.NODE_ENV || 'development',
};

module.exports = config;
