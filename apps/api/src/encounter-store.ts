import type { Encounter } from "@vaanaya/contracts";

export interface EncounterStore {
  get(id: string): Promise<Encounter | null>;
  save(encounter: Encounter): Promise<Encounter>;
}

export class MemoryEncounterStore implements EncounterStore {
  readonly #encounters = new Map<string, Encounter>();

  constructor(initial: Encounter[]) {
    for (const encounter of initial) this.#encounters.set(encounter.id, encounter);
  }

  async get(id: string): Promise<Encounter | null> {
    return this.#encounters.get(id) ?? null;
  }

  async save(encounter: Encounter): Promise<Encounter> {
    this.#encounters.set(encounter.id, encounter);
    return encounter;
  }
}

