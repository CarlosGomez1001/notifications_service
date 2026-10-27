const { ID_PATTERN } = require('../services/tokenService');

const TYPES = ['manual', 'system', 'reminder', 'alert'];
const MODULES = ['crm', 'logistica', 'mtto', 'general'];
const MAX_TITLE = 200;
const MAX_MESSAGE = 1000;
const MAX_METADATA_BYTES = 4096;
const MAX_BULK_RECIPIENTS = 500;
const MAX_BROADCAST_TENANTS = 200;

/**
 * Normaliza un identificador (tenant, userId) a string y valida su formato.
 * Rechaza objetos/arrays: evita inyección de operadores NoSQL ({ "$ne": null }).
 */
const asId = (value) => {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const id = String(value);
    return ID_PATTERN.test(id) ? id : null;
};

/**
 * Lista de ids sin duplicados (1..max). Devuelve null si algún elemento es inválido.
 */
const asIdList = (value, max) => {
    if (!Array.isArray(value) || value.length === 0 || value.length > max) return null;
    const ids = value.map(asId);
    return ids.some((id) => !id) ? null : [...new Set(ids)];
};

const asText = (value, max) => {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text.length > 0 && text.length <= max ? text : null;
};

/**
 * metadata debe ser un objeto plano de tamaño acotado. Si trae `route`
 * (deep-link) tiene que ser una ruta interna del front ("/crm/...").
 */
const asMetadata = (value) => {
    if (value === undefined || value === null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) return null;
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_METADATA_BYTES) return null;
    if (value.route !== undefined) {
        if (typeof value.route !== 'string' || !/^\/(?!\/)/.test(value.route)) return null;
    }
    return value;
};

/**
 * Valida el cuerpo común de send / send-bulk / broadcast.
 * Devuelve { value } o { error }.
 */
const parseNotificationBody = (body, { defaultType }) => {
    const data = body && typeof body === 'object' ? body : {};

    const title = asText(data.title, MAX_TITLE);
    if (!title) return { error: `title requerido (texto, max ${MAX_TITLE} caracteres)` };

    const message = asText(data.message, MAX_MESSAGE);
    if (!message) return { error: `message requerido (texto, max ${MAX_MESSAGE} caracteres)` };

    const type = data.type === undefined ? defaultType : data.type;
    if (!TYPES.includes(type)) return { error: `type invalido (${TYPES.join(', ')})` };

    const module = data.module === undefined ? 'general' : data.module;
    if (!MODULES.includes(module)) return { error: `module invalido (${MODULES.join(', ')})` };

    const metadata = asMetadata(data.metadata);
    if (metadata === null) {
        return { error: `metadata invalida (objeto, max ${MAX_METADATA_BYTES} bytes, route debe iniciar con "/")` };
    }

    let senderId = null;
    if (data.senderId !== undefined && data.senderId !== null) {
        senderId = asId(data.senderId);
        if (!senderId) return { error: 'senderId invalido' };
    }

    return { value: { title, message, type, module, metadata, senderId } };
};

module.exports = { asId, asIdList, parseNotificationBody, MAX_BULK_RECIPIENTS, MAX_BROADCAST_TENANTS };
