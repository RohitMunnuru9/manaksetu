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
import { useState } from "react";

type NavItemProps = {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  badge?: string;
};

const stages = [
  { name: "Document read", detail: "18 sections indexed", status: "done" },
  { name: "Requirements extracted", detail: "12 technical attributes", status: "done" },
  { name: "Verified records searched", detail: "Catalogue + graph + rules", status: "done" },
  { name: "Expert review", detail: "Awaiting your decision", status: "current" },
];

const requirements = [
  ["Product", "Industrial safety helmet"],
  ["Intended use", "Construction site workforce"],
  ["Quantity", "1,000 units"],
  ["Material", "High-impact shell"],
];

function NavItem({ icon: Icon, label, active, badge }: NavItemProps) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`}>
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

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

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
            <NavItem icon={LayoutDashboard} label="Overview" />
            <NavItem icon={FileSearch} label="Tender analysis" active />
            <NavItem icon={BookOpenCheck} label="Standards library" />
            <NavItem icon={FileCheck2} label="Reports" />
            <NavItem icon={History} label="Audit history" />
          </nav>

          <div className="mx-6 my-6 h-px bg-white/[.08]" />
          <p className="px-6 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Workspace</p>
          <nav className="space-y-1 px-3">
            <NavItem icon={MessageSquareText} label="Review queue" badge="3" />
            <NavItem icon={UserRound} label="Team members" />
            <NavItem icon={Settings} label="Settings" />
          </nav>

          <div className="mt-auto p-4">
            <div className="support-card">
              <div className="flex items-center gap-2 text-white"><CircleHelp size={16} /><span className="text-xs font-semibold">Need an expert?</span></div>
              <p className="mt-2 text-[11px] leading-relaxed text-white/50">Flag uncertain results for standards-team review.</p>
              <button onClick={() => notify("Review request added to the queue")}>Request review <ArrowRight size={12} /></button>
            </div>
            <button className="mt-4 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-saffron text-xs font-bold text-pine">AR</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-white">Ananya Rao</span><span className="block text-[10px] text-white/40">Procurement officer</span></span>
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
            <button className="icon-button" aria-label="Search"><Search size={18} /></button>
            <button className="icon-button relative" aria-label="Notifications"><Bell size={18} /><span className="notification-dot" /></button>
            <div className="mx-1 h-5 w-px bg-[#d9dfda]" />
            <button className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-xs font-semibold hover:bg-black/[.03]"><Globe2 size={16} /> EN <ChevronDown size={13} /></button>
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
              <button className="button-secondary" onClick={() => notify("Demo JSON export prepared")}><FileText size={16} /> Export report</button>
              <button className="button-primary" onClick={() => notify("New analysis workspace opened")}><Plus size={16} /> New analysis</button>
            </div>
          </div>

          <div className="demo-banner">
            <div className="flex items-center gap-2.5"><Sparkles size={15} /><span><strong>Prototype workspace</strong> — all standard names and references below are illustrative placeholders, not verified BIS records.</span></div>
            <button onClick={() => notify("About demo data: no factual standard claims are shown")}>About demo data</button>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.62fr)_minmax(320px,.72fr)]">
            <div className="min-w-0 space-y-5">
              <section className="hero-card animate-fade-up [animation-delay:80ms]">
                <div className="relative z-10 flex flex-col gap-6 p-5 sm:p-7">
                  <div className="flex items-start justify-between gap-3 sm:gap-5">
                    <div className="flex min-w-0 gap-4">
                      <div className="file-emblem"><FileText size={22} /></div>
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2"><span className="status-pill"><CheckCircle2 size={12} /> Analysis complete</span><span className="text-[11px] text-white/40">MS-2026-00428</span></div>
                        <h2 className="truncate text-lg font-semibold tracking-[-0.025em] text-white sm:text-xl">Safety_Helmets_Tender_2026.pdf</h2>
                        <p className="mt-1 text-xs text-white/45">24 pages · Uploaded 14 Sep 2026, 10:42 AM</p>
                      </div>
                    </div>
                    <button className="shrink-0 rounded-xl border border-white/10 p-2 text-white/60 transition hover:bg-white/10 hover:text-white" aria-label="More actions"><MoreHorizontal size={20} /></button>
                  </div>

                  <div className="grid grid-cols-2 gap-4 border-t border-white/10 pt-5 sm:grid-cols-4 sm:gap-3">
                    <div><p className="hero-label">Product identified</p><p className="hero-value">Safety helmets</p></div>
                    <div><p className="hero-label">Recommendations</p><p className="hero-value">4 candidates</p></div>
                    <div><p className="hero-label">Tender gaps</p><p className="hero-value text-[#ffc075]">3 require action</p></div>
                    <div><p className="hero-label">Review status</p><p className="hero-value">Pending</p></div>
                  </div>
                </div>
              </section>

              <section className="panel overflow-hidden animate-fade-up [animation-delay:140ms]">
                <div className="tabs" role="tablist">
                  {[["recommendations", "Recommendations", "4"], ["requirements", "Requirements", "12"], ["gaps", "Tender gaps", "3"]].map(([id, label, count]) => (
                    <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)} role="tab">{label}<span>{count}</span></button>
                  ))}
                </div>

                {tab === "recommendations" && (
                  <div className="p-4 sm:p-6">
                    <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                      <div><h3 className="section-title">Verified recommendation set</h3><p className="section-subtitle">Ranked using relevance, product fit, graph links and rules.</p></div>
                      <button className="filter-button">All types <ChevronDown size={14} /></button>
                    </div>

                    <article className="recommendation-card featured">
                      <div className="flex flex-col gap-5 sm:flex-row">
                        <div className="confidence-ring"><div><strong>94</strong><span>%</span></div><small>Confidence</small></div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2"><span className="type-chip primary">Primary standard</span><span className="type-chip current"><Check size={11} /> Current</span><span className="type-chip demo">Demo ID</span></div>
                          <div className="mt-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                            <div><p className="text-xs font-bold tracking-[.08em] text-pine">IS XXXX : 20XX</p><h4 className="mt-1 text-[17px] font-semibold tracking-[-.02em]">Industrial safety helmets — specification</h4></div>
                            <button className="link-button" onClick={() => notify("Official evidence viewer opened in demo mode")}><Link2 size={14} /> Evidence</button>
                          </div>
                          <p className="mt-3 text-[13px] leading-6 text-[#64726b]">Directly matches the specified product and intended construction-site use. Final applicability must be confirmed against the official BIS catalogue.</p>
                          <div className="mt-4 flex flex-wrap gap-2"><span className="match-chip">Impact protection</span><span className="match-chip">Shell material</span><span className="match-chip">Worksite use</span></div>
                          <div className="mt-5 grid gap-4 border-t border-[#e8ece8] pt-4 sm:grid-cols-3">
                            <div><p className="meta-label">Source status</p><p className="meta-value"><ShieldCheck size={13} /> Verification required</p></div>
                            <div><p className="meta-label">Last checked</p><p className="meta-value"><Clock3 size={13} /> Demo record</p></div>
                            <div><p className="meta-label">Human review</p><p className="meta-value text-[#9b651c]"><UserRound size={13} /> Required</p></div>
                          </div>
                        </div>
                      </div>
                    </article>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <article className="compact-rec">
                        <div className="flex items-start justify-between"><span className="type-chip test">Test method</span><span className="score">87%</span></div>
                        <p className="mt-4 text-xs font-bold tracking-[.08em] text-pine">IS YYYY : 20XX</p><h4 className="mt-1 text-sm font-semibold leading-5">Protective equipment — impact testing</h4>
                        <p className="mt-3 text-xs leading-5 text-[#708078]">Supports verification of the impact-resistance requirement.</p>
                        <button onClick={() => notify("Candidate details opened")}>View rationale <ArrowRight size={13} /></button>
                      </article>
                      <article className="compact-rec">
                        <div className="flex items-start justify-between"><span className="type-chip safety">Safety / marking</span><span className="score medium">79%</span></div>
                        <p className="mt-4 text-xs font-bold tracking-[.08em] text-pine">IS ZZZZ : 20XX</p><h4 className="mt-1 text-sm font-semibold leading-5">Safety marking and user information</h4>
                        <p className="mt-3 text-xs leading-5 text-[#708078]">Potentially relevant to permanent marking and instructions.</p>
                        <button onClick={() => notify("Candidate details opened")}>View rationale <ArrowRight size={13} /></button>
                      </article>
                    </div>

                    <button className="show-more" onClick={() => notify("1 allied candidate shown in full product")}>Show 1 more allied standard <ChevronDown size={14} /></button>
                  </div>
                )}

                {tab === "requirements" && (
                  <div className="p-5 sm:p-7">
                    <h3 className="section-title">Extracted tender requirements</h3><p className="section-subtitle">Structured by the local extraction pipeline for officer confirmation.</p>
                    <div className="mt-6 grid gap-3 sm:grid-cols-2">{requirements.map(([key, value]) => <div className="requirement-row" key={key}><span>{key}</span><strong>{value}</strong><CheckCircle2 size={16} /></div>)}</div>
                    <div className="mt-4 rounded-2xl border border-dashed border-[#cbd5ce] bg-[#f8faf7] p-5 text-center text-sm text-[#65736c]">8 more extracted attributes are available in the complete analysis.</div>
                  </div>
                )}

                {tab === "gaps" && (
                  <div className="p-5 sm:p-7">
                    <h3 className="section-title">Tender quality gaps</h3><p className="section-subtitle">Resolve these items before approving the recommendation set.</p>
                    <div className="mt-5 space-y-3">
                      {[['Missing', 'Impact-test acceptance criteria', 'Add measurable thresholds and the applicable verified test method.'], ['Ambiguous', 'Service-temperature range', 'Specify the minimum and maximum operating temperatures.'], ['Review', 'Certification clause', 'Confirm applicability through the deterministic QCO rule check.']].map(([tag, title, desc], i) => <div className="gap-row" key={title}><span className={`gap-icon g${i}`}><TriangleAlert size={17} /></span><div><div className="flex items-center gap-2"><h4>{title}</h4><span>{tag}</span></div><p>{desc}</p></div><button onClick={() => notify(`Opening correction for: ${title}`)}><ArrowRight size={16} /></button></div>)}
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
                <button className="audit-link" onClick={() => notify("Audit trail opened")}>View full audit trail <ArrowRight size={14} /></button>
              </section>

              <section className="panel overflow-hidden animate-fade-up [animation-delay:240ms]">
                <div className="border-b border-[#e8ece8] p-5 sm:p-6"><div className="flex items-center gap-2"><ShieldCheck size={18} className="text-pine" /><h3 className="text-base font-semibold">Human decision</h3></div><p className="mt-2 text-xs leading-5 text-[#728078]">An authorised officer must review evidence before this result can be used.</p></div>
                <div className="p-5 sm:p-6">
                  <div className="review-summary"><div><span>4</span><small>Candidates</small></div><div><span>3</span><small>Open gaps</small></div><div><span>0</span><small>Resolved</small></div></div>
                  {approved ? (
                    <div className="mt-5 rounded-2xl bg-[#eaf6ee] p-5 text-center"><CheckCircle2 className="mx-auto text-[#287d4d]" size={30} /><p className="mt-2 text-sm font-semibold text-[#1f613d]">Review decision recorded</p><p className="mt-1 text-[11px] text-[#4d7a61]">Saved to the prototype audit trail.</p></div>
                  ) : (
                    <>
                      <label className="mt-5 block text-[11px] font-semibold uppercase tracking-[.12em] text-[#6d7a73]">Reviewer note</label>
                      <textarea className="review-note" placeholder="Add context for your decision…" />
                      <button className="approve-button" onClick={() => setApproved(true)}><CheckCircle2 size={17} /> Approve for report</button>
                      <button className="flag-button" onClick={() => notify("Recommendation set flagged for expert review")}><Flag size={15} /> Flag for expert review</button>
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

      {toast && <div className="toast"><CheckCircle2 size={17} /> {toast}</div>}
    </main>
  );
}
