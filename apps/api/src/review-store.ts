import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ReviewVerdict = "approved" | "needs_revision" | "unsafe";
export type GoldenCaseReview = {
  caseId: string;
  verdict: ReviewVerdict;
  notes: string;
  confidence: number;
  reviewerId: string;
  reviewedAt: string;
};

export type ReviewStore = {
  list(organizationId: string): Promise<GoldenCaseReview[]>;
  save(
    organizationId: string,
    review: Omit<GoldenCaseReview, "reviewedAt">
  ): Promise<GoldenCaseReview>;
};

export class MemoryReviewStore implements ReviewStore {
  private readonly reviews = new Map<string, GoldenCaseReview>();

  async list(organizationId: string) {
    return [...this.reviews.entries()]
      .filter(([key]) => key.startsWith(`${organizationId}:`))
      .map(([, review]) => review);
  }

  async save(
    organizationId: string,
    input: Omit<GoldenCaseReview, "reviewedAt">
  ) {
    const review = { ...input, reviewedAt: new Date().toISOString() };
    this.reviews.set(`${organizationId}:${input.caseId}`, review);
    return review;
  }
}

export class SupabaseReviewStore implements ReviewStore {
  constructor(private readonly client: SupabaseClient) {}

  static fromEnvironment(): SupabaseReviewStore | null {
    const url = process.env.SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secret) return null;
    return new SupabaseReviewStore(
      createClient(url, secret, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
    );
  }

  async list(organizationId: string) {
    const result = await this.client
      .from("golden_case_reviews")
      .select("case_id,verdict,notes,confidence,reviewer_id,reviewed_at")
      .eq("organization_id", organizationId);
    if (result.error) throw result.error;
    return result.data.map(row => ({
      caseId: row.case_id,
      verdict: row.verdict as ReviewVerdict,
      notes: row.notes,
      confidence: row.confidence,
      reviewerId: row.reviewer_id,
      reviewedAt: row.reviewed_at
    }));
  }

  async save(
    organizationId: string,
    input: Omit<GoldenCaseReview, "reviewedAt">
  ) {
    const result = await this.client
      .from("golden_case_reviews")
      .upsert(
        {
          organization_id: organizationId,
          case_id: input.caseId,
          verdict: input.verdict,
          notes: input.notes,
          confidence: input.confidence,
          reviewer_id: input.reviewerId,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        { onConflict: "organization_id,case_id" }
      )
      .select("case_id,verdict,notes,confidence,reviewer_id,reviewed_at")
      .single();
    if (result.error) throw result.error;
    return {
      caseId: result.data.case_id,
      verdict: result.data.verdict as ReviewVerdict,
      notes: result.data.notes,
      confidence: result.data.confidence,
      reviewerId: result.data.reviewer_id,
      reviewedAt: result.data.reviewed_at
    };
  }
}
