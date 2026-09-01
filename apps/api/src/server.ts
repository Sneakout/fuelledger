import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';

const server = createApp().listen(env.PORT, () => logger.info({ port: env.PORT }, 'FuelLedger API started'));
async function shutdown(signal: string) { logger.info({ signal }, 'Shutting down'); server.close(async () => { await prisma.$disconnect(); process.exit(0); }); }
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
