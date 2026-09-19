export type ApiStandard = {
  id: number;
  standard_number: string | null;
  catalogue_ref: string | null;
  official_title: string;
  scope_summary: string;
  publication_year: number | null;
  status: "current" | "revised" | "withdrawn" | "uncertain";
  official_source_url: string | null;
  last_checked_date: string | null;
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
  relation_note: string | null;
  score_breakdown: Record<string, number>;
  is_outdated: boolean;
  superseded_by: string | null;
  amendments: Array<{ amendment_number: string; issued_date: string | null; summary: string; official_source_url: string | null }>;
  currency_warning: string | null;
  evidence_spans: Array<{ text: string; start: number; end: number; terms: string[] }>;
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
    source_text: string;
  };
  recommendations: ApiRecommendation[];
  extracted_requirements: Array<{
    requirement_type: string;
    value: string;
    confidence: number;
    source_excerpt: string;
    needs_confirmation: boolean;
  }>;
  missing_requirements: string[];
  outdated_citations: Array<{ cited_standard: string; status: string; superseded_by: string | null; amendment_count: number; message: string | null }>;
  guardrail_message: string | null;
  nearest_records: Array<{ standard: ApiStandard; similarity: number }>;
  retrieval_mode: "hybrid" | "lexical";
  embedding_model: string | null;
  officer_glance: Array<{ label: string; value: string; tone: string }>;
  scorecard: { score: number; grade: string; rows: Array<{ key: string; label: string; weight: number; satisfied: boolean; evidence: string | null; fix: string | null }>; fixes: string[] } | null;
  officer_summary: string | null;
  officer_summary_status: string;
  officer_summary_model: string | null;
};

export type TenderSummary = AnalysisResult["tender"];
export type AuditEntry = { id: number; action: string; entity_type: string; entity_id: string; details: Record<string, unknown>; created_at: string };
export type DashboardStats = { total_tenders: number; pending_reviews: number; verified_standards: number; total_standards: number; completed_reviews: number };
export type UserProfile = { id: number; email: string; full_name: string; role: string; permissions: string[] };

/** Capability names mirroring the server's Permission class. */
export const PERMISSIONS = {
  tenderRead: "tender:read",
  tenderCreate: "tender:create",
  reviewSubmit: "review:submit",
  reportExport: "report:export",
  auditRead: "audit:read",
  standardVerify: "standard:verify",
} as const;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
const TOKEN_KEY = "manaksetu_access_token";

const getToken = () => typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);
const authHeaders = (): Record<string, string> => getToken() ? { Authorization: `Bearer ${getToken()}` } : {};

async function apiError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null);
  return new Error(body?.detail ?? fallback);
}

export async function login(email: string, password: string): Promise<UserProfile> {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw await apiError(response, "Sign in failed");
  const body = await response.json();
  window.localStorage.setItem(TOKEN_KEY, body.access_token);
  return getCurrentUser();
}

export function logout(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export async function getCurrentUser(): Promise<UserProfile> {
  const response = await fetch(`${API_URL}/auth/me`, { headers: authHeaders() });
  if (!response.ok) {
    logout();
    throw await apiError(response, "Your session has expired");
  }
  return response.json();
}

export async function analyseTender(input: { title: string; description: string; language: string }): Promise<AnalysisResult> {
  const response = await fetch(`${API_URL}/tenders/analyse`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await apiError(response, "The analysis service could not process this tender.");
  }
  return response.json();
}

export async function analyseFile(file: File): Promise<AnalysisResult> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${API_URL}/tenders/upload/analyse`, { method: "POST", headers: authHeaders(), body });
  if (!response.ok) {
    throw await apiError(response, "The document could not be analysed.");
  }
  return response.json();
}

export async function saveReview(tenderId: number, decision: "approved" | "rejected" | "expert_review", note: string): Promise<void> {
  const response = await fetch(`${API_URL}/tenders/${tenderId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ decision, note }),
  });
  if (!response.ok) throw new Error("The review decision could not be saved.");
}

export async function downloadReport(tenderId: number, format: "json" | "pdf" | "docx" | "xlsx" = "pdf"): Promise<void> {
  const response = await fetch(`${API_URL}/tenders/${tenderId}/report/${format}`, { headers: authHeaders() });
  if (!response.ok) throw await apiError(response, "The report could not be generated");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${response.headers.get("Content-Disposition")?.match(/filename="?([^";]+)"?/)?.[1] ?? `ManakSetu-report.${format}`}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { headers: authHeaders() });
  if (!response.ok) throw new Error("The requested data could not be loaded.");
  return response.json();
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await apiError(response, "The request could not be completed.");
  return response.json();
}

export const getLatestAnalysis = async (): Promise<AnalysisResult | null> => {
  const tenders = await getJson<TenderSummary[]>("/tenders");
  return tenders.length ? getJson<AnalysisResult>(`/tenders/${tenders[0].id}`) : null;
};

export type Briefing = Pick<AnalysisResult, "officer_summary" | "officer_summary_status" | "officer_summary_model">;

/** Requested only after results are on screen; local generation takes tens of seconds. */
export const getBriefing = (tenderId: number) => getJson<Briefing>(`/tenders/${tenderId}/briefing`);

export type NetworkNode = { id: string; label: string; identifier: string | null; kind: string; tier: "verified" | "checking" | "example"; is_centre: boolean };
export type NetworkEdge = { source: string; target: string; label: string; dashed: boolean };
export type StandardNetwork = {
  centre_id: string; nodes: NetworkNode[]; edges: NetworkEdge[];
  linked_standards: number; official_source_verified: boolean; current_version_confirmed: boolean;
};

/** Everything connected to one standard, drawn from the same edges retrieval uses. */
export const getNetwork = (standardId: number) => getJson<StandardNetwork>(`/standards/${standardId}/network`);

export type ApiCategory = { name: string; description: string; record_count: number; verified_count: number };

/** What the catalogue covers. Shown when a search finds nothing. */
export const getCategories = () => getJson<ApiCategory[]>("/categories");

export const getStandards = (query = "") => getJson<ApiStandard[]>(`/standards${query ? `?q=${encodeURIComponent(query)}` : ""}`);
export const getAuditHistory = () => getJson<AuditEntry[]>("/audit");
export const getDashboardStats = () => getJson<DashboardStats>("/dashboard");

// ---- Clause-level traceability ----------------------------------------------
export type EvidenceSpan = { text: string; start: number; end: number; terms: string[] };

// ---- Specification scorecard ------------------------------------------------
export type ScoreRow = { key: string; label: string; weight: number; satisfied: boolean; evidence: string | null; fix: string | null };
export type Scorecard = { score: number; grade: string; rows: ScoreRow[]; fixes: string[] };

// ---- Clause drafting --------------------------------------------------------
export type DraftClauses = { clauses: string; source: string; identifiers_used: string[]; note: string };
export const getDraft = (tenderId: number) =>
  postJson<DraftClauses>(`/tenders/${tenderId}/draft`, {});

// ---- Analytics + currency watch ---------------------------------------------
export type TopStandard = { identifier: string; title: string; count: number };
export type SectorCount = { name: string; count: number };
export type WatchItem = { standard_id: number; identifier: string; title: string; issue: string; detail: string };
export type Analytics = {
  total_tenders: number;
  total_standards: number;
  verified_standards: number;
  pending_standards: number;
  demo_records: number;
  tenders_by_language: Record<string, number>;
  top_standards: TopStandard[];
  top_sectors: SectorCount[];
  watch: WatchItem[];
  expiring_within_180_days: number;
};
export const getAnalytics = () => getJson<Analytics>("/analytics/overview");
