const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
    {
        // Identificador del tenant (nombre de base de datos del cliente)
        tenant: {
            type: String,
            required: true,
            index: true,
        },
        // Usuario destino (IdEmpleado del sistema principal)
        recipientId: {
            type: String,
            required: true,
            index: true,
        },
        // Usuario origen (null si es notificación del sistema)
        senderId: {
            type: String,
            default: null,
        },
        // Tipo de notificación
        type: {
            type: String,
            enum: ['manual', 'system', 'reminder', 'alert'],
            default: 'manual',
        },
        // Módulo que origina la notificación
        module: {
            type: String,
            enum: ['crm', 'logistica', 'mtto', 'general'],
            default: 'general',
        },
        title: {
            type: String,
            required: true,
            maxlength: 200,
        },
        message: {
            type: String,
            required: true,
            maxlength: 1000,
        },
        // Datos adicionales para deep-linking (ej: { route: '/crm/cotizacion/123' })
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        read: {
            type: Boolean,
            default: false,
            index: true,
        },
        readAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true, // createdAt, updatedAt
    }
);

// Índice compuesto para consultas frecuentes (scoped por tenant)
notificationSchema.index({ tenant: 1, recipientId: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
