/**
 * Environment configuration — validated at startup.
 * Any missing required variable throws immediately so the server never starts
 * in a misconfigured state.
 */

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

export type Env = {
  // AWS
  AWS_REGION: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;

  // Bedrock model IDs
  BEDROCK_NOVA_SONIC_MODEL_ID: string;
  BEDROCK_NOVA_LITE_MODEL_ID: string;
  BEDROCK_TITAN_EMBED_MODEL_ID: string;

  // libSQL
  LIBSQL_URL: string;
  LIBSQL_AUTH_TOKEN: string | undefined;

  // S3
  S3_BUCKET_NAME: string;
  S3_RECORDINGS_PREFIX: string;

  // LanceDB
  LANCEDB_PATH: string;

  // Server
  PORT: number;
  FRONTEND_URL: string;

  // Dispatch context
  DISPATCH_CITY: string;
  DISPATCH_DEPT: string;
};

function loadEnv(): Env {
  return {
    AWS_REGION: requireEnv("AWS_REGION"),
    AWS_ACCESS_KEY_ID: requireEnv("AWS_ACCESS_KEY_ID"),
    AWS_SECRET_ACCESS_KEY: requireEnv("AWS_SECRET_ACCESS_KEY"),

    BEDROCK_NOVA_SONIC_MODEL_ID: requireEnv("BEDROCK_NOVA_SONIC_MODEL_ID"),
    BEDROCK_NOVA_LITE_MODEL_ID: optionalEnv("BEDROCK_NOVA_LITE_MODEL_ID", "amazon.nova-lite-v1:0"),
    BEDROCK_TITAN_EMBED_MODEL_ID: requireEnv("BEDROCK_TITAN_EMBED_MODEL_ID"),

    LIBSQL_URL: optionalEnv("LIBSQL_URL", "file:./data/rapidresponse.db"),
    LIBSQL_AUTH_TOKEN: process.env["LIBSQL_AUTH_TOKEN"],

    S3_BUCKET_NAME: requireEnv("S3_BUCKET_NAME"),
    S3_RECORDINGS_PREFIX: optionalEnv("S3_RECORDINGS_PREFIX", "recordings/"),

    LANCEDB_PATH: optionalEnv("LANCEDB_PATH", "./data/lancedb"),

    PORT: parseInt(optionalEnv("PORT", "3000"), 10),
    FRONTEND_URL: optionalEnv("FRONTEND_URL", "http://localhost:5173"),

    DISPATCH_CITY: optionalEnv("DISPATCH_CITY", "Springfield"),
    DISPATCH_DEPT: optionalEnv(
      "DISPATCH_DEPT",
      "Springfield Emergency Services"
    ),
  };
}

let _env: Env | null = null;

/**
 * Lazy singleton — env is only validated on first access.
 * This allows test files that import DB helpers (which accept their own client)
 * to run without AWS credentials being present in the environment.
 */
export function getEnv(): Env {
  if (!_env) {
    _env = loadEnv();
  }
  return _env;
}

/**
 * Convenience proxy — accessing any property triggers lazy initialisation.
 * Keeps call sites as `env.PORT` instead of `getEnv().PORT`.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof Env];
  },
});
