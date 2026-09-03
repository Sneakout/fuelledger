import { config } from "dotenv";
import { z } from "zod";
config({ path: "../../.env" });
config();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  CORS_ORIGIN: z.string().url().default("http://localhost:5173"),
  APP_URL: z.string().url().default("http://localhost:5173"),
  PLATFORM_ADMIN_EMAILS: z.string().default(""),
  GOOGLE_CLIENT_ID: z.string().min(20).optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().min(20).optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(5).optional(),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).optional(),
  WHATSAPP_TEMPLATE_NAME: z.string().regex(/^[a-z0-9_]+$/).optional(),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().min(2).default("en"),
  CRON_SECRET: z.string().min(16).optional(),
}).superRefine((value,context)=>{if(value.NODE_ENV==='production'){if(value.JWT_SECRET.length<48)context.addIssue({code:'custom',path:['JWT_SECRET'],message:'Production JWT_SECRET must contain at least 48 characters.'});if(!value.APP_URL.startsWith('https://'))context.addIssue({code:'custom',path:['APP_URL'],message:'Production APP_URL must use HTTPS.'});if(!value.CORS_ORIGIN.startsWith('https://'))context.addIssue({code:'custom',path:['CORS_ORIGIN'],message:'Production CORS_ORIGIN must use HTTPS.'});}});
export const env = envSchema.parse(process.env);
export const whatsappConfigured = Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_API_VERSION && env.WHATSAPP_TEMPLATE_NAME);
export const isPlatformAdminEmail = (email: string) =>
  env.PLATFORM_ADMIN_EMAILS.split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
