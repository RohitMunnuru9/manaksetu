"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Clock3, Database, Languages, TrendingUp } from "lucide-react";
import { Analytics, getAnalytics } from "../../lib/api";
import { BarList, CHART, TierBar } from "./charts";

const LANG_LABEL: Record<string, string> = { en: "English", hi: "Hindi", te: "Telugu", ta: "Tamil" };

const ISSUE_TONE: Record<string, string> = {
  superseded: "#a13122",
  "review due": CHART.gold,
};

export function AnalyticsView({ t }: { t: (key: string) => string }) {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getAnalytics().then(setData).catch(() => setError(true));
  }, []);

  if (error) return <p className="chart-empty">The analytics service could not be reached.</p>;
  if (!data) return <p className="chart-empty">Loading analytics…</p>;

  const languages = Object.entries(data.tenders_by_language)
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => ({ label: LANG_LABEL[code] ?? code.toUpperCase(), value: count }));

  return (
    <div className="anim-in">
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-big">{data.total_standards.toLocaleString("en-IN")}</div>
          <div className="stat-cap"><Database size={13} /> {t("statCatalogue")}</div>
          <div className="stat-note">{t("statCatalogueNote")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-big">{data.total_tenders}</div>
          <div className="stat-cap"><TrendingUp size={13} /> {t("statTenders")}</div>
          <div className="stat-note">{t("statTendersNote")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-big" style={{ color: CHART.rust }}>Zero</div>
          <div className="stat-cap">{t("statInvented")}</div>
          <div className="stat-note">{t("statInventedNote")}</div>
        </div>
        <div className="stat-card">
          <div className="stat-big" style={{ color: data.expiring_within_180_days ? CHART.gold : undefined }}>
            {data.expiring_within_180_days}
          </div>
          <div className="stat-cap"><Clock3 size={13} /> {t("statExpiring")}</div>
          <div className="stat-note">{t("statExpiringNote")}</div>
        </div>
      </div>

      <div className="viz-panel">
        <h3>{t("evidenceMix")}</h3>
        <p className="viz-lede">{t("evidenceMixLede")}</p>
        <TierBar verified={data.verified_standards} pending={data.pending_standards} demo={data.demo_records} />
      </div>

      <div className="split-2">
        <div className="viz-panel">
          <h3>{t("topStandards")}</h3>
          <p className="viz-lede">{t("topStandardsLede")}</p>
          <BarList
            colour={CHART.navy}
            items={data.top_standards.map(row => ({ label: row.identifier, sub: row.title, value: row.count }))}
            emptyText="No analyses recorded yet."
          />
        </div>
        <div className="viz-panel">
          <h3><Languages size={15} /> {t("langMix")}</h3>
          <p className="viz-lede">{t("langMixLede")}</p>
          <BarList colour={CHART.green} items={languages} emptyText="No analyses recorded yet." />
          <h3 style={{ marginTop: 18 }}>{t("topSectors")}</h3>
          <BarList
            colour={CHART.rust}
            items={data.top_sectors.slice(0, 6).map(row => ({ label: row.name, value: row.count }))}
            emptyText="Sector data arrives with the BIS import."
          />
        </div>
      </div>

      <div className="viz-panel">
        <h3><AlertTriangle size={15} /> {t("watchTitle")}</h3>
        <p className="viz-lede">{t("watchLede")}</p>
        {data.watch.length === 0 ? (
          <p className="chart-empty">{t("watchClear")}</p>
        ) : (
          <table className="watch-table">
            <thead>
              <tr><th>{t("watchStandard")}</th><th>{t("watchIssue")}</th><th>{t("watchDetail")}</th></tr>
            </thead>
            <tbody>
              {data.watch.map(item => (
                <tr key={`${item.standard_id}-${item.issue}`}>
                  <td><strong className="mono">{item.identifier}</strong><div className="watch-sub">{item.title}</div></td>
                  <td>
                    <span className="watch-issue" style={{ color: ISSUE_TONE[item.issue] ?? "#6b6353" }}>
                      <AlertTriangle size={12} /> {item.issue}
                    </span>
                  </td>
                  <td className="watch-detail">{item.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
