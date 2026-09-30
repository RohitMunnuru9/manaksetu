"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck, ChevronLeft, ChevronRight, Clock3, FileText, Link2, Loader2,
  Search, Share2, ShieldCheck, TriangleAlert, X,
} from "lucide-react";
import {
  ApiStandard, StandardDetail, StandardsPage,
  getStandardDetail, getStandards, verifyStandard,
} from "../../lib/api";

type Tier = "verified" | "checking" | "example";

function tierOf(standard: { verification_status: string; standard_number: string | null }): Tier {
  if (standard.verification_status === "verified" && standard.standard_number) return "verified";
  return standard.standard_number ? "checking" : "example";
}

const TIER_LABEL: Record<Tier, string> = {
  verified: "Verified",
  checking: "Needs checking",
  example: "Example only",
};

/** The catalogue browser. 2,914 records is too many to scroll, so this pages,
 *  filters by evidence tier and BIS sector, and opens a full record. */
export function CatalogueBrowser({
  canVerify,
  onShowNetwork,
  onNotify,
  t,
}: {
  canVerify: boolean;
  onShowNetwork: (standard: ApiStandard) => void;
  onNotify: (message: string) => void;
  t: (key: string) => string;
}) {
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("");
  const [sector, setSector] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<StandardsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    getStandards({ q: query, tier, sector, page, pageSize: 25 })
      .then(setData)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [query, tier, sector, page]);

  // Debounced, so typing a search term does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(load, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  // Any change to the filters starts again at the first page; staying on
  // page 40 of a filter that now has three results shows an empty screen.
  const changeFilter = (next: () => void) => {
    next();
    setPage(1);
  };

  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  return (
    <>
      <div className="cat-controls">
        <div className="searchbox" style={{ maxWidth: 420 }}>
          <Search size={15} />
          <input
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={e => changeFilter(() => setQuery(e.target.value))}
            aria-label={t("searchPlaceholder")}
          />
          {query && (
            <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => changeFilter(() => setQuery(""))} aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="chipbar" role="group" aria-label={t("filterTier")}>
          {([["", t("tierAll")], ["verified", t("verified")], ["pending", t("checking")], ["demo", t("example")]] as const).map(
            ([value, label]) => (
              <button
                key={value || "all"}
                className={tier === value ? "active" : ""}
                onClick={() => changeFilter(() => setTier(value))}
                aria-pressed={tier === value}
              >
                {label}
                {data?.tier_counts && value && (
                  <span className="chip-count">{data.tier_counts[value] ?? 0}</span>
                )}
              </button>
            ),
          )}
        </div>

        {data?.sectors && data.sectors.length > 0 && (
          <select
            className="select cat-sector"
            value={sector}
            onChange={e => changeFilter(() => setSector(e.target.value))}
            aria-label={t("filterSector")}
          >
            <option value="">{t("allSectors")}</option>
            {data.sectors.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        )}
      </div>

      <p className="cat-count">
        {loading
          ? t("loading")
          : failed
            ? t("catalogueUnreachable")
            : `${total.toLocaleString("en-IN")} ${total === 1 ? t("recordOne") : t("recordMany")}`}
      </p>

      <div className="card card-pad mt-4" style={{ minHeight: 220 }}>
        {loading && !data && (
          <div className="empty"><Loader2 className="spin" size={22} /><span>{t("loading")}</span></div>
        )}

        {failed && (
          <div className="empty">
            <TriangleAlert size={22} />
            <strong>{t("catalogueUnreachable")}</strong>
            <button className="btn btn-ghost btn-sm mt-3" onClick={load}>{t("tryAgain")}</button>
          </div>
        )}

        {!failed && data?.items.map(standard => {
          const which = tierOf(standard);
          return (
            <button
              className="result"
              key={standard.id}
              onClick={() => setOpenId(standard.id)}
              aria-label={`${standard.standard_number ?? standard.catalogue_ref}: ${standard.official_title}`}
            >
              <span className={`ring ${which === "verified" ? "hi" : which === "checking" ? "mid" : "lo"}`}>
                {which === "verified" ? <ShieldCheck size={18} /> : which === "checking" ? <Clock3 size={18} /> : <FileText size={18} />}
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className={`ident ${which === "example" ? "internal" : "real"}`}>
                    {standard.standard_number ?? standard.catalogue_ref ?? "No reference"}
                  </span>
                  <span className={`tag ${which === "verified" ? "green" : which === "checking" ? "amber" : "grey"}`}>
                    {TIER_LABEL[which]}
                  </span>
                  {standard.bis_sector && <span className="tag grey">{standard.bis_sector.slice(0, 34)}</span>}
                </span>
                <h4>{standard.official_title}</h4>
              </span>
              <ChevronRight size={18} className="shrink-0 text-[var(--faint)]" />
            </button>
          );
        })}

        {!loading && !failed && data && data.items.length === 0 && (
          <div className="empty">
            <strong>{t("nothingFound")}</strong>
            <span>{t("nothingFoundHint")}</span>
          </div>
        )}
      </div>

      {!failed && pages > 1 && (
        <div className="pager">
          <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
            <ChevronLeft size={15} /> {t("prev")}
          </button>
          <span className="pager-state">{t("pageOf").replace("{page}", String(page)).replace("{pages}", String(pages))}</span>
          <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage(p => Math.min(pages, p + 1))}>
            {t("next")} <ChevronRight size={15} />
          </button>
        </div>
      )}

      {openId !== null && (
        <StandardPanel
          id={openId}
          canVerify={canVerify}
          onClose={() => setOpenId(null)}
          onVerified={() => { load(); onNotify(t("verifiedDone")); }}
          onShowNetwork={onShowNetwork}
          t={t}
        />
      )}
    </>
  );
}

