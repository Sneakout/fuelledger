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
  GOOGLE_CLIENT_ID: z.string().min(20).optional(),
}).superRefine((value,context)=>{if(value.NODE_ENV==='production'){if(value.JWT_SECRET.length<48)context.addIssue({code:'custom',path:['JWT_SECRET'],message:'Production JWT_SECRET must contain at least 48 characters.'});if(!value.APP_URL.startsWith('https://'))context.addIssue({code:'custom',path:['APP_URL'],message:'Production APP_URL must use HTTPS.'});if(!value.CORS_ORIGIN.startsWith('https://'))context.addIssue({code:'custom',path:['CORS_ORIGIN'],message:'Production CORS_ORIGIN must use HTTPS.'});}});
export const env = envSchema.parse(process.env);
