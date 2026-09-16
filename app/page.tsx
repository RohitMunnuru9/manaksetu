"use client";

import {
  ArrowRight, BookOpenCheck, Check, CheckCircle2, ChevronRight, Clock3, FileCheck2,
  FileSearch, FileText, History, LayoutDashboard, Link2, LoaderCircle, LockKeyhole,
  LogOut, Menu, Search, ShieldCheck, Sparkles, TriangleAlert, UploadCloud, X,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  PERMISSIONS, analyseFile, analyseTender, downloadReport, getAuditHistory, getBriefing,
  getCurrentUser, getDashboardStats, getLatestAnalysis, getStandards, login as loginUser,
  logout, saveReview,
  type AnalysisResult, type ApiRecommendation, type ApiStandard, type AuditEntry,
  type DashboardStats, type UserProfile,
} from "@/lib/api";

type View = "overview" | "analyse" | "standards" | "reports" | "audit";

/* ---------------------------------------------------------------------
   Plain-language helpers.
   Everything an officer reads is written here, once, in ordinary words.
   The API's internal vocabulary never reaches the screen.
   --------------------------------------------------------------------- */

type Tier = "verified" | "checking" | "example";

function tierOf(standard: ApiStandard): Tier {
  if (standard.verification_status === "verified" && standard.standard_number) return "verified";
  if (standard.standard_number) return "checking";
  return "example";
}

const TIER_LABEL: Record<Tier, string> = {
  verified: "Verified",
  checking: "Needs checking",
  example: "Example only",
};

const TIER_CLASS: Record<Tier, string> = { verified: "green", checking: "amber", example: "grey" };

const TIER_MEANING: Record<Tier, string> = {
  verified: "Someone has checked this against the official BIS record. You can use it, once you are happy with it.",
  checking: "The number is real and came from an official BIS page, but nobody has checked the title and year yet. Open the source link and confirm before you use it.",
  example: "A stand-in used to show how the system works. It has no standard number, so never put it in a tender.",
};

/** "tested_by of IS 2925:1984" -> "Test method for IS 2925:1984" */
function plainRelation(note: string | null): string | null {
  if (!note) return null;
  const [kind, , target] = [note.split(" of ")[0], "", note.split(" of ")[1]];
  const word: Record<string, string> = {
    tested_by: "Test method for",
    safety: "Safety rules for",
    terminology: "Definitions used by",
    references: "Referred to by",
    installation: "Installation rules for",
  };
  return `${word[kind] ?? "Linked to"} ${target}`;
}

/** The role of a result, in words rather than a code. */
function plainRole(type: string): string {
  const words: Record<string, string> = {
    primary: "Main standard",
    allied: "Related",
    test: "Test method",
    safety: "Safety",
    terminology: "Definitions",
    installation: "Installation",
    "normative reference": "Referenced",
  };
  return words[type] ?? type;
}

function confidenceWord(level: string): string {
  return { high: "Strong match", medium: "Likely match", low: "Weak match" }[level] ?? level;
}

/* ---------------------------------------------------------------------
   Small presentational pieces
   --------------------------------------------------------------------- */

function Identifier({ standard }: { standard: ApiStandard }) {
  const tier = tierOf(standard);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className={`ident ${tier === "example" ? "internal" : "real"}`}>
        {standard.standard_number ?? standard.catalogue_ref ?? "No reference"}
      </span>
      <span className={`tag ${TIER_CLASS[tier]}`}>{TIER_LABEL[tier]}</span>
    </span>
  );
}

function Stat({ value, caption, note, tone }: { value: string; caption: string; note?: string; tone?: "rust" | "green" }) {
  return (
    <div className="stat">
      <div className={`num ${tone ?? ""}`}>{value}</div>
      <div className="cap">{caption}</div>
      {note && <p className="note">{note}</p>}
    </div>
  );
}