/** One full record, and — for a standards expert — the control that promotes it. */
function StandardPanel({
  id, canVerify, onClose, onVerified, onShowNetwork, t,
}: {
  id: number;
  canVerify: boolean;
  onClose: () => void;
  onVerified: () => void;
  onShowNetwork: (standard: ApiStandard) => void;
  t: (key: string) => string;
}) {
  const [record, setRecord] = useState<StandardDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setRecord(null);
    setFailed(false);
    getStandardDetail(id).then(setRecord).catch(() => setFailed(true));
  }, [id]);

  // Escape closes, as it does everywhere else.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    if (!record) return;
    setSaving(true);
    setError("");
    verifyStandard(record.id, note)
      .then(updated => { setRecord(updated); onVerified(); })
      .catch(err => setError(err instanceof Error ? err.message : t("verifyFailed")))
      .finally(() => setSaving(false));
  };

  const which = record ? tierOf(record) : "checking";
  const promotable = record && which === "checking";

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-modal="true" aria-label={t("recordDetail")}>
        <header className="panel-head">
          <div className="min-w-0">
            {record && (
              <>
                <span className={`ident ${which === "example" ? "internal" : "real"}`}>
                  {record.standard_number ?? record.catalogue_ref}
                </span>
                <h2 className="mt-2 text-[19px] leading-snug">{record.official_title}</h2>
              </>
            )}
            {!record && !failed && <span className="text-[13px] text-[var(--faint)]">{t("loading")}</span>}
            {failed && <span className="text-[13px] text-[var(--red)]">{t("recordUnreachable")}</span>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        <div className="panel-body">
          {record && (
            <>
              <div className={`notice ${which === "verified" ? "green" : which === "checking" ? "amber" : "plain"}`}>
                {which === "verified" ? <ShieldCheck size={16} className="mt-0.5 shrink-0" /> : <TriangleAlert size={16} className="mt-0.5 shrink-0" />}
                <span>
                  <strong>{TIER_LABEL[which]}.</strong>{" "}
                  {which === "verified"
                    ? record.verified_by
                      ? t("verifiedBy").replace("{name}", record.verified_by).replace("{date}", record.verified_at ? new Date(record.verified_at).toLocaleDateString() : "—")
                      : t("tierVerifiedPlain")
                    : which === "checking"
                      ? t("tierChecking")
                      : t("tierExample")}
                </span>
              </div>

              {record.verification_note && (
                <blockquote className="evidence-quote mt-3">{record.verification_note}</blockquote>
              )}

              <dl className="mt-2">
                {record.bis_sector && <Field label={t("fieldSector")} value={record.bis_sector} />}
                {record.category && <Field label={t("fieldCategory")} value={record.category} />}
                {record.publication_year && <Field label={t("fieldPublished")} value={String(record.publication_year)} />}
                {record.valid_until && (
                  <Field
                    label={t("fieldValidUntil")}
                    value={new Date(record.valid_until).toLocaleDateString()}
                    tone={new Date(record.valid_until) < new Date() ? "warn" : undefined}
                  />
                )}
                <Field label={t("fieldStatus")} value={record.status} />
                {record.superseded_by && <Field label={t("fieldSuperseded")} value={record.superseded_by} tone="warn" />}
                <Field label={t("fieldSource")} value={record.source_organisation ?? "—"} />
                {record.retrieved_date && <Field label={t("fieldRetrieved")} value={new Date(record.retrieved_date).toLocaleDateString()} />}
                <Field label={t("fieldUsedIn")} value={t("usedInTenders").replace("{n}", String(record.used_in_tenders))} />
                <Field label={t("fieldLinked")} value={t("linkedStandards").replace("{n}", String(record.linked_standards))} />
              </dl>

              {record.certification_orders.length > 0 && (
                <div className="notice red mt-3">
                  <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                  <span><strong>{t("certMandatory")}</strong> {record.certification_orders.join("; ")}</span>
                </div>
              )}

              {record.amendments.length > 0 && (
                <div className="mt-4">
                  <p className="label">{t("amendments")}</p>
                  {record.amendments.map(a => (
                    <div className="rowcard" key={a.amendment_number}>
                      <span className="ico warn"><TriangleAlert size={16} /></span>
                      <div className="min-w-0 flex-1">
                        <dd className="font-semibold">{a.amendment_number}{a.issued_date ? ` · ${a.issued_date}` : ""}</dd>
                        {a.summary && <p className="sub">{a.summary}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-5 flex flex-wrap gap-2">
                <button className="btn btn-ghost btn-sm" onClick={() => { onShowNetwork(record as unknown as ApiStandard); onClose(); }}>
                  <Share2 size={14} /> {t("seeConnections")}
                </button>
                {record.official_source_url && (
                  <a className="btn btn-ghost btn-sm" href={record.official_source_url} target="_blank" rel="noopener noreferrer">
                    <Link2 size={14} /> {t("officialPage")}
                  </a>
                )}
              </div>

              {promotable && canVerify && (
                <div className="verify-box">
                  <p className="label" style={{ marginBottom: 6 }}><BadgeCheck size={14} /> {t("verifyTitle")}</p>
                  <p className="section-sub">{t("verifyExplain")}</p>
                  <textarea
                    className="textarea mt-3"
                    style={{ minHeight: 76 }}
                    placeholder={t("verifyNotePlaceholder")}
                    value={note}
                    onChange={e => setNote(e.target.value)}
                  />
                  {error && <p className="mt-2 text-[12px] text-[var(--red)]">{error}</p>}
                  <button className="btn btn-primary mt-3 w-full" onClick={submit} disabled={saving}>
                    {saving ? <><Loader2 className="spin" size={15} /> {t("verifySaving")}</> : <><BadgeCheck size={15} /> {t("verifyAction")}</>}
                  </button>
                  <p className="score-footnote">{t("verifyFootnote")}</p>
                </div>
              )}

              {promotable && !canVerify && (
                <div className="notice plain mt-5">
                  <ShieldCheck size={15} className="mt-0.5 shrink-0" />
                  <span>{t("verifyNeedsExpert")}</span>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd style={tone === "warn" ? { color: "#8a5f1a" } : undefined}>{value}</dd>
    </div>
  );
}
