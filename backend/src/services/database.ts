import { DataSource } from "typeorm";
import { getEnv } from "../config/env.js";
import { logger } from "./logger.js";

let AppDataSource: DataSource | null = null;

export async function initDatabase(): Promise<DataSource> {
  if (AppDataSource?.isInitialized) {
    return AppDataSource;
  }

  const env = getEnv();
  const databaseUrl = env.DATABASE_URL;

  AppDataSource = new DataSource({
    type: "postgres",
    url: databaseUrl,
    synchronize: process.env.NODE_ENV !== "production",
    logging: process.env.NODE_ENV === "development",
    entities: ["src/entities/*.ts"],
    migrations: ["src/migrations/*.ts"],
    migrationsTableName: "migrations"
  });

  try {
    await AppDataSource.initialize();
    logger.info("Database connection established");
  } catch (error) {
    logger.error("Failed to initialize database", { error });
    throw error;
  }

  return AppDataSource;
}

export function getDataSource(): DataSource {
  if (!AppDataSource?.isInitialized) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return AppDataSource;
}

export async function closeDatabase(): Promise<void> {
  if (AppDataSource?.isInitialized) {
    await AppDataSource.destroy();
    AppDataSource = null;
    logger.info("Database connection closed");
  }
}