import { z } from "zod";
import { loadEnvConfig } from "@next/env";

let envLoaded = false;

function ensureEnvLoaded() {
  if (envLoaded) return;
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  envLoaded = true;
}

const configSchema = z.object({
  SERPAPI_API_KEY: z.string().trim().optional().default(""),
  OPENAI_API_KEY: z.string().trim().optional().default(""),
  GROQ_API_KEY: z.string().trim().optional().default(""),
  LLM_MODEL: z.string().trim().min(1).default("openai/gpt-oss-120b"),
  DATABASE_PATH: z.string().trim().optional().default("./data/consensus.db"),
  SERPAPI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  SOURCE_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  SERPAPI_MAX_ATTEMPTS: z.coerce.number().int().positive().default(24),
  SERPAPI_DEV_MAX_SEARCHES: z.coerce.number().int().positive().default(200),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
});

export function getConfig() {
  ensureEnvLoaded();
  return configSchema.parse({
    SERPAPI_API_KEY: process.env.SERPAPI_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL?.trim() || "openai/gpt-oss-120b",
    DATABASE_PATH: process.env.DATABASE_PATH,
  SERPAPI_TIMEOUT_MS: process.env.SERPAPI_TIMEOUT_MS,
    MODEL_TIMEOUT_MS: process.env.MODEL_TIMEOUT_MS,
    SOURCE_TIMEOUT_MS: process.env.SOURCE_TIMEOUT_MS,
    SERPAPI_MAX_ATTEMPTS: process.env.SERPAPI_MAX_ATTEMPTS,
    SERPAPI_DEV_MAX_SEARCHES: process.env.SERPAPI_DEV_MAX_SEARCHES,
    APP_ORIGIN: process.env.APP_ORIGIN,
  });
}

export function liveSearchReady() {
  return getConfig().SERPAPI_API_KEY.length > 0;
}

export function liveModelReady() {
  const config = getConfig();
  return config.GROQ_API_KEY.length > 0 && config.LLM_MODEL === "openai/gpt-oss-120b";
}
