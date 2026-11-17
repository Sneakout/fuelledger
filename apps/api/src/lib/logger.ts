import pino from 'pino';
import { env } from '../config/env.js';
export const logger = pino({ level: env.NODE_ENV === 'production' ? 'info' : 'debug', redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-hub-signature-256"]', 'req.query["hub.verify_token"]', 'password', 'passwordHash'] });
