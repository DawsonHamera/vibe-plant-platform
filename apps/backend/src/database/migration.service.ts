import { Injectable } from "@nestjs/common";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

@Injectable()
export class MigrationService {
  applyMigrations(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const migrationsPath = resolve(process.cwd(), "migrations");
    const files = readdirSync(migrationsPath)
      .filter((file) => file.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    for (const file of files) {
      const existsStmt = db.prepare("SELECT id FROM schema_migrations WHERE id = ?");
      const alreadyApplied = existsStmt.get(file);
      if (alreadyApplied) {
        continue;
      }

      const sql = readFileSync(join(migrationsPath, file), "utf-8");
      db.exec("BEGIN;");
      try {
        db.exec(sql);
        const insertStmt = db.prepare(
          "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
        );
        insertStmt.run(file, new Date().toISOString());
        db.exec("COMMIT;");
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }
    }
  }
}
