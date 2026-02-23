import { GenerationStatus } from '@prisma/client';

export interface CachedScenario {
  id: string;
  name: string;
  theater: string;
  adversary: string;
  description: string;
  startDate: Date;
  endDate: Date;
  classification: string;
  compressionRatio: number;
  generationStatus: GenerationStatus;
  generationStep: string | null;
  generationProgress: number;
  generationError: string | null;
  createdAt: Date;
  updatedAt: Date;

  // Relations mapped out
  strategies: any[];
  planningDocs: any[];
  taskingOrders: any[];
  units: any[];
  spaceAssets: any[];
  scenarioInjects: any[];
}

class ScenarioCache {
  private scenarios = new Map<string, CachedScenario>();

  public set(id: string, scenario: CachedScenario): void {
    this.scenarios.set(id, scenario);
  }

  public get(id: string): CachedScenario | undefined {
    return this.scenarios.get(id);
  }

  public getAll(): CachedScenario[] {
    return Array.from(this.scenarios.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  public delete(id: string): boolean {
    return this.scenarios.delete(id);
  }

  public has(id: string): boolean {
    return this.scenarios.has(id);
  }

  public update(id: string, partial: Partial<CachedScenario>): CachedScenario | undefined {
    const existing = this.scenarios.get(id);
    if (!existing) return undefined;

    const updated = { ...existing, ...partial, updatedAt: new Date() };
    this.scenarios.set(id, updated);
    return updated;
  }
}

export const scenarioCache = new ScenarioCache();
