import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getRuntimeConfig } from "../config/runtime-config";
import { MigrationService } from "../database/migration.service";

function run(): void {
  const dbFile = getRuntimeConfig().sqliteDbFile;
  mkdirSync(dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec("PRAGMA journal_mode = WAL;");

  const migrationService = new MigrationService();
  migrationService.applyMigrations(db);
  db.close();

  console.log("Migrations applied successfully");
}

run();
