import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type TimingObservation = {
  scenarioId: string;
  paperSeconds: number;
  vaanayaSeconds: number;
  paperCorrections: number;
  vaanayaCorrections: number;
  notes: string;
  observedBy: string;
  observedAt: string;
};

export type TimingStore = {
  list(organizationId: string): Promise<TimingObservation[]>;
  save(
    organizationId: string,
    observation: Omit<TimingObservation, "observedAt">
  ): Promise<TimingObservation>;
};

export function summarizeTiming(observations: TimingObservation[]) {
  if (!observations.length) return null;
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]!
      : (sorted[middle - 1]! + sorted[middle]!) / 2;
  };
  const paper = median(observations.map(item => item.paperSeconds));
  const vaanaya = median(observations.map(item => item.vaanayaSeconds));
  return {
    pairedObservations: observations.length,
    medianPaperSeconds: paper,
    medianVaanayaSeconds: vaanaya,
    medianReductionPercent: Math.round(((paper - vaanaya) / paper) * 100)
  };
}

export class MemoryTimingStore implements TimingStore {
  private readonly observations = new Map<string, TimingObservation>();
  async list(organizationId: string) {
    return [...this.observations.entries()]
      .filter(([key]) => key.startsWith(`${organizationId}:`))
      .map(([, value]) => value);
  }
  async save(
    organizationId: string,
    input: Omit<TimingObservation, "observedAt">
  ) {
    const observation = { ...input, observedAt: new Date().toISOString() };
    this.observations.set(`${organizationId}:${input.scenarioId}`, observation);
    return observation;
  }
}

export class SupabaseTimingStore implements TimingStore {
  constructor(private readonly client: SupabaseClient) {}
  static fromEnvironment() {
    const url = process.env.SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secret) return null;
    return new SupabaseTimingStore(
      createClient(url, secret, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
    );
  }
  async list(organizationId: string) {
    const result = await this.client
      .from("timing_observations")
      .select("*")
      .eq("organization_id", organizationId)
      .order("scenario_id");
    if (result.error) throw result.error;
    return result.data.map(fromRow);
  }
  async save(
    organizationId: string,
    input: Omit<TimingObservation, "observedAt">
  ) {
    const now = new Date().toISOString();
    const result = await this.client
      .from("timing_observations")
      .upsert(
        {
          organization_id: organizationId,
          scenario_id: input.scenarioId,
          paper_seconds: input.paperSeconds,
          vaanaya_seconds: input.vaanayaSeconds,
          paper_corrections: input.paperCorrections,
          vaanaya_corrections: input.vaanayaCorrections,
          notes: input.notes,
          observed_by: input.observedBy,
          observed_at: now,
          updated_at: now
        },
        { onConflict: "organization_id,scenario_id" }
      )
      .select("*")
      .single();
    if (result.error) throw result.error;
    return fromRow(result.data);
  }
}

function fromRow(row: Record<string, any>): TimingObservation {
  return {
    scenarioId: row.scenario_id,
    paperSeconds: row.paper_seconds,
    vaanayaSeconds: row.vaanaya_seconds,
    paperCorrections: row.paper_corrections,
    vaanayaCorrections: row.vaanaya_corrections,
    notes: row.notes,
    observedBy: row.observed_by,
    observedAt: row.observed_at
  };
}
