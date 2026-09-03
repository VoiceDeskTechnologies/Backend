import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(4000), FRONTEND_ORIGIN: z.string().default("http://localhost:3000"), PUBLIC_URL: z.string().url().optional(),
  SUPABASE_URL: z.string().url().optional(), SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(), ADMIN_EMAILS: z.string().default("").transform((value) => value.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean)), GEMINI_API_KEY: z.string().min(1).optional(),
  PAYPAL_CLIENT_ID: z.string().min(1).optional(), PAYPAL_CLIENT_SECRET: z.string().min(1).optional(), PAYPAL_ENVIRONMENT: z.enum(["sandbox", "live"]).default("sandbox"),
  TELNYX_API_KEY: z.string().min(1).optional(), TELNYX_CONNECTION_ID: z.string().min(1).optional(), TELNYX_PHONE_NUMBER: z.string().min(1).optional(), TELNYX_PUBLIC_KEY: z.string().min(1).optional(), VOICE_PROVIDER_API_KEY: z.string().min(1).optional()
});
export const config = schema.parse(process.env);
