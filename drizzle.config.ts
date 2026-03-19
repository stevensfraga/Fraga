import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";
import path from "path";

// Carregar .env.production explicitamente
dotenv.config({ path: path.resolve(process.cwd(), ".env.production") });

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "mysql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
});
