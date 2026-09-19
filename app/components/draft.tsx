"use client";

import { useState } from "react";
import { Check, Copy, FileSignature } from "lucide-react";
import { DraftClauses, getDraft } from "../../lib/api";

export function DraftPanel({ tenderId, t }: { tenderId: number; t: (key: string) => string }) {
  const [draft, setDraft] = useState<DraftClauses | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const generate = () => {
    setBusy(true);
    setFailed(false);
    getDraft(tenderId)
      .then(setDraft)
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  const copy = () => {
    if (!draft) return;
    navigator.clipboard?.writeText(draft.clauses).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => undefined);
  };

  if (!draft) {
    return (
      <div className="draft-cta">
        <button className="btn btn-ghost" onClick={generate} disabled={busy}>
          <FileSignature size={16} /> {busy ? t("draftWorking") : t("draftButton")}
        </button>
        <span className="draft-hint">{t("draftHint")}</span>
        {failed && <span className="draft-hint" style={{ color: "#a13122" }}>{t("draftFailed")}</span>}
      </div>
    );
  }

  if (!draft.clauses) {
    return <p className="chart-empty">{draft.note || t("draftNothing")}</p>;
  }

  return (
    <div className="anim-in">
      <div className="draft-toolbar">
        <span className="draft-source">
          {draft.source === "deterministic" ? t("draftSourceRules") : `${t("draftSourceModel")} (${draft.source})`}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t("draftCopied") : t("draftCopy")}
        </button>
      </div>
      <pre className="draft-text">{draft.clauses}</pre>
      <p className="score-footnote">{t("draftFootnote")}</p>
    </div>
  );
}
