const mongoose = require('mongoose');
const config = require('./env');

const connectDB = async () => {
    try {
        await mongoose.connect(config.mongoUri);
        console.log(`[DB] MongoDB conectado: ${mongoose.connection.host}`);
    } catch (error) {
        console.error(`[DB] Error de conexion: ${error.message}`);
        process.exit(1);
    }
};

module.exports = connectDB;
