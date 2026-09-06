import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from './errors.js';

const context = new AsyncLocalStorage<{ key: string; fingerprint: string; actor: string }>();
export const safeSaveContext: RequestHandler = (req, _res, next) => {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
  const key = req.get('Idempotency-Key');
  if (!key) return next(new AppError(400, 'SAVE_KEY_REQUIRED', 'Refresh the application before saving.'));
  if (!/^[a-zA-Z0-9-]{16,100}$/.test(key)) return next(new AppError(400, 'SAVE_KEY_INVALID', 'Invalid save identifier. Refresh before saving.'));
  const actor = `${req.user!.organization.id}:${req.user!.id}`;
  const fingerprint = createHash('sha256').update(JSON.stringify([req.method, req.originalUrl, req.body])).digest('hex');
  context.run({ key, fingerprint, actor }, next);
};

/** The retry receipt commits or rolls back with the business records. */
export async function safeTransaction<T>(db: PrismaClient, work: (tx: Prisma.TransactionClient) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) : Promise<T> {
  const save = context.getStore();
  if (!save) return db.$transaction(work, options);
  const where = { actor_key: { actor: save.actor, key: save.key } };
  const replay = (record: { fingerprint: string; result: Prisma.JsonValue }) => {
    if (record.fingerprint !== save.fingerprint) throw new AppError(409, 'SAVE_KEY_REUSED', 'This save identifier belongs to different details. Reopen the form before saving.');
    return record.result as T;
  };
  const previous = await db.saveReceipt.findUnique({ where });
  if (previous) return replay(previous);
  try {
    return await db.$transaction(async tx => {
      await tx.saveReceipt.create({ data: { ...save, result: Prisma.JsonNull } });
      const result = await work(tx);
      const json = JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;
      await tx.saveReceipt.update({ where, data: { result: json } });
      return result;
    }, { ...options, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
      const committed = await db.saveReceipt.findUnique({ where });
      if (committed) return replay(committed);
      throw new AppError(409, 'SAVE_RETRY_REQUIRED', 'Another save was in progress. Retry the same submission.');
    }
    throw error;
  }
}