function Stepper({ analysis, running }: { analysis: AnalysisResult | null; running: boolean }) {
  const done = Boolean(analysis);
  const steps = [
    { label: "Tender read", done, active: running },
    { label: "Details pulled out", done: done && analysis!.extracted_requirements.length > 0, active: running },
    { label: "Standards searched", done: done && analysis!.recommendations.length > 0, active: running },
    { label: "Your decision", done: false, active: done },
  ];
  return (
    <div className="stepper">
      {steps.map((s, i) => (
        <div key={s.label} className={`step ${s.done ? "done" : s.active ? "active" : ""}`}>
          <span className="step-dot">{s.done ? <Check size={13} /> : i + 1}</span>
          <span className="step-label">{s.label}</span>
          {i < steps.length - 1 && <span className="step-line" />}
        </div>
      ))}
    </div>
  );
}

/** One result, collapsed. Everything else lives in the detail panel. */
function ResultRow({ item, onOpen }: { item: ApiRecommendation; onOpen: () => void }) {
  const pct = Math.round(item.confidence_score * 100);
  const ringClass = item.confidence_level === "high" ? "hi" : item.confidence_level === "medium" ? "mid" : "lo";
  const relation = plainRelation(item.relation_note);
  return (
    <button className={`result ${item.standard_type === "primary" ? "primary" : ""}`} onClick={onOpen}>
      <span className={`ring ${ringClass}`}>{pct}%</span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <Identifier standard={item.standard} />
          <span className="tag rust">{plainRole(item.standard_type)}</span>
          {item.certification_required && <span className="tag red">BIS mark required</span>}
          {item.is_outdated && <span className="tag red">Out of date</span>}
        </span>
        <h4>{item.standard.official_title}</h4>
        <p className="sub">{relation ?? confidenceWord(item.confidence_level)} · Tap to see why</p>
      </span>
      <ChevronRight size={18} className="text-[var(--faint)]" />
    </button>
  );
}

