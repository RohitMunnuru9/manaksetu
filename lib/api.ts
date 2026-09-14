export type ApiStandard = {
  id: number;
  standard_number: string | null;
  official_title: string;
  scope_summary: string;
  status: "current" | "revised" | "withdrawn" | "uncertain";
  official_source_url: string | null;
  verification_status: "verified" | "pending" | "demo";
};

export type ApiRecommendation = {
  standard: ApiStandard;
  standard_type: string;
  reason_for_recommendation: string;
  matched_requirements: string[];
  confidence_score: number;
  confidence_level: "high" | "medium" | "low";
  certification_required: boolean;
  qco_applicable: boolean;
  qco_title: string | null;
  qco_enforcement_date: string | null;
  qco_source_url: string | null;
  human_review_required: boolean;
  warning: string | null;
};

export type AnalysisResult = {
  tender: {
    id: number;
    reference: string;
    title: string;
    status: string;
    language: string;
    filename: string | null;
    created_at: string;
  };
  recommendations: ApiRecommendation[];
  missing_requirements: string[];
  guardrail_message: string | null;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export async function analyseTender(input: { title: string; description: string; language: string }): Promise<AnalysisResult> {
  const response = await fetch(`${API_URL}/tenders/analyse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.detail ?? "The analysis service could not process this tender.");
  }
  return response.json();
}

export async function analyseFile(file: File): Promise<AnalysisResult> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${API_URL}/tenders/upload/analyse`, { method: "POST", body });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.detail ?? "The document could not be analysed.");
  }
  return response.json();
}

export async function saveReview(tenderId: number, decision: "approved" | "rejected" | "expert_review", note: string): Promise<void> {
  const response = await fetch(`${API_URL}/tenders/${tenderId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, note }),
  });
  if (!response.ok) throw new Error("The review decision could not be saved.");
}

export function reportUrl(tenderId: number, format: "json" | "pdf" | "docx" | "xlsx" = "pdf"): string {
  return `${API_URL}/tenders/${tenderId}/report/${format}`;
}
