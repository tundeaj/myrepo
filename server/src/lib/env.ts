import "dotenv/config";

function required(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env = {
  PORT: Number(process.env.PORT ?? 4000),
  DATABASE_URL: required("DATABASE_URL"),
  JWT_SECRET: required("JWT_SECRET", "dev-only-secret-change-me"),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "7d",
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  NODE_ENV: process.env.NODE_ENV ?? "development",

  // Prompt 10 integrations — read here so their "configured?" boolean can be
  // surfaced to the client without ever leaking the value itself.
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
  IMAGEKIT_PRIVATE_KEY: process.env.IMAGEKIT_PRIVATE_KEY ?? "",
  IMAGEKIT_PUBLIC_KEY: process.env.IMAGEKIT_PUBLIC_KEY ?? "",
  IMAGEKIT_URL_ENDPOINT: process.env.IMAGEKIT_URL_ENDPOINT ?? "",
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY ?? "",
  PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY ?? "",
  VIDEO_PROVIDER_API_KEY: process.env.VIDEO_PROVIDER_API_KEY ?? "",
};
