"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import type { AnalysisResult } from "../../lib/api";
import { Meter } from "./charts";

type Card = NonNullable<AnalysisResult["scorecard"]>;

export function ScorecardPanel({ card, t }: { card: Card; t: (key: string) => string }) {
  return (
    <div className="anim-in">
      <div className="score-head">
        <Meter score={card.score} grade={t(gradeKey(card.grade))} />
        <p className="viz-lede" style={{ maxWidth: 520 }}>{t("scoreExplain")}</p>
      </div>
      <table className="score-table">
        <tbody>
          {card.rows.map(row => (
            <tr key={row.key} className={row.satisfied ? "ok" : "miss"}>
              <td className="score-icon">
                {row.satisfied
                  ? <CheckCircle2 size={16} aria-label="present" />
                  : <XCircle size={16} aria-label="missing" />}
              </td>
              <td>
                <div className="score-label">{row.label} <span className="score-weight">{row.weight} pts</span></div>
                {row.satisfied && row.evidence && <div className="score-evidence">“…{row.evidence}…”</div>}
                {!row.satisfied && row.fix && <div className="score-fix">{row.fix}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="score-footnote">{t("scoreFootnote")}</p>
    </div>
  );
}

function gradeKey(grade: string): string {
  if (grade === "ready") return "gradeReady";
  if (grade === "needs work") return "gradeNeedsWork";
  return "gradeIncomplete";
}
