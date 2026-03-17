import { Global, Module } from "@nestjs/common";
import { MigrationService } from "./migration.service";
import { SqliteService } from "./sqlite.service";

@Global()
@Module({
  providers: [MigrationService, SqliteService],
  exports: [SqliteService, MigrationService],
})
export class DatabaseModule {}
