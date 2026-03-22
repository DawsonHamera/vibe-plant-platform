export type PlantHealthState = "excellent" | "good" | "watch" | "critical";

export interface PlantSchedule {
  wateringEveryDays: number;
  fertilizingEveryDays?: number;
  pruningEveryDays?: number;
}

export interface PlantRecord {
  id: string;
  nickname: string;
  species: string;
  zone: string;
  growthStage: "seedling" | "vegetative" | "mature";
  notes?: string;
  imageUrl?: string;
  healthState: PlantHealthState;
  schedule: PlantSchedule;
  lastWateredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DailyCareDecision {
  date: string;
  duePlantIds: string[];
  overduePlantIds: string[];
  alerts: string[];
}

export interface TelemetryPoint {
  plantId: string;
  moisture?: number;
  light?: number;
  temperature?: number;
  humidity?: number;
  reservoirLevel?: number;
  capturedAt: string;
  sourceProfileId?: string;
  sourceProfileName?: string;
}

export function calculatePlantRisk(moisture: number, temperature: number): number {
  const moisturePenalty = moisture < 30 ? 35 : moisture > 80 ? 20 : 5;
  const temperaturePenalty = temperature < 16 || temperature > 32 ? 30 : 8;
  return Math.min(100, moisturePenalty + temperaturePenalty);
}
