import { Injectable, NotFoundException } from "@nestjs/common";
import type { PlantRecord } from "@vibe/shared";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { SqliteService } from "../database/sqlite.service";
import { CreatePlantDto } from "./dto/create-plant.dto";
import { UpdatePlantDto } from "./dto/update-plant.dto";

@Injectable()
export class PlantsService {
  constructor(private readonly sqlite: SqliteService) {}

  list(): PlantRecord[] {
    const stmt = this.sqlite.database.prepare("SELECT * FROM plants ORDER BY created_at DESC");
    return stmt.all().map((row) => this.mapRow(row as Record<string, unknown>));
  }

  getById(id: string): PlantRecord {
    const stmt = this.sqlite.database.prepare("SELECT * FROM plants WHERE id = ?");
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    const plant = row ? this.mapRow(row) : null;
    if (!plant) {
      throw new NotFoundException(`Plant ${id} was not found`);
    }

    return plant;
  }

  create(input: CreatePlantDto): PlantRecord {
    const now = new Date().toISOString();
    const next: PlantRecord = {
      id: randomUUID(),
      nickname: input.nickname,
      species: input.species,
      zone: input.zone,
      growthStage: input.growthStage,
      notes: input.notes,
      imageUrl: input.imageUrl,
      healthState: input.healthState,
      schedule: input.schedule,
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.sqlite.database.prepare(`
      INSERT INTO plants (
        id, nickname, species, zone, growth_stage, notes, image_url,
        health_state, watering_every_days, fertilizing_every_days,
        pruning_every_days, last_watered_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      next.id,
      next.nickname,
      next.species,
      next.zone,
      next.growthStage,
      next.notes ?? null,
      next.imageUrl ?? null,
      next.healthState,
      next.schedule.wateringEveryDays,
      next.schedule.fertilizingEveryDays ?? null,
      next.schedule.pruningEveryDays ?? null,
      next.lastWateredAt ?? null,
      next.createdAt,
      next.updatedAt,
    );

    return next;
  }

  update(id: string, input: UpdatePlantDto): PlantRecord {
    const existing = this.getById(id);

    const updated: PlantRecord = {
      ...existing,
      ...input,
      schedule: {
        ...existing.schedule,
        ...(input.schedule ?? {}),
      },
      lastWateredAt: input.lastWateredAt ?? existing.lastWateredAt,
      updatedAt: new Date().toISOString(),
    };

    const stmt = this.sqlite.database.prepare(`
      UPDATE plants SET
        nickname = ?,
        species = ?,
        zone = ?,
        growth_stage = ?,
        notes = ?,
        image_url = ?,
        health_state = ?,
        watering_every_days = ?,
        fertilizing_every_days = ?,
        pruning_every_days = ?,
        last_watered_at = ?,
        updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      updated.nickname,
      updated.species,
      updated.zone,
      updated.growthStage,
      updated.notes ?? null,
      updated.imageUrl ?? null,
      updated.healthState,
      updated.schedule.wateringEveryDays,
      updated.schedule.fertilizingEveryDays ?? null,
      updated.schedule.pruningEveryDays ?? null,
      updated.lastWateredAt ?? null,
      updated.updatedAt,
      id,
    );

    return updated;
  }

  markWatered(id: string): PlantRecord {
    return this.update(id, { lastWateredAt: new Date().toISOString() });
  }

  remove(id: string): void {
    const existing = this.getById(id);
    const stmt = this.sqlite.database.prepare("DELETE FROM plants WHERE id = ?");
    stmt.run(id);

    const uploadFilename = this.extractUploadFilename(existing.imageUrl);
    if (uploadFilename) {
      const uploadPath = join(process.cwd(), "data", "uploads", uploadFilename);
      rmSync(uploadPath, { force: true });
    }
  }

  private extractUploadFilename(imageUrl: string | undefined): string | null {
    if (!imageUrl || !imageUrl.startsWith("/uploads/")) {
      return null;
    }

    const filename = imageUrl.slice("/uploads/".length);
    if (filename.length === 0 || filename.includes("/") || filename.includes("\\")) {
      return null;
    }

    return filename;
  }

  private mapRow(row: Record<string, unknown>): PlantRecord {
    return {
      id: String(row.id),
      nickname: String(row.nickname),
      species: String(row.species),
      zone: String(row.zone),
      growthStage: row.growth_stage as PlantRecord["growthStage"],
      notes: row.notes ? String(row.notes) : undefined,
      imageUrl: row.image_url ? String(row.image_url) : undefined,
      healthState: row.health_state as PlantRecord["healthState"],
      schedule: {
        wateringEveryDays: Number(row.watering_every_days),
        fertilizingEveryDays: row.fertilizing_every_days
          ? Number(row.fertilizing_every_days)
          : undefined,
        pruningEveryDays: row.pruning_every_days
          ? Number(row.pruning_every_days)
          : undefined,
      },
      lastWateredAt: row.last_watered_at ? String(row.last_watered_at) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
