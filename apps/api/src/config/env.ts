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
  /** Comma-separated additional browser origins. Paths are rejected below. */
  CORS_ADDITIONAL_ORIGINS: z.string().default(""),
  PLATFORM_ADMIN_EMAILS: z.string().default(""),
  GOOGLE_CLIENT_ID: z.string().min(20).optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().min(20).optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(5).optional(),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).optional(),
  WHATSAPP_TEMPLATE_NAME: z.string().regex(/^[a-z0-9_]+$/).optional(),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().min(2).default("en"),
  CRON_SECRET: z.string().min(16).optional(),
  APNS_TEAM_ID: z.string().min(5).optional(),
  APNS_KEY_ID: z.string().min(5).optional(),
  APNS_PRIVATE_KEY: z.string().min(40).optional(),
  APNS_BUNDLE_ID: z.string().min(3).default("tech.mindvector.fuelnerve"),
  APNS_ENVIRONMENT: z.enum(["development", "production"]).default("production"),
  OPENAI_API_KEY: z.string().min(20).optional(),
  OPENAI_BRIEFING_MODEL: z.string().min(2).default("gpt-5.4-mini"),
  INTELLIGENCE_ASK_MONTHLY_LIMIT: z.coerce.number().int().min(1).max(1000).default(25),
  INTELLIGENCE_INVESTIGATION_MONTHLY_LIMIT: z.coerce.number().int().min(1).max(1000).default(50),
  OWNER_ASSISTANT_RELEASE_STAGE: z.enum(["OFF", "LOCAL", "STAGING", "PRODUCTION"]).default("OFF"),
  OWNER_ASSISTANT_ROLLOUT_PERCENT: z.coerce.number().int().min(0).max(100).default(0),
  OWNER_ASSISTANT_ROLLBACK: z.string().default("false").transform(value => value === "true"),
  NERVE_LOCAL_SHADOW_ENABLED: z.string().default("false").transform(value => value === "true"),
  NERVE_LOCAL_KEY_ID: z.string().min(1).optional(),
  NERVE_LOCAL_SHARED_SECRET: z.string().min(32).optional(),
  NERVE_LOCAL_ORGANIZATION_ID: z.string().min(1).optional(),
  NERVE_LOCAL_STATION_ID: z.string().min(1).optional(),
  NERVE_LOCAL_REPORT_PATH: z.string().min(1).optional(),
}).superRefine((value,context)=>{if(value.NODE_ENV==='production'){if(value.JWT_SECRET.length<48)context.addIssue({code:'custom',path:['JWT_SECRET'],message:'Production JWT_SECRET must contain at least 48 characters.'});if(!value.APP_URL.startsWith('https://'))context.addIssue({code:'custom',path:['APP_URL'],message:'Production APP_URL must use HTTPS.'});if(!value.CORS_ORIGIN.startsWith('https://'))context.addIssue({code:'custom',path:['CORS_ORIGIN'],message:'Production CORS_ORIGIN must use HTTPS.'});if(value.NERVE_LOCAL_SHADOW_ENABLED)context.addIssue({code:'custom',path:['NERVE_LOCAL_SHADOW_ENABLED'],message:'The local Nerve shadow bridge cannot run in production.'});}if(value.NERVE_LOCAL_SHADOW_ENABLED&&(!value.NERVE_LOCAL_KEY_ID||!value.NERVE_LOCAL_SHARED_SECRET||!value.NERVE_LOCAL_ORGANIZATION_ID||!value.NERVE_LOCAL_STATION_ID))context.addIssue({code:'custom',path:['NERVE_LOCAL_SHADOW_ENABLED'],message:'Local Nerve shadow mode requires a key, secret, organization, and station.'});});
export const env = envSchema.parse(process.env);
export const trustedOrigins = [env.CORS_ORIGIN, env.APP_URL, ...env.CORS_ADDITIONAL_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean)]
  .map((value) => new URL(value).origin)
  .filter((value, index, all) => all.indexOf(value) === index);
export const whatsappConfigured = Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_API_VERSION && env.WHATSAPP_TEMPLATE_NAME);
export const apnsConfigured = Boolean(env.APNS_TEAM_ID && env.APNS_KEY_ID && env.APNS_PRIVATE_KEY);
export const isPlatformAdminEmail = (email: string) =>
  env.PLATFORM_ADMIN_EMAILS.split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
