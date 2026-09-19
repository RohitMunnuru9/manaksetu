"use client";

/* Hand-rolled chart primitives. No chart library: the marks are plain HTML with
   the design system's tokens, which keeps the bundle small and every pixel
   under our control. Rules followed throughout: one hue per single-series
   chart, thin marks with rounded data-ends, 2px gaps between fills, direct
   labels in ink (never in the series colour), and a hover tooltip on every
   mark. Palette validated for contrast and colour-vision separation on the
   cream surface. */

// Validated categorical order — never cycled, never reassigned by rank.
export const CHART = {
  navy: "#4a6fb0",
  rust: "#c05a32",
  green: "#1d8a6a",
  gold: "#b8860b",
};

export function BarList({
  items,
  colour = CHART.navy,
  unit = "",
  emptyText = "Nothing to show yet.",
}: {
  items: Array<{ label: string; sub?: string; value: number }>;
  colour?: string;
  unit?: string;
  emptyText?: string;
}) {
  const max = Math.max(...items.map(i => i.value), 1);
  if (!items.length) return <p className="chart-empty">{emptyText}</p>;
  return (
    <div className="barlist" role="img" aria-label="Bar chart">
      {items.map(item => (
        <div key={item.label} className="barlist-row" title={`${item.label}: ${item.value}${unit}`}>
          <div className="barlist-head">
            <span className="barlist-label">{item.label}</span>
            <span className="barlist-value">{item.value}{unit}</span>
          </div>
          {item.sub && <div className="barlist-sub">{item.sub}</div>}
          <div className="barlist-track">
            <div className="barlist-fill" style={{ width: `${Math.max((item.value / max) * 100, 2)}%`, background: colour }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TierBar({ verified, pending, demo }: { verified: number; pending: number; demo: number }) {
  const total = Math.max(verified + pending + demo, 1);
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <div>
      <div className="tierbar" role="img" aria-label={`${verified} verified, ${pending} imported, ${demo} demonstration`}>
        {verified > 0 && <div className="tierbar-seg" style={{ width: seg(verified), background: CHART.green }} title={`Verified: ${verified}`} />}
        {pending > 0 && <div className="tierbar-seg" style={{ width: seg(pending), background: CHART.navy }} title={`Imported from BIS: ${pending}`} />}
        {demo > 0 && <div className="tierbar-seg" style={{ width: seg(demo), background: "#b9b2a6" }} title={`Demonstration: ${demo}`} />}
      </div>
      <div className="tierbar-legend">
        <span><i style={{ background: CHART.green }} /> Verified by an officer ({verified})</span>
        <span><i style={{ background: CHART.navy }} /> Imported from BIS ({pending})</span>
        <span><i style={{ background: "#b9b2a6" }} /> Demonstration ({demo})</span>
      </div>
    </div>
  );
}

export function Meter({ score, grade }: { score: number; grade: string }) {
  const tone = score >= 85 ? CHART.green : score >= 60 ? CHART.gold : "#a13122";
  return (
    <div className="meter-wrap">
      <div className="meter-num" style={{ color: tone }}>{score}<span>/100</span></div>
      <div className="meter-track" role="img" aria-label={`Specification completeness ${score} out of 100 — ${grade}`}>
        <div className="meter-fill" style={{ width: `${score}%`, background: tone }} />
      </div>
      <div className="meter-grade">{grade}</div>
    </div>
  );
}
