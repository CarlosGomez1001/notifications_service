const http = require('node:http');
const express = require('express');
const cors = require('cors');

const config = require('./config/env');
const connectDB = require('./config/database');
const { initSocket } = require('./config/socket');
const notificationRoutes = require('./routes/notifications');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const server = http.createServer(app);

// ─── Middlewares ─────────────────────────────────────────────────────────────
app.use(cors({ origin: config.corsOrigins }));
app.use(express.json());

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/notifications/health', (_req, res) => {
    res.json({ status: 'ok', service: 'notifications', uptime: process.uptime() });
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/notifications', notificationRoutes);

// ─── Error handler ───────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ───────────────────────────────────────────────────────────────────
const start = async () => {
    await connectDB();
    initSocket(server);

    server.listen(config.port, () => {
        console.log(`[Server] Notifications service corriendo en puerto ${config.port}`);
        console.log(`[Server] Entorno: ${config.nodeEnv}`);
    });
};

start();