/** The drill-down. Everything about one result, in one place. */
function DetailPanel({ item, onClose }: { item: ApiRecommendation; onClose: () => void }) {
  const tier = tierOf(item.standard);
  const relation = plainRelation(item.relation_note);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-modal="true" aria-label="Standard details">
        <header className="panel-head">
          <div className="min-w-0">
            <Identifier standard={item.standard} />
            <h2 className="mt-2 text-[19px] leading-snug">{item.standard.official_title}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        <div className="panel-body">
          <div className={`notice ${tier === "verified" ? "green" : tier === "checking" ? "amber" : "plain"}`}>
            {tier === "verified" ? <ShieldCheck size={16} className="mt-0.5 shrink-0" /> : <TriangleAlert size={16} className="mt-0.5 shrink-0" />}
            <span><strong>{TIER_LABEL[tier]}.</strong> {TIER_MEANING[tier]}</span>
          </div>

          {item.is_outdated && (
            <div className="notice red mt-3">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              <span><strong>This one is out of date.</strong> {item.currency_warning}</span>
            </div>
          )}

          <dl className="mt-2">
            <div className="field">
              <dt>How well it matches</dt>
              <dd>{Math.round(item.confidence_score * 100)}% — {confidenceWord(item.confidence_level)}</dd>
            </div>
            <div className="field">
              <dt>Why it came up</dt>
              <dd>{relation ? `${relation}. It was included because the main standard depends on it, not because of how the tender is worded.` : item.reason_for_recommendation}</dd>
            </div>
            {item.matched_requirements.length > 0 && (
              <div className="field">
                <dt>Words it matched in your tender</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {item.matched_requirements.map(w => <span className="tag grey" key={w}>{w}</span>)}
                </dd>
              </div>
            )}
            <div className="field">
              <dt>Is a BIS mark required?</dt>
              <dd>
                {item.certification_required
                  ? <><strong>Yes.</strong> Required under {item.qco_title}{item.qco_enforcement_date ? `, in force since ${item.qco_enforcement_date}` : ""}.</>
                  : "Not confirmed. We only say yes when an officially checked order says so."}
              </dd>
            </div>
            {item.amendments.length > 0 && (
              <div className="field">
                <dt>Changes since it was published</dt>
                <dd>
                  <ul className="m-0 list-disc pl-4">
                    {item.amendments.map(a => (
                      <li key={a.amendment_number} className="mb-1">
                        <strong>{a.amendment_number}</strong>{a.issued_date ? ` (${a.issued_date})` : ""}{a.summary ? ` — ${a.summary}` : ""}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            <div className="field">
              <dt>What it covers</dt>
              <dd>{item.standard.scope_summary || "No summary recorded."}</dd>
            </div>
            <div className="field">
              <dt>Last checked by a person</dt>
              <dd>{item.standard.last_checked_date ?? "Not yet checked"}</dd>
            </div>
          </dl>
        </div>

        <footer className="panel-foot flex gap-9">
          {item.standard.official_source_url ? (
            <a className="btn btn-primary flex-1" href={item.standard.official_source_url} target="_blank" rel="noopener noreferrer">
              <Link2 size={15} /> Open the official page
            </a>
          ) : (
            <span className="notice plain flex-1">No official page — this is an example record.</span>
          )}
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </footer>
      </aside>
    </>
  );
}

/* ---------------------------------------------------------------------
   Page
   --------------------------------------------------------------------- */

export default function Home() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [credentials, setCredentials] = useState({ email: "officer@manaksetu.gov.in", password: "ManakSetu@2026" });

  const [view, setView] = useState<View>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState("");

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [openResult, setOpenResult] = useState<ApiRecommendation | null>(null);
  const [tab, setTab] = useState<"results" | "details" | "gaps">("results");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [mode, setMode] = useState<"text" | "file">("text");
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    title: "Construction safety helmets",
    description: "Purchase 1,000 industrial safety helmet units for construction workers with impact testing and permanent marking.",
    language: "en",
  });

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [standards, setStandards] = useState<ApiStandard[]>([]);
  const [standardsQuery, setStandardsQuery] = useState("");
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [reviewNote, setReviewNote] = useState("");
  const [approved, setApproved] = useState(false);

  const notify = (m: string) => { setToast(m); window.setTimeout(() => setToast(""), 3000); };
  const can = (p: string) => Boolean(user?.permissions?.includes(p));

  useEffect(() => {
    getCurrentUser().then(setUser).catch(() => setUser(null)).finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    getLatestAnalysis().then(r => r && setAnalysis(r)).catch(() => undefined);
    getDashboardStats().then(setStats).catch(() => undefined);
  }, [user]);

  // The written summary is slow, so it is fetched after results are on screen.
  const tenderId = analysis?.tender.id;
  const briefingPending = analysis?.officer_summary_status === "pending";
  useEffect(() => {
    if (!tenderId || !briefingPending) return;
    let cancelled = false;
    getBriefing(tenderId)
      .then(b => { if (!cancelled) setAnalysis(c => (c && c.tender.id === tenderId ? { ...c, ...b } : c)); })
      .catch(() => { if (!cancelled) setAnalysis(c => (c && c.tender.id === tenderId ? { ...c, officer_summary_status: "unavailable" } : c)); });
    return () => { cancelled = true; };
  }, [tenderId, briefingPending]);

  useEffect(() => {
    if (!user) return;
    if (view === "standards") getStandards(standardsQuery).then(setStandards).catch(() => notify("Could not load the standards list"));
    if (view === "audit" && can(PERMISSIONS.auditRead)) getAuditHistory().then(setAudit).catch(() => notify("Could not load the history"));
    if (view === "overview") getDashboardStats().then(setStats).catch(() => undefined);
  }, [view, user, standardsQuery]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSigningIn(true); setLoginError("");
    try { setUser(await loginUser(credentials.email, credentials.password)); }
    catch (err) { setLoginError(err instanceof Error ? err.message : "Could not sign in"); }
    finally { setSigningIn(false); }
  };

  const runAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true); setFormError("");
    try {
      const result = mode === "file" && file ? await analyseFile(file) : await analyseTender(form);
      setAnalysis(result); setApproved(false); setTab("results"); setView("analyse");
      notify(result.recommendations.length ? `Found ${result.recommendations.length} possible standards` : "No matching standards found");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not analyse that. Please try again.");
    } finally { setSubmitting(false); }
  };

  const approve = async () => {
    if (!analysis) return;
    try { await saveReview(analysis.tender.id, "approved", reviewNote); setApproved(true); notify("Decision recorded"); }
    catch { notify("Could not save your decision"); }
  };

  const exportReport = async (fmt: "pdf" | "docx" | "xlsx" | "json") => {
    if (!analysis) { notify("Run an analysis first"); return; }
    try { await downloadReport(analysis.tender.id, fmt); notify(`${fmt.toUpperCase()} downloaded`); }
    catch { notify("Could not create the file"); }
  };

  if (authLoading) {
    return (
      <main className="grid min-h-screen place-items-center">
        <div className="grid justify-items-center gap-3 text-[var(--muted)]">
          <LoaderCircle className="spin" size={22} />
          <p className="text-xs">Opening your workspace…</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="login">
        <section className="login-art">
          <div>
            <p className="eyebrow" style={{ color: "#e3a882" }}>ManakSetu</p>
            <h2 className="mt-4">The right standards,<br />backed by evidence.</h2>
            <p>Describe what you are buying. We find the Indian Standards that apply, show you where each one came from, and leave the final call to you.</p>
          </div>
          <p className="text-[10px] uppercase tracking-[.16em] text-white/30">Right specifications. A stronger India.</p>
        </section>
        <section className="login-form">
          <div className="login-inner">
            <div className="mb-6 grid h-12 w-12 place-items-center rounded-xl bg-[var(--navy)] text-white"><LockKeyhole size={20} /></div>
            <h3>Sign in</h3>
            <p className="mb-6 text-[13px] text-[var(--muted)]">Use your official email address.</p>
            <form onSubmit={handleLogin}>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" className="input" type="email" value={credentials.email} onChange={e => setCredentials({ ...credentials, email: e.target.value })} required />
              <div className="h-4" />
              <label className="label" htmlFor="pw">Password</label>
              <input id="pw" className="input" type="password" value={credentials.password} onChange={e => setCredentials({ ...credentials, password: e.target.value })} required />
              {loginError && <p className="mt-3 text-[12px] text-[var(--red)]">{loginError}</p>}
              <button className="btn btn-primary mt-5 w-full" type="submit" disabled={signingIn}>
                {signingIn ? <><LoaderCircle className="spin" size={15} /> Signing in…</> : <><LockKeyhole size={15} /> Sign in</>}
              </button>
            </form>
            <div className="notice plain mt-5">
              <Sparkles size={15} className="mt-0.5 shrink-0" />
              <span>Demonstration login is already filled in. A second account, <strong>supplier@example.in</strong>, shows what a supplier can and cannot do.</span>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const recs = analysis?.recommendations ?? [];
  const gaps = analysis?.missing_requirements ?? [];
  const details = analysis?.extracted_requirements ?? [];
  const product = details.find(d => d.requirement_type === "product");
  const verifiedCount = stats?.verified_standards ?? 0;
  const totalCount = stats?.total_standards ?? 0;

  const nav: Array<{ id: View; label: string; icon: React.ElementType; show: boolean; count?: number }> = [
    { id: "overview", label: "Overview", icon: LayoutDashboard, show: true },
    { id: "analyse", label: "Analyse a tender", icon: FileSearch, show: true, count: recs.length || undefined },
    { id: "standards", label: "Standards list", icon: BookOpenCheck, show: true },
    { id: "reports", label: "Download report", icon: FileCheck2, show: can(PERMISSIONS.reportExport) },
    { id: "audit", label: "History", icon: History, show: can(PERMISSIONS.auditRead) },
  ];

  return (
    <div className="shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <h1>ManakSetu</h1>
          <span>Verified standards intelligence</span>
        </div>
        <nav className="nav">
          {nav.filter(n => n.show).map(n => (
            <button key={n.id} className={view === n.id ? "active" : ""} onClick={() => { setView(n.id); setSidebarOpen(false); }}>
              <n.icon size={17} />
              <span>{n.label}</span>
              {n.count ? <span className="nav-count">{n.count}</span> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <p className="tagline">Standards<br />for a safer<br />tomorrow</p>
          <button className="who" onClick={() => notify(`Signed in as ${user.full_name}`)}>
            <span className="avatar">{user.full_name.split(" ").map(p => p[0]).join("").slice(0, 2)}</span>
            <span className="min-w-0 flex-1">
              <strong className="truncate">{user.full_name}</strong>
              <small>{user.role.replaceAll("_", " ")}</small>
            </span>
          </button>
          <button className="btn btn-sm mt-2 w-full text-white/60 hover:text-white" onClick={() => { logout(); setUser(null); }}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      {sidebarOpen && <button className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close menu" />}

      <div className="main">
        <header className="topbar">
          <button className="icon-btn lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={19} /></button>
          <div className="searchbox">
            <Search size={15} />
            <input
              placeholder="Search standards by name…"
              value={standardsQuery}
              onChange={e => { setStandardsQuery(e.target.value); if (view !== "standards") setView("standards"); }}
            />
          </div>
          <span className="ml-auto hidden text-[11px] text-[var(--faint)] sm:block">
            {verifiedCount} verified · {totalCount} records
          </span>
        </header>

        <div className="page page-wide">
          {/* ---------------- Overview ---------------- */}
          {view === "overview" && (
            <>
              <p className="eyebrow">Overview</p>
              <h1 className="display mt-3">Procurement decisions,<br />grounded in evidence.</h1>
              <p className="lede">Turn a tender into a list of Indian Standards you can defend — each one traced back to an official source.</p>

              <div className="mt-7 flex flex-wrap gap-9">
                {can(PERMISSIONS.tenderCreate) && (
                  <button className="btn btn-primary" onClick={() => setView("analyse")}><FileSearch size={16} /> Analyse a tender</button>
                )}
                <button className="btn btn-ghost" onClick={() => setView("standards")}><BookOpenCheck size={16} /> Browse standards</button>
              </div>

              <div className="grid-3 mt-8">
                <Stat value={String(totalCount)} caption="Standards in the catalogue" note={`${verifiedCount} checked by a person; the rest show their source and say they still need checking.`} />
                <Stat value="Zero" caption="Invented standard numbers" tone="green" note="Numbers only ever come from the catalogue. The AI is not allowed to write one." />
                <Stat value={String(stats?.total_tenders ?? 0)} caption="Tenders analysed" tone="rust" note="Every analysis is recorded in the history, with who did what and when." />
              </div>

              <div className="card card-pad mt-6">
                <h3 className="section-head">How this works</h3>
                <p className="section-sub">Four steps, and you decide at the end.</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {[
                    ["1. You describe the purchase", "Type a few lines, or upload the tender document. Scanned pages are read automatically."],
                    ["2. We work out what you need", "The product, where it will be used, quantities, testing and safety requirements."],
                    ["3. We search by meaning", "Not just keywords — 'head protection' finds helmet standards even without the word 'helmet'."],
                    ["4. You check and approve", "Every result shows where it came from. Nothing is final until you say so."],
                  ].map(([h, p]) => (
                    <div key={h} className="rounded-xl border border-[var(--line)] bg-[#fdfcfa] p-4">
                      <strong className="serif text-[14px]">{h}</strong>
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--muted)]">{p}</p>
                    </div>
                  ))}
                </div>
              </div>

              {analysis && (
                <div className="card mt-6">
                  <div className="card-head flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="eyebrow">Most recent</p>
                      <h3 className="section-head mt-1 truncate">{analysis.tender.title}</h3>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => setView("analyse")}>Open <ArrowRight size={14} /></button>
                  </div>
                  <div className="card-pad grid gap-4 sm:grid-cols-3">
                    <div><p className="cap text-[10px] font-bold uppercase tracking-wider text-[var(--faint)]">Product</p><p className="mt-1 font-semibold">{product?.value ?? "Not identified"}</p></div>
                    <div><p className="cap text-[10px] font-bold uppercase tracking-wider text-[var(--faint)]">Standards found</p><p className="mt-1 font-semibold">{recs.length}</p></div>
                    <div><p className="cap text-[10px] font-bold uppercase tracking-wider text-[var(--faint)]">Things to fix</p><p className="mt-1 font-semibold">{gaps.length}</p></div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ---------------- Analyse ---------------- */}
          {view === "analyse" && (
            <>
              <p className="eyebrow">Analyse a tender</p>
              <h1 className="display mt-3">{analysis ? analysis.tender.title : "What are you buying?"}</h1>
              {analysis && <p className="lede">Reference {analysis.tender.reference} · {new Date(analysis.tender.created_at).toLocaleString()}</p>}

              <div className="card card-pad mt-6"><Stepper analysis={analysis} running={submitting} /></div>

              <div className="grid-2 mt-5">
                <div className="min-w-0">
                  {can(PERMISSIONS.tenderCreate) && (
                    <div className="card card-pad mb-5">
                      <h3 className="section-head">Describe the purchase</h3>
                      <p className="section-sub">A sentence or two is enough. Or upload the tender document.</p>

                      <div className="mt-4 flex gap-9">
                        <button className={`btn btn-sm ${mode === "text" ? "btn-dark" : "btn-ghost"}`} onClick={() => setMode("text")}>Type it</button>
                        <button className={`btn btn-sm ${mode === "file" ? "btn-dark" : "btn-ghost"}`} onClick={() => setMode("file")}>Upload a file</button>
                      </div>

                      <form className="mt-4" onSubmit={runAnalysis}>
                        {mode === "text" ? (
                          <>
                            <label className="label" htmlFor="t">Short title</label>
                            <input id="t" className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required minLength={3} />
                            <div className="h-4" />
                            <label className="label" htmlFor="d">What are you buying?</label>
                            <textarea id="d" className="textarea" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} required minLength={10} />
                          </>
                        ) : (
                          <label className="dropzone block cursor-pointer">
                            <UploadCloud size={26} className="text-[var(--rust)]" />
                            <strong className="serif text-[14px]">{file ? file.name : "Choose a file"}</strong>
                            <span className="text-[12px]">PDF, Word, Excel, or a photo of a printed page. Scanned pages are read for you.</span>
                            <input type="file" className="hidden" accept=".pdf,.docx,.xlsx,.txt,.png,.jpg,.jpeg" onChange={e => setFile(e.target.files?.[0] ?? null)} />
                          </label>
                        )}
                        {formError && <p className="mt-3 text-[12px] text-[var(--red)]">{formError}</p>}
                        <button className="btn btn-primary mt-4 w-full" type="submit" disabled={submitting || (mode === "file" && !file)}>
                          {submitting ? <><LoaderCircle className="spin" size={15} /> Working…</> : <>Find the standards <ArrowRight size={15} /></>}
                        </button>
                      </form>
                    </div>
                  )}

                  {analysis && (
                    <div className="card">
                      <div className="tabs">
                        <button className={tab === "results" ? "active" : ""} onClick={() => setTab("results")}>Standards found<span className="pill">{recs.length}</span></button>
                        <button className={tab === "details" ? "active" : ""} onClick={() => setTab("details")}>What we read<span className="pill">{details.length}</span></button>
                        <button className={tab === "gaps" ? "active" : ""} onClick={() => setTab("gaps")}>Things to fix<span className="pill">{gaps.length}</span></button>
                      </div>

                      <div className="card-pad">
                        {tab === "results" && (
                          <>
                            <p className="section-sub mb-4">Tap any result to see why it came up and where it came from.</p>
                            {recs.map(item => <ResultRow key={item.standard.id} item={item} onOpen={() => setOpenResult(item)} />)}
                            {!recs.length && (
                              <div className="empty">
                                <FileSearch size={26} />
                                <strong>Nothing matched</strong>
                                <span>{analysis.guardrail_message ?? "We could not find a standard for this. An expert needs to look at it."}</span>
                              </div>
                            )}
                          </>
                        )}

                        {tab === "details" && (
                          <>
                            <p className="section-sub mb-4">This is what we understood from your tender. Correct anything that looks wrong before you approve.</p>
                            {details.map(d => (
                              <div className="rowcard" key={`${d.requirement_type}-${d.value}`}>
                                <span className="ico"><CheckCircle2 size={17} /></span>
                                <div className="min-w-0 flex-1">
                                  <dt>{d.requirement_type.replaceAll("_", " ")}</dt>
                                  <dd>{d.value}</dd>
                                </div>
                                {d.needs_confirmation && <span className="tag amber">Please confirm</span>}
                              </div>
                            ))}
                            {!details.length && <div className="empty"><strong>Nothing picked up</strong><span>Try describing the purchase in a little more detail.</span></div>}
                          </>
                        )}

                        {tab === "gaps" && (
                          <>
                            <p className="section-sub mb-4">Your tender does not mention these. Adding them makes it harder to dispute later.</p>
                            {gaps.map(g => (
                              <div className="rowcard" key={g}>
                                <span className="ico warn"><TriangleAlert size={17} /></span>
                                <div className="min-w-0 flex-1"><dd className="font-semibold">{g}</dd></div>
                              </div>
                            ))}
                            {!gaps.length && <div className="empty"><strong>Nothing missing</strong><span>Your tender already covers the usual points.</span></div>}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Right column */}
                <div className="min-w-0 space-y-5">
                  {analysis && analysis.outdated_citations.length > 0 && (
                    <div className="card card-pad">
                      <h3 className="section-head">Your tender names an old standard</h3>
                      {analysis.outdated_citations.map(c => (
                        <div className="notice red mt-3" key={c.cited_standard}>
                          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                          <span><strong>{c.cited_standard}</strong> — {c.message}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {analysis && (
                    <div className="card card-pad">
                      <h3 className="section-head">Plain-English summary</h3>
                      <p className="section-sub">Written for you from the results on the left.</p>
                      {analysis.officer_summary ? (
                        <>
                          <p className="mt-4 text-[13px] leading-[1.7] text-[var(--muted)]">{analysis.officer_summary}</p>
                          <div className="notice plain mt-4">
                            <ShieldCheck size={15} className="mt-0.5 shrink-0" />
                            <span>Written by an AI running on this computer. It can only talk about the results above — if it mentions a standard that was not found, the whole summary is thrown away.</span>
                          </div>
                        </>
                      ) : analysis.officer_summary_status === "pending" ? (
                        <p className="mt-4 flex items-center gap-2 text-[13px] text-[var(--faint)]"><LoaderCircle className="spin" size={14} /> Writing…</p>
                      ) : analysis.officer_summary_status.startsWith("rejected") ? (
                        <div className="notice amber mt-4">
                          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                          <span><strong>A summary was thrown away.</strong> The AI mentioned a standard that was not in the results, so we did not show you any of it. The results themselves are unaffected.</span>
                        </div>
                      ) : (
                        <p className="mt-4 text-[13px] text-[var(--faint)]">Not available right now. The results above do not depend on it.</p>
                      )}
                    </div>
                  )}

                  {analysis && can(PERMISSIONS.reviewSubmit) && (
                    <div className="card card-pad">
                      <h3 className="section-head">Your decision</h3>
                      <p className="section-sub">Nothing is final until you approve it.</p>
                      <textarea className="textarea mt-4" style={{ minHeight: 84 }} placeholder="Add a note (optional)" value={reviewNote} onChange={e => setReviewNote(e.target.value)} />
                      {approved ? (
                        <div className="notice green mt-3"><CheckCircle2 size={16} className="mt-0.5 shrink-0" /><span>Approved and recorded in the history.</span></div>
                      ) : (
                        <button className="btn btn-primary mt-3 w-full" onClick={approve}><CheckCircle2 size={16} /> Approve</button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ---------------- Standards list ---------------- */}
          {view === "standards" && (
            <>
              <p className="eyebrow">Standards list</p>
              <h1 className="display mt-3">Everything in the catalogue</h1>
              <p className="lede">{totalCount} records. {verifiedCount} has been checked by a person; the others show where they came from and say they still need checking.</p>
              <div className="card card-pad mt-6">
                {standards.map(s => (
                  <div className="result" key={s.id} style={{ cursor: "default" }}>
                    <span className={`ring ${tierOf(s) === "verified" ? "hi" : tierOf(s) === "checking" ? "mid" : "lo"}`}>
                      {tierOf(s) === "verified" ? <ShieldCheck size={18} /> : tierOf(s) === "checking" ? <Clock3 size={18} /> : <FileText size={18} />}
                    </span>
                    <span className="min-w-0">
                      <Identifier standard={s} />
                      <h4>{s.official_title}</h4>
                      <p className="sub">{s.scope_summary.slice(0, 130)}{s.scope_summary.length > 130 ? "…" : ""}</p>
                    </span>
                    {s.official_source_url
                      ? <a className="icon-btn" href={s.official_source_url} target="_blank" rel="noopener noreferrer" aria-label="Open official page"><Link2 size={16} /></a>
                      : <span className="icon-btn opacity-30"><Link2 size={16} /></span>}
                  </div>
                ))}
                {!standards.length && <div className="empty"><strong>Nothing found</strong><span>Try a different word, or clear the search box above.</span></div>}
              </div>
            </>
          )}

          {/* ---------------- Reports ---------------- */}
          {view === "reports" && (
            <>
              <p className="eyebrow">Download report</p>
              <h1 className="display mt-3">Take it away</h1>
              <p className="lede">A record of this analysis, ready to attach to your file or share with a colleague.</p>
              {analysis ? (
                <div className="card card-pad mt-6">
                  <h3 className="section-head">{analysis.tender.title}</h3>
                  <p className="section-sub">Reference {analysis.tender.reference}</p>
                  <div className="mt-5 grid gap-9 sm:grid-cols-2 lg:grid-cols-4">
                    {([["pdf", "PDF"], ["docx", "Word"], ["xlsx", "Excel"], ["json", "Data file"]] as const).map(([fmt, label]) => (
                      <button key={fmt} className="btn btn-ghost" onClick={() => exportReport(fmt)}><FileText size={15} /> {label}</button>
                    ))}
                  </div>
                  <div className="notice amber mt-5">
                    <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                    <span>Records marked <strong>Needs checking</strong> or <strong>Example only</strong> are labelled as such in the file, so nobody mistakes them for confirmed standards.</span>
                  </div>
                </div>
              ) : (
                <div className="card mt-6"><div className="empty"><FileCheck2 size={26} /><strong>Nothing to download yet</strong><span>Analyse a tender first, then come back here.</span></div></div>
              )}
            </>
          )}

          {/* ---------------- History ---------------- */}
          {view === "audit" && (
            <>
              <p className="eyebrow">History</p>
              <h1 className="display mt-3">Who did what, and when</h1>
              <p className="lede">Every sign-in, analysis, decision and download is recorded here.</p>
              <div className="card card-pad mt-6">
                {audit.map(a => (
                  <div className="rowcard" key={a.id}>
                    <span className="ico"><History size={16} /></span>
                    <div className="min-w-0 flex-1">
                      <dd className="font-semibold">{a.action.replaceAll(".", " ").replaceAll("_", " ")}</dd>
                      <dt className="mt-1 normal-case tracking-normal">{new Date(a.created_at).toLocaleString()}</dt>
                    </div>
                  </div>
                ))}
                {!audit.length && <div className="empty"><strong>Nothing recorded yet</strong><span>Activity will appear here as you use the system.</span></div>}
              </div>
            </>
          )}
        </div>
      </div>

      {openResult && <DetailPanel item={openResult} onClose={() => setOpenResult(null)} />}
      {toast && <div className="toast"><CheckCircle2 size={15} /> {toast}</div>}
    </div>
  );
}
