import "dotenv/config";
import { z } from "zod";
export const env = z
  .object({
    DATABASE_URL: z.string().startsWith("postgresql://"),
    JWT_SECRET: z.string().min(32),
    APP_ORIGIN: z.string().url(),
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    UPLOAD_DIR: z.string().default("./uploads"),
  })
  .parse(process.env);
