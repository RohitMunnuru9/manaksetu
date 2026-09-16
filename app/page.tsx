"use client";

import {
  ArrowRight,
  Bell,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  FileCheck2,
  FileSearch,
  FileText,
  Fingerprint,
  Flag,
  Globe2,
  History,
  LayoutDashboard,
  Link2,
  LockKeyhole,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UploadCloud,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { PERMISSIONS, analyseFile, analyseTender, downloadReport, getAuditHistory, getBriefing, getCurrentUser, getDashboardStats, getLatestAnalysis, getStandards, login as loginUser, logout, saveReview, type AnalysisResult, type ApiRecommendation, type ApiStandard, type AuditEntry, type DashboardStats, type UserProfile } from "@/lib/api";

type NavItemProps = {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  badge?: string;
  onClick?: () => void;
};

type Overlay = "standards" | "audit" | "reports" | "overview" | "team" | "settings" | "notifications" | "search" | "profile" | "about" | null;

const buildStages = (analysis: AnalysisResult | null) => {
  if (!analysis) {
    return [
      { name: "Document read", detail: "Awaiting a submission", status: "pending" },
      { name: "Requirements extracted", detail: "Awaiting a submission", status: "pending" },
      { name: "Verified records searched", detail: "Awaiting a submission", status: "pending" },
      { name: "Expert review", detail: "Awaiting a submission", status: "pending" },
    ];
  }
  const requirementCount = analysis.extracted_requirements.length;
  const candidateCount = analysis.recommendations.length;
  return [
    {
      name: "Document read",
      detail: `${analysis.tender.filename ? "Uploaded file" : "Text submission"} · language ${analysis.tender.language.toUpperCase()}`,
      status: "done",
    },
    {
      name: "Requirements extracted",
      detail: requirementCount ? `${requirementCount} structured attribute${requirementCount === 1 ? "" : "s"}` : "No attributes matched",
      status: requirementCount ? "done" : "current",
    },
    {
      name: "Verified records searched",
      detail: candidateCount ? `${candidateCount} candidate${candidateCount === 1 ? "" : "s"} from the controlled catalogue` : "No candidate matched",
      status: candidateCount ? "done" : "current",
    },
    { name: "Expert review", detail: "Awaiting your decision", status: "current" },
  ];
};

/** How a record identifies itself, which depends entirely on whether it is verified. */
function StandardIdentity({ standard, size = "regular" }: { standard: ApiStandard; size?: "regular" | "compact" }) {
  const verified = standard.verification_status === "verified" && Boolean(standard.standard_number);
  if (verified) {
    return (
      <div>
        <div className="std-id verified">
          <code>{standard.standard_number}</code>
          <span className="id-tag"><ShieldCheck size={9} className="mr-0.5 inline" />Verified BIS record</span>
        </div>
        {size === "regular" && <p className="id-note">Published Indian Standard. Official source and check date recorded below.</p>}
      </div>
    );
  }
  return (
    <div>
      <div className="std-id unverified">
        <code>{standard.catalogue_ref ?? "UNREFERENCED"}</code>
        <span className="id-tag">Not an Indian Standard</span>
      </div>
      <p className={`id-note unverified${size === "compact" ? " text-[10px]" : ""}`}>
        Internal catalogue reference. This record has <strong>no IS number</strong> because none has been verified against an official BIS source yet — so none is shown. Do not cite it in a tender.
      </p>
    </div>
  );
}

/** Explains the two-tier record system once, so the badges need no explaining. */
function EvidenceLegend({ verifiedCount, totalCount }: { verifiedCount: number; totalCount: number }) {
  return (
    <div className="evidence-legend">
      <h4>How to read these results</h4>
      <ul>
        <li>
          <span className="legend-swatch verified">Verified BIS record</span>
          <span>Metadata confirmed against an official BIS source. Shows a real <strong>IS number</strong>, a source link and the date it was last checked. Safe to cite once you have reviewed it.</span>
        </li>
        <li>
          <span className="legend-swatch unverified">Not an Indian Standard</span>
          <span>A demonstration record used to exercise retrieval. It deliberately carries <strong>no IS number</strong> — the system never invents one — only an internal reference such as <code>MS-PPE-MARKING</code>. Never cite these.</span>
        </li>
      </ul>
      <p className="text-[10.5px] leading-[1.55] text-[#68766f]">
        This catalogue currently holds <strong className="text-[#2a4338]">{verifiedCount} verified {verifiedCount === 1 ? "record" : "records"}</strong> out of {totalCount}. Importing official BIS metadata for the remaining categories is a data task, not a code change.
      </p>
    </div>
  );
}

/** Prose from the local model, plus an honest account of when it was thrown away. */
function OfficerBriefing({ analysis }: { analysis: AnalysisResult }) {
  const { officer_summary: summary, officer_summary_status: status, officer_summary_model: model } = analysis;

  if (summary) {
    return (
      <div className="llm-brief">
        <div className="llm-brief-head">
          <Sparkles size={13} className="text-pine" />
          <strong>Officer briefing</strong>
          {model && <span className="llm-model">{model}</span>}
        </div>
        <p>{summary}</p>
        <footer>
          Written by a local language model from the evidence above. It cannot add, remove or reorder a recommendation, and any explanation
          referencing a standard that was not retrieved is discarded before it reaches this screen. Treat the records above as authoritative.
        </footer>
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div className="llm-brief">
        <div className="llm-brief-head">
          <LoaderCircle size={13} className="animate-spin text-pine" />
          <strong>Officer briefing</strong>
        </div>
        <p className="text-[#8a978f]">
          A local language model is writing a plain-English summary of the evidence above. The recommendations are already final and do not depend on it.
        </p>
      </div>
    );
  }

  if (status === "rejected_invented_identifier" || status === "rejected_unsupported_claim") {
    return (
      <div className="llm-rejected">
        <strong><TriangleAlert size={12} className="mr-1 inline" />A model explanation was discarded</strong>
        <p>
          {status === "rejected_invented_identifier"
            ? "The local model referenced a standard number that was not among the retrieved records, so the whole explanation was rejected rather than shown to you."
            : "The local model asserted a certification requirement that the deterministic rule engine did not confirm, so the explanation was rejected."}
          {" "}The evidence above is unaffected — it never passes through the model.
        </p>
      </div>
    );
  }

  return null;
}

/** Currency of a single record: superseded, or carrying amendments. */
function CurrencyNotice({ item }: { item: ApiRecommendation }) {
  if (!item.currency_warning) return null;
  return (
    <div className={`currency-warn${item.is_outdated ? " severe" : ""}`}>
      <TriangleAlert size={13} className="mt-0.5 shrink-0" />
      <div>
        <strong>{item.is_outdated ? "Outdated record" : "Amended since publication"}</strong> — {item.currency_warning}
        {item.amendments.length > 0 && (
          <ul className="amendment-list">
            {item.amendments.map(a => (
              <li key={a.amendment_number}>
                <strong>{a.amendment_number}</strong>{a.issued_date ? ` (${a.issued_date})` : ""}{a.summary ? ` — ${a.summary}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Standards the tender text itself cites that the catalogue knows are outdated. */
function OutdatedCitations({ citations }: { citations: AnalysisResult["outdated_citations"] }) {
  if (!citations.length) return null;
  return (
    <div className="citation-alert">
      <h4><TriangleAlert size={12} className="mr-1 inline" />This tender cites an outdated standard</h4>
      {citations.map(c => (
        <p key={c.cited_standard}>
          <code>{c.cited_standard}</code> — {c.message ?? `status: ${c.status}`}
        </p>
      ))}
      <p className="text-[10.5px] opacity-80">Detected by comparing the numbers written in the tender against the catalogue. Confirm against the official BIS record before amending the clause.</p>
    </div>
  );
}

function NavItem({ icon: Icon, label, active, badge, onClick }: NavItemProps) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>
      <Icon size={18} strokeWidth={active ? 2.3 : 1.8} />
      <span>{label}</span>
      {badge && <span className="nav-badge">{badge}</span>}
    </button>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="logo-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div>
        <div className="text-[17px] font-bold tracking-[-0.03em] text-white">ManakSetu <span className="text-saffron">AI</span></div>
        <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-white/45">Standards intelligence</div>
      </div>
    </div>
  );
}

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tab, setTab] = useState("recommendations");
  const [toast, setToast] = useState("");
  const [approved, setApproved] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [inputMode, setInputMode] = useState<"text" | "file">("text");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [standards, setStandards] = useState<ApiStandard[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingOverlay, setLoadingOverlay] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | "verified" | "demo">("all");
  const [detailsOpen, setDetailsOpen] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [credentials, setCredentials] = useState({ email: "officer@manaksetu.gov.in", password: "ManakSetu@2026" });
  const [form, setForm] = useState({
    title: "Construction safety helmets",
    description: "Purchase 1,000 industrial safety helmets for construction workers with impact testing and permanent marking.",
    language: "en",
  });

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  useEffect(() => {
    getCurrentUser().then(setUser).catch(() => setUser(null)).finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    getLatestAnalysis().then(result => result && setAnalysis(result)).catch(() => notify("Could not load the latest analysis"));
    // Needed on load, not just when the overview panel opens: the evidence
    // legend states how many catalogue records are actually verified.
    getDashboardStats().then(setDashboardStats).catch(() => undefined);
  }, [user]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setSigningIn(true);
    setLoginError("");
    try {
      setUser(await loginUser(credentials.email, credentials.password));
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Sign in failed");
    } finally {
      setSigningIn(false);
    }
  };

  const handleLogout = () => {
    logout();
    setUser(null);
    setAnalysis(null);
    setOverlay(null);
    setApproved(false);
  };

  const openWorkspace = async (next: Overlay) => {
    setOverlay(next);
    setSidebarOpen(false);
    setLoadingOverlay(true);
    try {
      if (next === "standards" || next === "search") setStandards(await getStandards(searchQuery));
      if (next === "audit") setAuditEntries(await getAuditHistory());
      if (next === "overview") setDashboardStats(await getDashboardStats());
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load workspace data");
    } finally {
      setLoadingOverlay(false);
    }
  };

  const searchStandards = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoadingOverlay(true);
    try { setStandards(await getStandards(searchQuery)); } finally { setLoadingOverlay(false); }
  };

  const submitAnalysis = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError("");
    try {
      const result = inputMode === "file" && selectedFile ? await analyseFile(selectedFile) : await analyseTender(form);
      setAnalysis(result);
      setAnalysisOpen(false);
      setApproved(false);
      setTab("recommendations");
      notify(`Analysis ${result.tender.reference} is ready for review`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Analysis failed. Please retry.");
    } finally {
      setSubmitting(false);
    }
  };

  // The briefing is generated separately so that slow local inference never
  // delays the evidence. Fetch it once results are already rendered.
  const tenderId = analysis?.tender.id;
  const briefingPending = analysis?.officer_summary_status === "pending";
  useEffect(() => {
    if (!tenderId || !briefingPending) return;
    let cancelled = false;
    getBriefing(tenderId)
      .then(briefing => {
        if (cancelled) return;
        setAnalysis(current => (current && current.tender.id === tenderId ? { ...current, ...briefing } : current));
      })
      .catch(() => {
        if (cancelled) return;
        setAnalysis(current => (current && current.tender.id === tenderId ? { ...current, officer_summary_status: "unavailable" } : current));
      });
    return () => { cancelled = true; };
  }, [tenderId, briefingPending]);

  const stages = buildStages(analysis);
  const visibleRecommendations = (analysis?.recommendations ?? []).filter(
    item => typeFilter === "all" || item.standard.verification_status === typeFilter,
  );
  const primary = visibleRecommendations[0];
  const supporting = visibleRecommendations.slice(1);
  const displayedRequirements = (analysis?.extracted_requirements ?? []).map(item => [item.requirement_type.replaceAll("_", " "), item.value]);
  const productRequirement = analysis?.extracted_requirements.find(item => item.requirement_type === "product");
  const recommendationCount = analysis?.recommendations.length ?? 0;
  const requirementCount = analysis?.extracted_requirements.length ?? 0;
  const gapCount = analysis?.missing_requirements.length ?? 0;
  const filteredStandards = standards.filter(item => typeFilter === "all" || item.verification_status === typeFilter);
  // Presentation only -- the API enforces every one of these independently.
  const can = (permission: string) => Boolean(user?.permissions?.includes(permission));
  const verifiedRecordCount = dashboardStats?.verified_standards ?? 0;
  const catalogueSize = dashboardStats?.total_standards ?? 0;
  const overlayTitle: Record<Exclude<Overlay, null>, string> = {
    standards: "Standards library",
    audit: "Audit history",
    reports: "Export centre",
    overview: "Workspace overview",
    team: "Team members",
    settings: "Workspace settings",
    notifications: "Notifications",
    search: "Search standards",
    profile: "Your profile",
    about: "About this prototype",
  };
  const exportReport = async () => {
    if (!analysis) {
      notify("Run an analysis first to generate a real report");
      return;
    }
    try { await downloadReport(analysis.tender.id, "pdf"); } catch (error) { notify(error instanceof Error ? error.message : "Report could not be generated"); }
  };

  const approveReview = async () => {
    if (!analysis) {
      notify("Run an analysis before recording a decision");
      return;
    }
    try {
      await saveReview(analysis.tender.id, "approved", reviewNote);
      setApproved(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Review could not be saved");
    }
  };

  const requestExpertReview = async () => {
    if (!analysis) {
      notify("Run an analysis before requesting expert review");
      return;
    }
    try {
      await saveReview(analysis.tender.id, "expert_review", reviewNote || "Expert review requested from dashboard");
      notify("Expert review request saved to the audit trail");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Expert review could not be requested");
    }
  };

  const prepareGapCorrection = (title: string) => {
    setReviewNote(`Correction required: ${title}. `);
    document.querySelector(".review-note")?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".review-note")?.focus(), 450);
  };

  if (authLoading) return <main className="login-loading"><div className="logo-mark"><span /><span /><span /></div><LoaderCircle className="animate-spin" size={22} /><p>Securing your workspace…</p></main>;

  if (!user) return (
    <main className="login-shell">
      <section className="login-story">
        <Logo />
        <div className="login-story-copy"><p className="login-kicker"><ShieldCheck size={14} /> Government procurement intelligence</p><h1>Standards evidence your team can defend.</h1><p>Turn tender language into traceable Indian Standards recommendations, deterministic compliance checks, and review-ready evidence.</p></div>
        <div className="login-proof"><span><Check size={14} /> Official-source traceability</span><span><Check size={14} /> Human approval required</span><span><Check size={14} /> Auditable decisions</span></div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="login-icon"><LockKeyhole size={22} /></div>
          <p className="eyebrow">Secure officer access</p><h2>Welcome back</h2><p className="login-subtitle">Sign in to continue to the ManakSetu review workspace.</p>
          <label>Official email<input type="email" value={credentials.email} onChange={event => setCredentials({...credentials,email:event.target.value})} autoComplete="username" required /></label>
          <label>Password<input type="password" value={credentials.password} onChange={event => setCredentials({...credentials,password:event.target.value})} autoComplete="current-password" required /></label>
          {loginError && <p className="form-error"><TriangleAlert size={14} /> {loginError}</p>}
          <button className="login-button" type="submit" disabled={signingIn}>{signingIn ? <LoaderCircle className="animate-spin" size={17} /> : <LockKeyhole size={17} />}{signingIn ? "Signing in…" : "Sign in securely"}</button>
          <div className="demo-credentials"><Sparkles size={15} /><div><strong>Judge demo access</strong><span>Credentials are prefilled for this local prototype.</span></div></div>
        </form>
      </section>
    </main>
  );

  return (
    <main className="min-h-screen bg-mist text-ink">
      <div className="noise" />
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-6 pb-8 pt-6">
            <Logo />
            <button className="lg:hidden text-white/60" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X size={20} /></button>
          </div>

          <nav className="space-y-1 px-3">
            <NavItem icon={LayoutDashboard} label="Overview" onClick={() => openWorkspace("overview")} />
            <NavItem icon={FileSearch} label="Tender analysis" active onClick={() => { setOverlay(null); setSidebarOpen(false); window.scrollTo({top:0,behavior:"smooth"}); }} />
            <NavItem icon={BookOpenCheck} label="Standards library" onClick={() => openWorkspace("standards")} />
            {can(PERMISSIONS.reportExport) && <NavItem icon={FileCheck2} label="Reports" onClick={() => openWorkspace("reports")} />}
            {can(PERMISSIONS.auditRead) && <NavItem icon={History} label="Audit history" onClick={() => openWorkspace("audit")} />}
          </nav>

          <div className="mx-6 my-6 h-px bg-white/[.08]" />
          <p className="px-6 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Workspace</p>
          <nav className="space-y-1 px-3">
            <NavItem icon={MessageSquareText} label="Review queue" badge={String(gapCount)} onClick={() => { setSidebarOpen(false); document.querySelector(".review-note")?.scrollIntoView({behavior:"smooth",block:"center"}); }} />
            <NavItem icon={UserRound} label="Team members" onClick={() => openWorkspace("team")} />
            <NavItem icon={Settings} label="Settings" onClick={() => openWorkspace("settings")} />
          </nav>

          <div className="mt-auto p-4">
            <div className="support-card">
              <div className="flex items-center gap-2 text-white"><CircleHelp size={16} /><span className="text-xs font-semibold">Need an expert?</span></div>
              <p className="mt-2 text-[11px] leading-relaxed text-white/50">Flag uncertain results for standards-team review.</p>
              <button onClick={requestExpertReview}>Request review <ArrowRight size={12} /></button>
            </div>
            <button className="mt-4 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5" onClick={() => openWorkspace("profile")}>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-saffron text-xs font-bold text-pine">{user.full_name.split(" ").map(part => part[0]).join("").slice(0,2)}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-white">{user.full_name}</span><span className="block text-[10px] capitalize text-white/40">{user.role.replaceAll("_", " ")}</span></span>
              <MoreHorizontal className="text-white/30" size={17} />
            </button>
          </div>
        </div>
      </aside>

      {sidebarOpen && <button className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close overlay" />}

      <section className="lg:pl-[252px]">
        <header className="topbar">
          <button className="lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={21} /></button>
          <div className="hidden items-center gap-2 text-xs text-[#6f7d76] sm:flex"><span>Procurement workspace</span><span>/</span><span className="font-semibold text-ink">Tender analysis</span></div>
          <div className="ml-auto flex items-center gap-2">
            <button className="icon-button" aria-label="Search" onClick={() => openWorkspace("search")}><Search size={18} /></button>
            <button className="icon-button relative" aria-label="Notifications" onClick={() => openWorkspace("notifications")}><Bell size={18} /><span className="notification-dot" /></button>
            <div className="mx-1 h-5 w-px bg-[#d9dfda]" />
            <button className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-xs font-semibold hover:bg-black/[.03]" onClick={() => notify("Language selection is available in New analysis")}><Globe2 size={16} /> EN <ChevronDown size={13} /></button>
          </div>
        </header>

        <div className="mx-auto max-w-[1480px] px-4 pb-16 pt-6 sm:px-7 lg:px-9">
          <div className="mb-6 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
            <div className="animate-fade-up">
              <div className="eyebrow"><span className="h-1.5 w-1.5 rounded-full bg-saffron" /> Analysis workspace</div>
              <h1 className="mt-2 text-[28px] font-bold tracking-[-0.04em] text-ink sm:text-[34px]">Standards recommendation review</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#68766f]">Validate evidence-backed standards, resolve tender gaps, and record a human decision before export.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {can(PERMISSIONS.reportExport) && <button className="button-secondary" onClick={exportReport}><FileText size={16} /> Export report</button>}
              {can(PERMISSIONS.tenderCreate) && <button className="button-primary" onClick={() => setAnalysisOpen(true)}><Plus size={16} /> New analysis</button>}
            </div>
          </div>

          <div className="demo-banner">
            <div className="flex items-center gap-2.5"><Sparkles size={15} /><span><strong>Prototype workspace</strong> — check each result’s verification badge and official evidence before use.</span></div>
            <button onClick={() => openWorkspace("about")}>About demo data</button>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.62fr)_minmax(320px,.72fr)]">
            <div className="min-w-0 space-y-5">
              <section className="hero-card animate-fade-up [animation-delay:80ms]">
                <div className="relative z-10 flex flex-col gap-6 p-5 sm:p-7">
                  <div className="flex items-start justify-between gap-3 sm:gap-5">
                    <div className="flex min-w-0 gap-4">
                      <div className="file-emblem"><FileText size={22} /></div>
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">{analysis ? <span className="status-pill"><CheckCircle2 size={12} /> Analysis complete</span> : <span className="status-pill"><Clock3 size={12} /> No analysis yet</span>}<span className="text-[11px] text-white/40">{analysis?.tender.reference ?? "—"}</span></div>
                        <h2 className="truncate text-lg font-semibold tracking-[-0.025em] text-white sm:text-xl">{analysis?.tender.title ?? "Run an analysis to begin"}</h2>
                        <p className="mt-1 text-xs text-white/45">{analysis ? `${analysis.tender.filename ?? "Text submission"} · ${new Date(analysis.tender.created_at).toLocaleString()}` : "Submit a tender description or upload a document"}</p>
                      </div>
                    </div>
                    <button className="shrink-0 rounded-xl border border-white/10 p-2 text-white/60 transition hover:bg-white/10 hover:text-white" aria-label="More actions" onClick={() => openWorkspace("reports")}><MoreHorizontal size={20} /></button>
                  </div>

                  <div className="grid grid-cols-2 gap-4 border-t border-white/10 pt-5 sm:grid-cols-4 sm:gap-3">
                    <div><p className="hero-label">Product identified</p><p className="hero-value">{productRequirement?.value ?? "Not determined"}{productRequirement?.needs_confirmation && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-[.06em] text-[#ffc075]">inferred · confirm</span>}</p></div>
                    <div><p className="hero-label">Recommendations</p><p className="hero-value">{recommendationCount} candidate{recommendationCount === 1 ? "" : "s"}</p></div>
                    <div><p className="hero-label">Tender gaps</p><p className="hero-value text-[#ffc075]">{gapCount} require action</p></div>
                    <div><p className="hero-label">Review status</p><p className="hero-value">{approved ? "Approved" : analysis ? "Pending review" : "—"}</p></div>
                  </div>
                </div>
              </section>

              <section className="panel overflow-hidden animate-fade-up [animation-delay:140ms]">
                <div className="tabs" role="tablist">
                  {[["recommendations", "Recommendations", String(recommendationCount)], ["requirements", "Requirements", String(requirementCount)], ["gaps", "Tender gaps", String(gapCount)]].map(([id, label, count]) => (
                    <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)} role="tab">{label}<span>{count}</span></button>
                  ))}
                </div>

                {tab === "recommendations" && (
                  <div className="p-4 sm:p-6">
                    <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                      <div><h3 className="section-title">Verified recommendation set</h3><p className="section-subtitle">{analysis ? (analysis.retrieval_mode === "hybrid" ? `Hybrid retrieval — keyword + local semantic embeddings (${analysis.embedding_model?.split("/").pop()}), then graph traversal and deterministic rules.` : "Keyword retrieval only — the local embedding model is not loaded on this machine.") : "Ranked using keyword overlap, semantic similarity, graph links and deterministic rules."}</p></div>
                      <select className="filter-button" value={typeFilter} onChange={event => setTypeFilter(event.target.value as typeof typeFilter)} aria-label="Filter recommendation type"><option value="all">All types</option><option value="verified">Verified only</option><option value="demo">Demo only</option></select>
                    </div>

                    {analysis && <OutdatedCitations citations={analysis.outdated_citations} />}
                    {analysis && <EvidenceLegend verifiedCount={verifiedRecordCount} totalCount={catalogueSize} />}
                    {analysis && <OfficerBriefing analysis={analysis} />}

                    {primary && <article className="recommendation-card featured">
                      <div className="flex flex-col gap-5 sm:flex-row">
                        <div className="confidence-ring"><div><strong>{Math.round(primary.confidence_score * 100)}</strong><span>%</span></div><small>Confidence</small></div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2"><span className="type-chip primary">{primary.standard_type}</span><span className="type-chip current"><Check size={11} /> {primary.standard.status}</span><span className={`type-chip ${primary.standard.verification_status === "verified" ? "current" : "demo"}`}>{primary.standard.verification_status}</span></div>
                          <div className="mt-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                            <div className="min-w-0"><StandardIdentity standard={primary.standard} /><h4 className="mt-2 text-[17px] font-semibold tracking-[-.02em]">{primary.standard.official_title}</h4></div>
                            <button className="link-button" onClick={() => primary.standard.official_source_url ? window.open(primary.standard.official_source_url, "_blank", "noopener,noreferrer") : notify("No official evidence exists for this demo record")}><Link2 size={14} /> Evidence</button>
                          </div>
                          <p className="mt-3 text-[13px] leading-6 text-[#64726b]">{primary.reason_for_recommendation}</p>
                          {primary.warning && <p className="mt-3 rounded-lg border border-[#e8a353] bg-[#fff3e3] px-3 py-2 text-[12px] leading-5 text-[#8a5a12]"><TriangleAlert size={13} className="mr-1 inline" />{primary.warning}</p>}
                          <CurrencyNotice item={primary} />
                          <div className="mt-4 flex flex-wrap gap-2">{primary.matched_requirements.map(item => <span className="match-chip" key={item}>{item}</span>)}</div>
                          <div className="mt-5 grid gap-4 border-t border-[#e8ece8] pt-4 sm:grid-cols-3">
                            <div><p className="meta-label">Source status</p><p className="meta-value"><ShieldCheck size={13} /> {primary.standard.verification_status === "verified" ? "BIS source verified" : "Verification required"}</p></div>
                            <div><p className="meta-label">Last checked</p><p className="meta-value"><Clock3 size={13} /> {primary.standard.last_checked_date ?? "Never checked"}</p></div>
                            <div><p className="meta-label">Certification</p><p className="meta-value text-[#9b651c]"><UserRound size={13} /> {primary.certification_required ? `Mandatory — ${primary.qco_title ?? "QCO"}` : "No verified QCO applies"}</p></div>
                          </div>
                        </div>
                      </div>
                    </article>}

                    {supporting.length > 0 && <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {supporting.map(item => {
                        const key = String(item.standard.id);
                        return (
                          <article className="compact-rec" key={key}>
                            <div className="flex items-start justify-between"><span className="type-chip test">{item.standard_type}</span><span className={`score ${item.confidence_level === "high" ? "" : "medium"}`}>{Math.round(item.confidence_score * 100)}%</span></div>
                            <div className="mt-4"><StandardIdentity standard={item.standard} size="compact" /></div><h4 className="mt-2 text-sm font-semibold leading-5">{item.standard.official_title}</h4>
                            {item.relation_note && <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-[#eef3ef] px-2 py-1 text-[10px] font-semibold uppercase tracking-[.06em] text-pine"><Fingerprint size={11} /> graph link · {item.relation_note}</p>}
                            <p className="mt-3 text-xs leading-5 text-[#708078]">{item.standard.scope_summary}</p>
                            <CurrencyNotice item={item} />
                            <button onClick={() => setDetailsOpen(detailsOpen === key ? null : key)}>View rationale <ArrowRight size={13} /></button>
                            {detailsOpen === key && <div className="rationale-detail">{item.reason_for_recommendation}{item.warning ? ` — ${item.warning}` : ""}</div>}
                          </article>
                        );
                      })}
                    </div>}

                    {analysis?.guardrail_message && <div className="mt-3 rounded-xl border border-[#e8a353] bg-[#fff3e3] px-4 py-3 text-[13px] leading-6 text-[#8a5a12]"><TriangleAlert size={15} className="mr-2 inline" />{analysis.guardrail_message}</div>}

                    {visibleRecommendations.length === 0 && <div className="workspace-empty mt-3"><FileSearch size={25} /><strong>{analysis ? "No recommendations match this filter" : "No analysis yet"}</strong><span>{analysis ? "Choose another verification state to see candidates." : "Start a new analysis to generate evidence-backed candidates."}</span></div>}

                    <button className="show-more" onClick={() => openWorkspace("standards")}>Browse all standards <ArrowRight size={14} /></button>
                  </div>
                )}

                {tab === "requirements" && (
                  <div className="p-5 sm:p-7">
                    <h3 className="section-title">Extracted tender requirements</h3><p className="section-subtitle">Structured by the local extraction pipeline for officer confirmation.</p>
                    <div className="mt-6 grid gap-3 sm:grid-cols-2">{displayedRequirements.map(([key, value]) => <div className="requirement-row" key={`${key}-${value}`}><span className="capitalize">{key}</span><strong>{value}</strong><CheckCircle2 size={16} /></div>)}</div>
                    {!analysis && <div className="mt-4 rounded-2xl border border-dashed border-[#cbd5ce] bg-[#f8faf7] p-5 text-center text-sm text-[#65736c]">Run an analysis to replace these illustrative attributes with extracted requirements.</div>}
                  </div>
                )}

                {tab === "gaps" && (
                  <div className="p-5 sm:p-7">
                    <h3 className="section-title">Tender quality gaps</h3><p className="section-subtitle">Resolve these items before approving the recommendation set.</p>
                    <div className="mt-5 space-y-3">
                      {(analysis?.missing_requirements.map(item => ["Missing", item, "Add a measurable, reviewable requirement before approval."]) ?? [['Missing', 'Impact-test acceptance criteria', 'Add measurable thresholds and the applicable verified test method.'], ['Ambiguous', 'Service-temperature range', 'Specify the minimum and maximum operating temperatures.'], ['Review', 'Certification clause', 'Confirm applicability through the deterministic QCO rule check.']]).map(([tag, title, desc], i) => <div className="gap-row" key={title}><span className={`gap-icon g${i}`}><TriangleAlert size={17} /></span><div><div className="flex items-center gap-2"><h4>{title}</h4><span>{tag}</span></div><p>{desc}</p></div><button onClick={() => prepareGapCorrection(title)} aria-label={`Add correction note for ${title}`}><ArrowRight size={16} /></button></div>)}
                    </div>
                  </div>
                )}
              </section>
            </div>

            <aside className="space-y-5">
              <section className="panel p-5 animate-fade-up [animation-delay:180ms] sm:p-6">
                <div className="flex items-center justify-between"><div><p className="eyebrow">Analysis trail</p><h3 className="mt-1 text-base font-semibold">Traceable by design</h3></div><Fingerprint className="text-pine/30" size={29} /></div>
                <div className="mt-6 space-y-0">
                  {stages.map((stage, index) => <div className="timeline" key={stage.name}><div className="timeline-track"><span className={stage.status}>{stage.status === 'done' ? <Check size={12} /> : index + 1}</span>{index < stages.length - 1 && <i />}</div><div className="pb-6"><p>{stage.name}</p><small>{stage.detail}</small></div></div>)}
                </div>
                <button className="audit-link" onClick={() => openWorkspace("audit")}>View full audit trail <ArrowRight size={14} /></button>
              </section>

              <section className="panel overflow-hidden animate-fade-up [animation-delay:240ms]">
                <div className="border-b border-[#e8ece8] p-5 sm:p-6"><div className="flex items-center gap-2"><ShieldCheck size={18} className="text-pine" /><h3 className="text-base font-semibold">Human decision</h3></div><p className="mt-2 text-xs leading-5 text-[#728078]">An authorised officer must review evidence before this result can be used.</p></div>
                <div className="p-5 sm:p-6">
                  <div className="review-summary"><div><span>{recommendationCount}</span><small>Candidates</small></div><div><span>{gapCount}</span><small>Open gaps</small></div><div><span>0</span><small>Resolved</small></div></div>
                  {approved ? (
                    <div className="mt-5 rounded-2xl bg-[#eaf6ee] p-5 text-center"><CheckCircle2 className="mx-auto text-[#287d4d]" size={30} /><p className="mt-2 text-sm font-semibold text-[#1f613d]">Review decision recorded</p><p className="mt-1 text-[11px] text-[#4d7a61]">Saved to the prototype audit trail.</p></div>
                  ) : (
                    <>
                      <label className="mt-5 block text-[11px] font-semibold uppercase tracking-[.12em] text-[#6d7a73]">Reviewer note</label>
                      <textarea className="review-note" placeholder="Add context for your decision…" value={reviewNote} onChange={event => setReviewNote(event.target.value)} />
                      {can(PERMISSIONS.reviewSubmit) && <button className="approve-button" onClick={approveReview}><CheckCircle2 size={17} /> Approve for report</button>}
                      <button className="flag-button" onClick={requestExpertReview}><Flag size={15} /> Flag for expert review</button>
                    </>
                  )}
                </div>
              </section>

              <section className="trust-card animate-fade-up [animation-delay:300ms]">
                <div className="trust-icon"><ShieldCheck size={21} /></div>
                <div><p>Zero-invention guardrail</p><span>Only verified database records can become factual recommendations. The AI explains—it does not invent.</span></div>
              </section>
            </aside>
          </div>
        </div>
      </section>

      {overlay && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setOverlay(null)}>
          <section className="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-title" onMouseDown={event => event.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-icon">{overlay === "standards" || overlay === "search" ? <BookOpenCheck size={21} /> : overlay === "audit" ? <History size={21} /> : overlay === "reports" ? <FileCheck2 size={21} /> : <LayoutDashboard size={21} />}</div>
              <div><p className="eyebrow">ManakSetu workspace</p><h2 id="workspace-title">{overlayTitle[overlay]}</h2></div>
              <button onClick={() => setOverlay(null)} aria-label="Close workspace panel"><X size={19} /></button>
            </div>
            <div className="workspace-body">
              {loadingOverlay && <div className="workspace-loading"><LoaderCircle className="animate-spin" size={22} /> Loading live workspace data…</div>}

              {!loadingOverlay && (overlay === "standards" || overlay === "search") && (
                <>
                  <form className="workspace-search" onSubmit={searchStandards}>
                    <Search size={17} />
                    <input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search by standard number, title, or scope" autoFocus={overlay === "search"} />
                    <button type="submit">Search</button>
                  </form>
                  <div className="workspace-toolbar">
                    <span>{filteredStandards.length} records</span>
                    <select value={typeFilter} onChange={event => setTypeFilter(event.target.value as typeof typeFilter)}><option value="all">All records</option><option value="verified">Verified only</option><option value="demo">Demo only</option></select>
                  </div>
                  <div className="workspace-list">
                    {filteredStandards.map(item => <article className="workspace-row" key={item.id}>
                      <div className="workspace-row-icon"><ShieldCheck size={17} /></div>
                      <div className="min-w-0"><StandardIdentity standard={item} size="compact" /><h3 className="mt-2">{item.official_title}</h3><p>{item.scope_summary}</p></div>
                      {item.official_source_url ? <button className="row-action" onClick={() => window.open(item.official_source_url!, "_blank", "noopener,noreferrer")} aria-label={`Open official source for ${item.official_title}`}><Link2 size={16} /></button> : <span className="row-action muted"><TriangleAlert size={16} /></span>}
                    </article>)}
                    {!filteredStandards.length && <div className="workspace-empty"><FileSearch size={25} /><strong>No matching standards</strong><span>Try a broader term or change the verification filter.</span></div>}
                  </div>
                </>
              )}

              {!loadingOverlay && overlay === "audit" && <div className="workspace-list">
                {auditEntries.map(entry => <article className="audit-entry" key={entry.id}><span><Check size={13} /></span><div><strong>{entry.action.replaceAll("_", " ")}</strong><p>{entry.entity_type} · {entry.entity_id}</p><time>{new Date(entry.created_at).toLocaleString()}</time></div></article>)}
                {!auditEntries.length && <div className="workspace-empty"><History size={25} /><strong>No audit events yet</strong><span>Analyse a tender or record a review decision to create one.</span></div>}
              </div>}

              {!loadingOverlay && overlay === "reports" && <>
                <p className="workspace-intro">Download the current analysis in the format your review team needs. Every export is generated by the local API.</p>
                <div className="report-grid">
                  {([['pdf','PDF review pack','Presentation-ready report'],['docx','Editable DOCX','Continue drafting in Word'],['xlsx','Evidence workbook','Inspect structured evidence'],['json','JSON record','Use with another system']] as const).map(([format,title,description]) => <button key={format} onClick={async () => { if (!analysis) return notify("Run an analysis before exporting"); try { await downloadReport(analysis.tender.id, format); } catch (error) { notify(error instanceof Error ? error.message : "Report could not be generated"); } }}><FileText size={21} /><span><strong>{title}</strong><small>{description}</small></span><ArrowRight size={16} /></button>)}
                </div>
                {!analysis && <p className="workspace-callout"><TriangleAlert size={15} /> No analysis is loaded. Close this panel and choose New analysis first.</p>}
              </>}

              {!loadingOverlay && overlay === "overview" && <>
                <div className="stat-grid">
                  <div><span>Total tenders</span><strong>{dashboardStats?.total_tenders ?? 0}</strong></div><div><span>Pending reviews</span><strong>{dashboardStats?.pending_reviews ?? 0}</strong></div><div><span>Verified standards</span><strong>{dashboardStats?.verified_standards ?? 0}</strong></div><div><span>Completed reviews</span><strong>{dashboardStats?.completed_reviews ?? 0}</strong></div>
                </div>
                <p className="workspace-intro">This overview is calculated from the local application database and updates after analyses and review decisions.</p>
              </>}

              {!loadingOverlay && overlay === "team" && <div className="workspace-list">
                {[['AR','Ananya Rao','Procurement officer'],['VS','Vikram Shah','Standards reviewer'],['MK','Meera Kapoor','Compliance lead']].map(([initials,name,role]) => <article className="member-row" key={name}><span>{initials}</span><div><strong>{name}</strong><p>{role}</p></div><i>Active</i></article>)}
              </div>}

              {!loadingOverlay && overlay === "settings" && <div className="settings-list">
                <label><span><strong>Require human approval</strong><small>Block final reports until an officer records a decision.</small></span><input type="checkbox" defaultChecked /></label>
                <label><span><strong>Official evidence only</strong><small>Prefer verified catalogue records over demonstration records.</small></span><input type="checkbox" defaultChecked /></label>
                <label><span><strong>Audit notifications</strong><small>Show an alert when a review state changes.</small></span><input type="checkbox" defaultChecked /></label>
              </div>}

              {!loadingOverlay && overlay === "notifications" && <div className="workspace-list">
                <article className="notice-row"><span><TriangleAlert size={16} /></span><div><strong>{gapCount} tender gaps need review</strong><p>Open the Tender gaps tab to prepare correction notes.</p></div></article>
                <article className="notice-row success"><span><CheckCircle2 size={16} /></span><div><strong>Analysis service is ready</strong><p>Document extraction and standards matching are available locally.</p></div></article>
              </div>}

              {!loadingOverlay && overlay === "profile" && <div className="profile-card"><span>{user.full_name.split(" ").map(part => part[0]).join("").slice(0,2)}</span><h3>{user.full_name}</h3><p>{user.email} · {user.role.replaceAll("_", " ")}</p><div><ShieldCheck size={16} /> Authorised reviewer</div><button className="logout-button" onClick={handleLogout}><LogOut size={15} /> Sign out</button></div>}

              {!loadingOverlay && overlay === "about" && <div className="about-copy"><ShieldCheck size={32} /><h3>Evidence before confidence</h3><p>ManakSetu separates verified official records from demonstration data. A high matching score never turns an unverified identifier into a fact.</p><p>Look for the <strong>verified</strong> badge and follow the source link before using a recommendation in procurement.</p></div>}
            </div>
          </section>
        </div>
      )}

      {analysisOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !submitting && setAnalysisOpen(false)}>
          <section className="analysis-modal" role="dialog" aria-modal="true" aria-labelledby="analysis-title" onMouseDown={event => event.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-icon"><FileSearch size={21} /></div>
              <div><p className="eyebrow">Local analysis pipeline</p><h2 id="analysis-title">Analyse a procurement request</h2></div>
              <button onClick={() => setAnalysisOpen(false)} aria-label="Close analysis" disabled={submitting}><X size={19} /></button>
            </div>
            <form onSubmit={submitAnalysis} className="analysis-form">
              <div className="input-switch"><button type="button" className={inputMode === "text" ? "active" : ""} onClick={() => setInputMode("text")}><MessageSquareText size={14} /> Text description</button><button type="button" className={inputMode === "file" ? "active" : ""} onClick={() => setInputMode("file")}><UploadCloud size={14} /> Upload document</button></div>
              {inputMode === "text" ? <>
                <label>Tender title<input value={form.title} onChange={event => setForm({...form, title:event.target.value})} minLength={3} required /></label>
                <label>Product description or technical requirement<textarea value={form.description} onChange={event => setForm({...form, description:event.target.value})} minLength={10} required /></label>
              </> : <label className="file-drop"><input type="file" accept=".pdf,.docx,.xlsx,.txt,.png,.jpg,.jpeg" onChange={event => setSelectedFile(event.target.files?.[0] ?? null)} required /><UploadCloud size={27} /><strong>{selectedFile?.name ?? "Choose a tender document"}</strong><span>PDF, DOCX, XLSX, TXT or image · maximum 20 MB</span></label>}
              <div className="form-meta"><span><ShieldCheck size={15} /> Processed locally. Human review remains mandatory.</span><select value={form.language} onChange={event => setForm({...form, language:event.target.value})} aria-label="Input language"><option value="en">English</option><option value="hi">हिन्दी</option><option value="te">తెలుగు</option></select></div>
              {formError && <p className="form-error"><TriangleAlert size={14} /> {formError}</p>}
              <div className="modal-actions"><button type="button" className="button-secondary" onClick={() => setAnalysisOpen(false)} disabled={submitting}>Cancel</button><button type="submit" className="button-primary" disabled={submitting || (inputMode === "file" && !selectedFile)}>{submitting ? <LoaderCircle className="animate-spin" size={16} /> : <Sparkles size={16} />}{submitting ? "Analysing…" : "Run verified search"}</button></div>
            </form>
          </section>
        </div>
      )}
      {toast && <div className="toast"><CheckCircle2 size={17} /> {toast}</div>}
    </main>
  );
}
