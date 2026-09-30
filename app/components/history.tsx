"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, Clock3, Download, FileSearch, FileText, History as HistoryIcon,
  Loader2, LogIn, ScanLine, Search, ShieldCheck, TriangleAlert, UserCog,
} from "lucide-react";
import {
  AuditEntry, TenderSummary,
  downloadReport, getAuditHistory, getTenders,
} from "../../lib/api";

const LANGUAGE_NAME: Record<string, string> = {
  en: "English", hi: "Hindi", te: "Telugu", ta: "Tamil", bn: "Bengali",
  mr: "Marathi", gu: "Gujarati", pa: "Punjabi", kn: "Kannada", ml: "Malayalam",
};

/** Which icon an audited action deserves. Falls back rather than guessing. */
function iconFor(action: string) {
  if (action.startsWith("user.login")) return LogIn;
  if (action.startsWith("standard.verified")) return ShieldCheck;
  if (action.includes("review")) return CheckCircle2;
  if (action.includes("report") || action.includes("draft")) return Download;
  if (action.includes("document")) return ScanLine;
  if (action.includes("tender")) return FileSearch;
  return UserCog;
}

/** Past analyses, and the trail of who did what. Both were in the API from the
 *  beginning; neither was on screen. */
export function HistoryView({
  canExport,
  onOpenTender,
  onNotify,
  t,
}: {
  canExport: boolean;
  onOpenTender: (id: number) => void;
  onNotify: (message: string) => void;
  t: (key: string) => string;
}) {
  const [tab, setTab] = useState<"tenders" | "trail">("tenders");
  const [tenders, setTenders] = useState<TenderSummary[] | null>(null);
  const [trail, setTrail] = useState<AuditEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    setFailed(false);
    getTenders().then(setTenders).catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    if (tab !== "trail") return;
    getAuditHistory(actionFilter).then(setTrail).catch(() => setTrail([]));
  }, [tab, actionFilter]);

  const shown = useMemo(() => {
    if (!tenders) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return tenders;
    return tenders.filter(
      row =>
        row.title.toLowerCase().includes(needle) ||
        row.reference.toLowerCase().includes(needle) ||
        (row.filename ?? "").toLowerCase().includes(needle),
    );
  }, [tenders, query]);

  const save = (id: number, format: "pdf" | "docx" | "xlsx" | "json") => {
    setBusyId(id);
    downloadReport(id, format)
      .then(() => onNotify(`${format.toUpperCase()} ${t("downloaded")}`))
      .catch(() => onNotify(t("downloadFailed")))
      .finally(() => setBusyId(null));
  };

  return (
    <div className="anim-in">
      <div className="tabs" style={{ paddingLeft: 0 }}>
        <button className={tab === "tenders" ? "active" : ""} onClick={() => setTab("tenders")}>
          {t("pastAnalyses")}
          {tenders && <span className="pill">{tenders.length}</span>}
        </button>
        <button className={tab === "trail" ? "active" : ""} onClick={() => setTab("trail")}>
          {t("auditTrail")}
        </button>
      </div>

      {tab === "tenders" && (
        <>
          <div className="searchbox mt-5" style={{ maxWidth: 420 }}>
            <Search size={15} />
            <input
              placeholder={t("searchTenders")}
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label={t("searchTenders")}
            />
          </div>

          <div className="card card-pad mt-4" style={{ minHeight: 180 }}>
            {!tenders && !failed && <div className="empty"><Loader2 className="spin" size={22} /><span>{t("loading")}</span></div>}
            {failed && <div className="empty"><TriangleAlert size={22} /><strong>{t("historyUnreachable")}</strong></div>}

            {shown.map(row => (
              <div className="tender-row" key={row.id}>
                <span className="ring mid" style={{ width: 44, height: 44 }}>
                  {row.filename ? <FileText size={17} /> : <FileSearch size={17} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="ident real">{row.reference}</span>
                    {row.language !== "en" && <span className="tag grey">{LANGUAGE_NAME[row.language] ?? row.language}</span>}
                    {row.read_quality && row.read_quality !== "digital" && (
                      <span className={`tag ${row.read_quality === "good" ? "grey" : "amber"}`}>
                        <ScanLine size={11} /> {row.read_confidence ? `${Math.round(row.read_confidence)}%` : t("scanned")}
                      </span>
                    )}
                    {row.status === "approved" && <span className="tag green">{t("approved")}</span>}
                  </div>
                  <h4 className="tender-title">{row.title}</h4>
                  <p className="sub">
                    <Clock3 size={12} /> {new Date(row.created_at).toLocaleString()}
                    {row.filename && ` · ${row.filename.replace(/^[0-9a-f]{32}_/, "")}`}
                  </p>
                </div>
                <div className="tender-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => onOpenTender(row.id)}>{t("openIt")}</button>
                  {canExport && (
                    <select
                      className="select tender-export"
                      value=""
                      disabled={busyId === row.id}
                      onChange={e => { if (e.target.value) save(row.id, e.target.value as "pdf"); e.target.value = ""; }}
                      aria-label={t("download")}
                    >
                      <option value="">{busyId === row.id ? t("working") : t("download")}</option>
                      <option value="pdf">PDF</option>
                      <option value="docx">Word</option>
                      <option value="xlsx">Excel</option>
                      <option value="json">JSON</option>
                    </select>
                  )}
                </div>
              </div>
            ))}

            {tenders && shown.length === 0 && (
              <div className="empty">
                <strong>{query ? t("nothingFound") : t("noAnalysesYet")}</strong>
                <span>{query ? t("nothingFoundHint") : t("noAnalysesHint")}</span>
              </div>
            )}
          </div>
        </>
      )}

      {tab === "trail" && (
        <>
          <div className="chipbar mt-5">
            {([["", t("allActions")], ["tender", t("filterTenders")], ["standard.verified", t("filterVerifications")],
               ["review", t("filterReviews")], ["user.login", t("filterSignIns")]] as const).map(([value, label]) => (
              <button
                key={value || "all"}
                className={actionFilter === value ? "active" : ""}
                onClick={() => { setActionFilter(value); setTrail(null); }}
                aria-pressed={actionFilter === value}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="card card-pad mt-4" style={{ minHeight: 180 }}>
            {!trail && <div className="empty"><Loader2 className="spin" size={22} /><span>{t("loading")}</span></div>}
            {trail?.map(entry => {
              const Icon = iconFor(entry.action);
              const detailText = Object.entries(entry.details ?? {})
                .filter(([, value]) => value !== "" && value !== null && value !== undefined)
                .map(([key, value]) => `${key.replaceAll("_", " ")}: ${String(value).slice(0, 80)}`)
                .join(" · ");
              return (
                <div className="audit-row" key={entry.id}>
                  <span className="ico"><Icon size={16} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="audit-head">
                      <strong>{entry.action.replaceAll(".", " ").replaceAll("_", " ")}</strong>
                      <span className="audit-when">{new Date(entry.created_at).toLocaleString()}</span>
                    </div>
                    <p className="audit-who">
                      {entry.actor_name
                        ? <>{entry.actor_name} <span className="audit-role">{(entry.actor_role ?? "").replaceAll("_", " ")}</span></>
                        : t("systemActor")}
                      {entry.entity_type && ` · ${entry.entity_type} ${entry.entity_id}`}
                    </p>
                    {detailText && <p className="audit-detail">{detailText}</p>}
                  </div>
                </div>
              );
            })}
            {trail && trail.length === 0 && (
              <div className="empty"><HistoryIcon size={22} /><strong>{t("nothingRecorded")}</strong></div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
