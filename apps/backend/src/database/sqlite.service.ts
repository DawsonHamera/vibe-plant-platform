import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getRuntimeConfig } from "../config/runtime-config";
import { MigrationService } from "./migration.service";

@Injectable()
export class SqliteService implements OnModuleDestroy {
  private readonly db: DatabaseSync;

  constructor(migrationService?: MigrationService) {
    const dbFile = getRuntimeConfig().sqliteDbFile;
    mkdirSync(dirname(dbFile), { recursive: true });
    this.db = new DatabaseSync(dbFile);
    this.db.exec("PRAGMA journal_mode = WAL;");
    (migrationService ?? new MigrationService()).applyMigrations(this.db);
  }

  get database(): DatabaseSync {
    return this.db;
  }

  onModuleDestroy(): void {
    this.db.close();
  }
}
