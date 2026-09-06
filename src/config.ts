import "dotenv/config";
import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional(),
);

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),
  PUBLIC_URL: optionalUrl,
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  ADMIN_EMAILS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  GEMINI_API_KEY: z.string().min(1).optional(),
  PAYPAL_CLIENT_ID: z.string().min(1).optional(),
  PAYPAL_CLIENT_SECRET: z.string().min(1).optional(),
  PAYPAL_ENVIRONMENT: z.enum(["sandbox", "live"]).default("sandbox"),
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_PHONE_NUMBER: z.string().min(1).optional(),
  PUBLIC_WS_URL: optionalUrl.transform((value) => value?.replace(/^http/, "ws")),
  VOICE_PROVIDER_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_SPEECH_ENGINE_ID: z.string().min(1).optional(),
  ELEVENLABS_SHARED_SECRET: z.string().min(1).optional(),
});
export const config = schema.parse(process.env);
