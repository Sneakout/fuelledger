import { config } from 'dotenv';
import { z } from 'zod';
config({ path: '../../.env' });
config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
  GOOGLE_CLIENT_ID: z.string().min(20).optional(),
});
export const env = envSchema.parse(process.env);
