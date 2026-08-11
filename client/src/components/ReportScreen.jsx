import React from "react";

function Field({ label, value }) {
  return (
    <div className="report-field">
      <span className="report-field-label">{label}</span>
      <span className="report-field-value">{value && value.length ? value : "\u2014"}</span>
    </div>
  );
}

const COMPLETENESS_COPY = {
  complete: { label: "Complete intake", tone: "complete" },
  partial: { label: "Partial intake", tone: "partial" },
  minimal: { label: "Minimal information", tone: "minimal" },
};

export default function ReportScreen({ report, onRestart }) {
  if (!report) return null;

  const completeness = COMPLETENESS_COPY[report.call_completeness] || COMPLETENESS_COPY.partial;
  const symptoms = report.key_symptoms || [];
  const flags = report.follow_up_flags || [];

  return (
    <div className="report-screen">
      <div className="report-card">
        <div className="report-card-header">
          <div>
            <div className="report-eyebrow">Health check-in summary</div>
            <h1 className="report-title">{report.caller_name || "Caller"}</h1>
          </div>
          <span className={`completeness-pill ${completeness.tone}`}>{completeness.label}</span>
        </div>

        <p className="report-summary">{report.summary}</p>

        <div className="report-grid">
          <Field label="Main concern" value={report.main_concern} />
          <Field label="Duration" value={report.duration} />
          <Field label="Severity" value={report.severity} />
        </div>

        <div className="report-section">
          <span className="report-field-label">Related symptoms</span>
          {symptoms.length ? (
            <ul className="chip-list">
              {symptoms.map((s, i) => (
                <li key={i} className="chip">
                  {s}
                </li>
              ))}
            </ul>
          ) : (
            <p className="report-empty">None mentioned</p>
          )}
        </div>

        <div className="report-section">
          <span className="report-field-label">Flagged for follow-up</span>
          {flags.length ? (
            <ul className="flag-list">
              {flags.map((f, i) => (
                <li key={i} className="flag-item">
                  {f}
                </li>
              ))}
            </ul>
          ) : (
            <p className="report-empty">Nothing flagged</p>
          )}
        </div>
      </div>

      <button className="restart-btn" onClick={onRestart} type="button">
        Start a new call
      </button>
    </div>
  );
}
