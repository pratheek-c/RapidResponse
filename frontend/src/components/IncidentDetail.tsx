import { useState, useEffect, useRef } from "react";
import type {
  Incident,
  TranscriptionTurn,
  Unit,
  Dispatch,
  IncidentReport,
  DispatchAction,
  DispatchQuestion,
  IncidentUnit,
  ExtractionData,
  EscalationSuggestion,
  Department,
} from "@/types";
import { PriorityBadge, StatusBadge, TypeChip } from "./Badges";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 1.5,
        color: "#888",
        textTransform: "uppercase",
        marginBottom: 8,
        paddingBottom: 4,
        borderBottom: "1px solid #e5e5e5",
      }}
    >
      {title}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Extraction panel
// ---------------------------------------------------------------------------

function ExtractionPanel({ data }: { data: ExtractionData }) {
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== "");
  if (entries.length === 0) return null;
  return (
    <div
      style={{
        border: "1px solid #d0e8ff",
        borderRadius: 5,
        padding: "10px 14px",
        marginBottom: 18,
        background: "#f5faff",
      }}
    >
      <SectionHeader title="AI Extraction (Live)" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "4px 12px",
          fontSize: 12,
        }}
      >
        {entries.map(([key, val]) => (
          <div key={key}>
            <span style={{ color: "#666", marginRight: 4, textTransform: "capitalize" }}>
              {key.replace(/_/g, " ")}:
            </span>
            <span style={{ color: "#000", fontWeight: 600 }}>{String(val)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Escalation banner
// ---------------------------------------------------------------------------

function EscalationBanner({
  suggestion,
  onEscalate,
  escalating,
}: {
  suggestion: EscalationSuggestion;
  onEscalate: () => void;
  escalating: boolean;
}) {
  return (
    <div
      style={{
        border: "2px solid #000",
        borderRadius: 5,
        padding: "10px 14px",
        marginBottom: 18,
        background: "#fff8e1",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 1,
            textTransform: "uppercase",
            marginBottom: 3,
            color: "#000",
          }}
        >
          Escalation Suggested
        </div>
        <div style={{ fontSize: 12, color: "#333", marginBottom: 4 }}>
          {suggestion.reason}
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {suggestion.suggested_units.map((u) => (
            <span
              key={u}
              style={{
                fontSize: 10,
                fontWeight: 700,
                background: "#000",
                color: "#fff",
                borderRadius: 3,
                padding: "1px 6px",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                fontFamily: "monospace",
              }}
            >
              {u}
            </span>
          ))}
        </div>
      </div>
      <button
        onClick={onEscalate}
        disabled={escalating}
        style={{
          background: "#000",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          padding: "7px 16px",
          fontSize: 12,
          cursor: escalating ? "not-allowed" : "pointer",
          fontWeight: 700,
          letterSpacing: 0.5,
          flexShrink: 0,
          opacity: escalating ? 0.6 : 1,
        }}
      >
        {escalating ? "Escalating…" : "Escalate"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  incident: Incident;
  units: Unit[];
  onDispatch: (incidentId: string, unitIds: string[], officerId: string) => Promise<void>;
  extraction: ExtractionData | null;
  escalation: EscalationSuggestion | null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IncidentDetail({
  incident,
  units,
  onDispatch,
  extraction,
  escalation,
}: Props) {
  const [turns, setTurns] = useState<TranscriptionTurn[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [incidentUnits, setIncidentUnits] = useState<IncidentUnit[]>([]);
  const [actions, setActions] = useState<DispatchAction[]>([]);
  const [questions, setQuestions] = useState<DispatchQuestion[]>([]);
  const [report, setReport] = useState<IncidentReport | null>(null);

  // Dispatch accept form
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const [officerId, setOfficerId] = useState("");
  const [dispatching, setDispatching] = useState(false);

  // Question form
  const [questionText, setQuestionText] = useState("");
  const [askingQuestion, setAskingQuestion] = useState(false);

  // Escalate
  const [escalating, setEscalating] = useState(false);

  // Complete
  const [completing, setCompleting] = useState(false);
  const [officerNotes, setOfficerNotes] = useState("");
  const [showCompleteForm, setShowCompleteForm] = useState(false);

  // Save report
  const [savingReport, setSavingReport] = useState(false);
  const [reportSummaryDraft, setReportSummaryDraft] = useState("");
  const [showSaveReport, setShowSaveReport] = useState(false);

  const [activeTab, setActiveTab] = useState<"report" | "transcript" | "actions">("report");

  // Track last fetched incident id to avoid duplicate fetch
  const lastFetchedId = useRef<string>("");

  useEffect(() => {
    if (lastFetchedId.current === incident.id) return;
    lastFetchedId.current = incident.id;

    setTurns([]);
    setDispatches([]);
    setIncidentUnits([]);
    setActions([]);
    setQuestions([]);
    setReport(null);
    setSelectedUnitIds([]);
    setOfficerId("");
    setQuestionText("");
    setOfficerNotes("");
    setShowCompleteForm(false);
    setShowSaveReport(false);
    setActiveTab("report");

    // fetch transcript turns
    fetch(`${API_BASE}/incidents/${incident.id}/transcript`)
      .then((r) => r.json())
      .then((j: { ok: boolean; data: TranscriptionTurn[] }) => {
        if (j.ok) setTurns(j.data);
      })
      .catch(() => undefined);

    // fetch legacy dispatches
    fetch(`${API_BASE}/dispatch/${incident.id}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; data: Dispatch[] }) => {
        if (j.ok) setDispatches(j.data);
      })
      .catch(() => undefined);

    // fetch incident units
    fetch(`${API_BASE}/incidents/${incident.id}/units`)
      .then((r) => r.json())
      .then((j: { ok: boolean; data: IncidentUnit[] }) => {
        if (j.ok) setIncidentUnits(j.data);
      })
      .catch(() => undefined);

    // fetch dispatch actions
    fetch(`${API_BASE}/incidents/${incident.id}/actions`)
      .then((r) => r.json())
      .then((j: { ok: boolean; data: DispatchAction[] }) => {
        if (j.ok) setActions(j.data);
      })
      .catch(() => undefined);

    // fetch dispatch questions
    fetch(`${API_BASE}/incidents/${incident.id}/questions`)
      .then((r) => r.json())
      .then((j: { ok: boolean; data: DispatchQuestion[] }) => {
        if (j.ok) setQuestions(j.data);
      })
      .catch(() => undefined);

    // fetch AI-generated report
    fetch(`${API_BASE}/report/${incident.id}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; data: IncidentReport }) => {
        if (j.ok) setReport(j.data);
      })
      .catch(() => undefined);
  }, [incident.id]);

  // Re-fetch questions when an answer_update SSE fires would normally come
  // through the parent via the incidents hook; here we poll lightly on interval
  // only when the incident is active/classified.
  useEffect(() => {
    const isLive =
      incident.status === "active" || incident.status === "classified";
    if (!isLive) return;
    const timer = setInterval(() => {
      fetch(`${API_BASE}/incidents/${incident.id}/questions`)
        .then((r) => r.json())
        .then((j: { ok: boolean; data: DispatchQuestion[] }) => {
          if (j.ok) setQuestions(j.data);
        })
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [incident.id, incident.status]);

  const availableUnits = units.filter((u) => u.status === "available");

  const isDispatchable =
    incident.status === "active" || incident.status === "classified";
  const isActive = incident.status === "active" || incident.status === "classified";
  const canComplete =
    incident.status === "dispatched" ||
    incident.status === "en_route" ||
    incident.status === "on_scene";

  // ---- Handlers ----

  const handleAccept = async () => {
    if (selectedUnitIds.length === 0) return;
    setDispatching(true);
    try {
      await onDispatch(incident.id, selectedUnitIds, officerId);
      // Refresh incident units
      const r = await fetch(`${API_BASE}/incidents/${incident.id}/units`);
      const j = (await r.json()) as { ok: boolean; data: IncidentUnit[] };
      if (j.ok) setIncidentUnits(j.data);
    } catch {
      // non-fatal
    }
    setDispatching(false);
    setSelectedUnitIds([]);
    setOfficerId("");
  };

  const handleQuestion = async () => {
    const q = questionText.trim();
    if (!q) return;
    setAskingQuestion(true);
    try {
      const res = await fetch(`${API_BASE}/dispatch/question`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_id: incident.id,
          question: q,
          officer_id: officerId || "dispatcher",
        }),
      });
      if (res.ok) {
        setQuestionText("");
        // Refresh questions
        const r = await fetch(`${API_BASE}/incidents/${incident.id}/questions`);
        const j = (await r.json()) as { ok: boolean; data: DispatchQuestion[] };
        if (j.ok) setQuestions(j.data);
      }
    } catch {
      // non-fatal
    }
    setAskingQuestion(false);
  };

  const handleEscalate = async () => {
    if (!escalation) return;
    setEscalating(true);
    try {
      await fetch(`${API_BASE}/dispatch/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_id: incident.id,
          reason: escalation.reason,
          requested_unit_types: escalation.suggested_units as Department[],
        }),
      });
    } catch {
      // non-fatal
    }
    setEscalating(false);
  };

  const handleComplete = async () => {
    setCompleting(true);
    try {
      await fetch(`${API_BASE}/dispatch/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_id: incident.id,
          officer_notes: officerNotes || undefined,
        }),
      });
      setShowCompleteForm(false);
    } catch {
      // non-fatal
    }
    setCompleting(false);
  };

  const handleSaveReport = async () => {
    const s = reportSummaryDraft.trim();
    if (!s) return;
    setSavingReport(true);
    try {
      await fetch(`${API_BASE}/dispatch/save-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_id: incident.id,
          summary: s,
        }),
      });
      setShowSaveReport(false);
    } catch {
      // non-fatal
    }
    setSavingReport(false);
  };

  const toggleUnitSelection = (unitId: string) => {
    setSelectedUnitIds((prev) =>
      prev.includes(unitId) ? prev.filter((id) => id !== unitId) : [...prev, unitId]
    );
  };

  return (
    <div style={{ padding: "20px 24px", background: "#fff", minHeight: "100%" }}>
      {/* ------------------------------------------------------------------ */}
      {/* Header */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginBottom: 18,
          flexWrap: "wrap",
          borderBottom: "2px solid #000",
          paddingBottom: 14,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 800,
            color: "#000",
            letterSpacing: -0.3,
            fontFamily: "monospace",
          }}
        >
          INC-{incident.id.slice(0, 8).toUpperCase()}
        </h2>
        <StatusBadge status={incident.status} />
        {incident.priority && <PriorityBadge priority={incident.priority} />}
        {incident.type && <TypeChip type={incident.type} />}
        {incident.escalated === 1 && (
          <span
            style={{
              fontSize: 10,
              background: "#000",
              color: "#fff",
              borderRadius: 3,
              padding: "2px 7px",
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            ESCALATED
          </span>
        )}
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "#999",
            fontFamily: "monospace",
          }}
        >
          {new Date(incident.created_at).toLocaleString()}
        </span>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Metadata grid */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "6px 16px",
          marginBottom: 18,
          fontSize: 12,
        }}
      >
        <div>
          <span style={{ color: "#888", marginRight: 4 }}>Location:</span>
          <span style={{ color: "#111", fontWeight: 600 }}>
            {incident.caller_address || incident.caller_location}
          </span>
        </div>
        <div>
          <span style={{ color: "#888", marginRight: 4 }}>Caller:</span>
          <span style={{ color: "#111", fontFamily: "monospace" }}>{incident.caller_id}</span>
        </div>
        {incident.accepted_at && (
          <div>
            <span style={{ color: "#888", marginRight: 4 }}>Accepted:</span>
            <span style={{ color: "#111" }}>
              {new Date(incident.accepted_at).toLocaleTimeString()}
            </span>
          </div>
        )}
        {incident.resolved_at && (
          <div>
            <span style={{ color: "#888", marginRight: 4 }}>Resolved:</span>
            <span style={{ color: "#111" }}>
              {new Date(incident.resolved_at).toLocaleString()}
            </span>
          </div>
        )}
        {incident.completed_at && (
          <div>
            <span style={{ color: "#888", marginRight: 4 }}>Completed:</span>
            <span style={{ color: "#111" }}>
              {new Date(incident.completed_at).toLocaleString()}
            </span>
          </div>
        )}
        {incident.officer_id && (
          <div>
            <span style={{ color: "#888", marginRight: 4 }}>Officer:</span>
            <span style={{ color: "#111", fontFamily: "monospace" }}>{incident.officer_id}</span>
          </div>
        )}
      </div>

      {/* AI summary */}
      {incident.summary && (
        <div
          style={{
            background: "#f7f7f7",
            border: "1px solid #e0e0e0",
            borderRadius: 5,
            padding: "10px 14px",
            marginBottom: 18,
            fontSize: 13,
            color: "#222",
            lineHeight: 1.6,
          }}
        >
          <span style={{ fontWeight: 700, color: "#000", marginRight: 6 }}>Summary:</span>
          {incident.summary}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Live extraction panel */}
      {/* ------------------------------------------------------------------ */}
      {extraction && isActive && <ExtractionPanel data={extraction} />}

      {/* ------------------------------------------------------------------ */}
      {/* Escalation suggestion banner */}
      {/* ------------------------------------------------------------------ */}
      {escalation && isActive && (
        <EscalationBanner
          suggestion={escalation}
          onEscalate={() => void handleEscalate()}
          escalating={escalating}
        />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Dispatch / Accept panel */}
      {/* ------------------------------------------------------------------ */}
      {isDispatchable && (
        <div
          style={{
            border: "1px solid #ccc",
            borderRadius: 5,
            padding: "12px 14px",
            marginBottom: 18,
          }}
        >
          <SectionHeader title="Assign & Accept" />

          {/* Officer ID input */}
          <input
            type="text"
            value={officerId}
            onChange={(e) => setOfficerId(e.target.value)}
            placeholder="Officer / badge ID (optional)"
            style={{
              width: "100%",
              boxSizing: "border-box",
              border: "1px solid #d0d0d0",
              borderRadius: 4,
              padding: "6px 10px",
              fontSize: 12,
              background: "#fafafa",
              color: "#111",
              outline: "none",
              marginBottom: 8,
            }}
          />

          {/* Unit multi-select */}
          {availableUnits.length === 0 ? (
            <p style={{ fontSize: 12, color: "#aaa", margin: "0 0 8px" }}>
              No available units.
            </p>
          ) : (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginBottom: 8,
              }}
            >
              {availableUnits.map((u) => {
                const selected = selectedUnitIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    onClick={() => toggleUnitSelection(u.id)}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: "monospace",
                      border: selected ? "2px solid #000" : "1px solid #ccc",
                      borderRadius: 4,
                      background: selected ? "#000" : "#fff",
                      color: selected ? "#fff" : "#333",
                      cursor: "pointer",
                      letterSpacing: 0.5,
                    }}
                  >
                    {u.unit_code}
                  </button>
                );
              })}
            </div>
          )}

          <button
            onClick={() => void handleAccept()}
            disabled={selectedUnitIds.length === 0 || dispatching}
            style={{
              background: selectedUnitIds.length > 0 ? "#000" : "#e0e0e0",
              color: selectedUnitIds.length > 0 ? "#fff" : "#999",
              border: "none",
              borderRadius: 4,
              padding: "6px 18px",
              fontSize: 12,
              cursor: selectedUnitIds.length > 0 && !dispatching ? "pointer" : "not-allowed",
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            {dispatching ? "Accepting…" : `Accept (${selectedUnitIds.length} unit${selectedUnitIds.length === 1 ? "" : "s"})`}
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Ask a question panel */}
      {/* ------------------------------------------------------------------ */}
      {isActive && (
        <div
          style={{
            border: "1px solid #ccc",
            borderRadius: 5,
            padding: "12px 14px",
            marginBottom: 18,
          }}
        >
          <SectionHeader title="Ask via AI" />
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleQuestion();
                }
              }}
              placeholder="Ask the caller a question via Nova…"
              style={{
                flex: 1,
                border: "1px solid #d0d0d0",
                borderRadius: 4,
                padding: "6px 10px",
                fontSize: 12,
                background: "#fafafa",
                color: "#111",
                outline: "none",
              }}
            />
            <button
              onClick={() => void handleQuestion()}
              disabled={!questionText.trim() || askingQuestion}
              style={{
                background: questionText.trim() ? "#000" : "#e0e0e0",
                color: questionText.trim() ? "#fff" : "#999",
                border: "none",
                borderRadius: 4,
                padding: "6px 14px",
                fontSize: 12,
                cursor: questionText.trim() && !askingQuestion ? "pointer" : "not-allowed",
                fontWeight: 700,
                letterSpacing: 0.5,
              }}
            >
              {askingQuestion ? "Asking…" : "Ask"}
            </button>
          </div>

          {/* Questions + answers */}
          {questions.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {questions.map((q) => (
                <div
                  key={q.id}
                  style={{
                    background: "#f7f7f7",
                    border: "1px solid #e5e5e5",
                    borderRadius: 4,
                    padding: "7px 10px",
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 600, color: "#000", marginBottom: q.answer ? 3 : 0 }}>
                    Q: {q.refined_question ?? q.question}
                  </div>
                  {q.answer ? (
                    <div style={{ color: "#444", borderTop: "1px solid #eee", paddingTop: 3 }}>
                      A: {q.answer}
                    </div>
                  ) : (
                    <div style={{ color: "#aaa", fontStyle: "italic" }}>Awaiting answer…</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Complete / Save report actions */}
      {/* ------------------------------------------------------------------ */}
      {canComplete && (
        <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
          <button
            onClick={() => setShowCompleteForm((v) => !v)}
            style={{
              background: "#000",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              padding: "6px 16px",
              fontSize: 12,
              cursor: "pointer",
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            Complete Incident
          </button>
          <button
            onClick={() => {
              setReportSummaryDraft(incident.summary ?? "");
              setShowSaveReport((v) => !v);
            }}
            style={{
              background: "#fff",
              color: "#000",
              border: "1px solid #000",
              borderRadius: 4,
              padding: "6px 16px",
              fontSize: 12,
              cursor: "pointer",
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            Save Report
          </button>
        </div>
      )}

      {showCompleteForm && canComplete && (
        <div
          style={{
            border: "1px solid #ccc",
            borderRadius: 5,
            padding: "12px 14px",
            marginBottom: 18,
          }}
        >
          <SectionHeader title="Close Incident" />
          <textarea
            value={officerNotes}
            onChange={(e) => setOfficerNotes(e.target.value)}
            placeholder="Officer notes (optional)"
            rows={3}
            style={{
              width: "100%",
              boxSizing: "border-box",
              border: "1px solid #d0d0d0",
              borderRadius: 4,
              padding: "6px 10px",
              fontSize: 12,
              background: "#fafafa",
              color: "#111",
              outline: "none",
              resize: "vertical",
              marginBottom: 8,
            }}
          />
          <button
            onClick={() => void handleComplete()}
            disabled={completing}
            style={{
              background: "#000",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              padding: "6px 18px",
              fontSize: 12,
              cursor: completing ? "not-allowed" : "pointer",
              fontWeight: 700,
              letterSpacing: 0.5,
              opacity: completing ? 0.6 : 1,
            }}
          >
            {completing ? "Completing…" : "Confirm Complete"}
          </button>
        </div>
      )}

      {showSaveReport && canComplete && (
        <div
          style={{
            border: "1px solid #ccc",
            borderRadius: 5,
            padding: "12px 14px",
            marginBottom: 18,
          }}
        >
          <SectionHeader title="Save Report Summary" />
          <textarea
            value={reportSummaryDraft}
            onChange={(e) => setReportSummaryDraft(e.target.value)}
            placeholder="Incident summary for the report…"
            rows={4}
            style={{
              width: "100%",
              boxSizing: "border-box",
              border: "1px solid #d0d0d0",
              borderRadius: 4,
              padding: "6px 10px",
              fontSize: 12,
              background: "#fafafa",
              color: "#111",
              outline: "none",
              resize: "vertical",
              marginBottom: 8,
            }}
          />
          <button
            onClick={() => void handleSaveReport()}
            disabled={savingReport || !reportSummaryDraft.trim()}
            style={{
              background: reportSummaryDraft.trim() ? "#000" : "#e0e0e0",
              color: reportSummaryDraft.trim() ? "#fff" : "#999",
              border: "none",
              borderRadius: 4,
              padding: "6px 18px",
              fontSize: 12,
              cursor:
                reportSummaryDraft.trim() && !savingReport ? "pointer" : "not-allowed",
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            {savingReport ? "Saving…" : "Save Report"}
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Dispatched units (incident_units table) */}
      {/* ------------------------------------------------------------------ */}
      {incidentUnits.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <SectionHeader title="Assigned Units" />
          {incidentUnits.map((u) => {
            const unit = units.find((uu) => uu.id === u.unit_id);
            return (
              <div
                key={u.id}
                style={{
                  fontSize: 12,
                  color: "#333",
                  padding: "5px 0",
                  borderBottom: "1px solid #f0f0f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span style={{ fontWeight: 600, fontFamily: "monospace" }}>
                  {unit?.unit_code ?? u.unit_id.slice(0, 8)}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    background:
                      u.status === "on_scene"
                        ? "#000"
                        : u.status === "en_route"
                        ? "#444"
                        : "#e0e0e0",
                    color:
                      u.status === "on_scene" || u.status === "en_route" ? "#fff" : "#555",
                    borderRadius: 3,
                    padding: "1px 6px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  {u.status.replace("_", " ")}
                </span>
                <span style={{ color: "#888", fontFamily: "monospace", marginLeft: "auto" }}>
                  {new Date(u.dispatched_at).toLocaleTimeString()}
                  {u.arrived_at && (
                    <span style={{ color: "#333", marginLeft: 8 }}>
                      · on scene {new Date(u.arrived_at).toLocaleTimeString()}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Legacy dispatches (fallback) */}
      {dispatches.length > 0 && incidentUnits.length === 0 && (
        <div style={{ marginBottom: 18 }}>
          <SectionHeader title="Dispatched Units" />
          {dispatches.map((d) => {
            const unit = units.find((u) => u.id === d.unit_id);
            return (
              <div
                key={d.id}
                style={{
                  fontSize: 12,
                  color: "#333",
                  padding: "5px 0",
                  borderBottom: "1px solid #f0f0f0",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontWeight: 600 }}>
                  {unit?.unit_code ?? d.unit_id.slice(0, 8)}
                </span>
                <span style={{ color: "#888", fontFamily: "monospace" }}>
                  dispatched {new Date(d.dispatched_at).toLocaleTimeString()}
                  {d.arrived_at && (
                    <span style={{ color: "#333", marginLeft: 8 }}>
                      · arrived {new Date(d.arrived_at).toLocaleTimeString()}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Tabs: Report / Transcript / Actions */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ display: "flex", borderBottom: "2px solid #e5e5e5", marginBottom: 16 }}>
        {(["report", "transcript", "actions"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 20px",
              fontSize: 12,
              fontWeight: activeTab === tab ? 700 : 500,
              background: "none",
              border: "none",
              borderBottom: activeTab === tab ? "2px solid #000" : "2px solid transparent",
              marginBottom: -2,
              color: activeTab === tab ? "#000" : "#888",
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            {tab === "report" ? "AI Report" : tab === "transcript" ? "Transcript" : "Actions"}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* AI Report tab */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === "report" && (
        <div>
          {!report ? (
            <p style={{ color: "#aaa", fontSize: 13 }}>
              No report generated yet.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Summary */}
              <div>
                <SectionHeader title="Summary" />
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: "#222",
                    lineHeight: 1.6,
                    background: "#f7f7f7",
                    border: "1px solid #eee",
                    borderRadius: 4,
                    padding: "10px 12px",
                  }}
                >
                  {report.summary}
                </p>
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 4, fontFamily: "monospace" }}>
                  Generated: {new Date(report.generated_at).toLocaleString()}
                </div>
              </div>

              {/* Caller details */}
              {report.caller_details && (
                <div>
                  <SectionHeader title="Caller Details" />
                  <p style={{ margin: 0, fontSize: 13, color: "#444", lineHeight: 1.5 }}>
                    {report.caller_details}
                  </p>
                </div>
              )}

              {/* Recommended actions */}
              {report.recommended_actions.length > 0 && (
                <div>
                  <SectionHeader title="Recommended Actions" />
                  <ol style={{ margin: 0, padding: "0 0 0 18px" }}>
                    {report.recommended_actions.map((action, i) => (
                      <li
                        key={i}
                        style={{ fontSize: 13, color: "#222", marginBottom: 4, lineHeight: 1.5 }}
                      >
                        {action}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Dispatcher assigned */}
              {report.dispatcher_assigned && (
                <div>
                  <SectionHeader title="Assigned Dispatcher" />
                  <div
                    style={{
                      background: "#f7f7f7",
                      border: "1px solid #eee",
                      borderRadius: 4,
                      padding: "10px 12px",
                      fontSize: 12,
                    }}
                  >
                    <div style={{ fontWeight: 700, color: "#000", marginBottom: 3 }}>
                      {report.dispatcher_assigned.name}
                      <span style={{ fontWeight: 400, color: "#777", marginLeft: 8 }}>
                        {report.dispatcher_assigned.badge} · {report.dispatcher_assigned.desk}
                      </span>
                    </div>
                    <div style={{ color: "#666" }}>
                      {report.dispatcher_assigned.certifications.join(" · ")}
                    </div>
                  </div>
                </div>
              )}

              {/* Units dispatched */}
              {report.units_dispatched.length > 0 && (
                <div>
                  <SectionHeader title="Units Dispatched" />
                  {report.units_dispatched.map((u, i) => (
                    <div
                      key={i}
                      style={{
                        border: "1px solid #e5e5e5",
                        borderRadius: 4,
                        padding: "8px 12px",
                        marginBottom: 6,
                        fontSize: 12,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 3,
                        }}
                      >
                        <span style={{ fontWeight: 700, color: "#000", fontFamily: "monospace" }}>
                          {u.unit_code}
                        </span>
                        <span style={{ color: "#555" }}>
                          {u.distance_km.toFixed(1)} km · ~{u.eta_minutes} min ETA
                        </span>
                      </div>
                      <div style={{ color: "#666" }}>
                        Lead: {u.crew_lead}
                        {u.crew.length > 1 && (
                          <span style={{ marginLeft: 8, color: "#aaa" }}>
                            +{u.crew.length - 1} crew
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Timeline */}
              {report.timeline.length > 0 && (
                <div>
                  <SectionHeader title="Timeline" />
                  <div
                    style={{
                      borderLeft: "2px solid #e5e5e5",
                      paddingLeft: 14,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {report.timeline.map((ev, i) => (
                      <div key={i} style={{ fontSize: 12, color: "#333", lineHeight: 1.5 }}>
                        <span
                          style={{
                            fontFamily: "monospace",
                            color: "#999",
                            marginRight: 8,
                            fontSize: 11,
                          }}
                        >
                          {Math.floor(ev.timestamp_ms / 1000)}s
                        </span>
                        {ev.event}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Transcript tab */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === "transcript" && (
        <div>
          {turns.length === 0 ? (
            <p style={{ color: "#aaa", fontSize: 13 }}>No transcript yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {turns.map((t) => {
                const isAgent = t.role === "agent";
                return (
                  <div
                    key={t.id}
                    style={{
                      display: "flex",
                      flexDirection: isAgent ? "row-reverse" : "row",
                      gap: 10,
                      alignItems: "flex-start",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "#fff",
                        background: isAgent ? "#000" : "#555",
                        borderRadius: 3,
                        padding: "2px 6px",
                        minWidth: 32,
                        textAlign: "center",
                        flexShrink: 0,
                        marginTop: 2,
                        letterSpacing: 0.5,
                      }}
                    >
                      {isAgent ? "AI" : "911"}
                    </span>
                    <div
                      style={{
                        background: isAgent ? "#f0f0f0" : "#fff",
                        border: "1px solid #ddd",
                        borderRadius: 6,
                        padding: "8px 12px",
                        fontSize: 13,
                        color: "#111",
                        maxWidth: "78%",
                        lineHeight: 1.55,
                      }}
                    >
                      {t.text}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Actions tab */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === "actions" && (
        <div>
          {actions.length === 0 ? (
            <p style={{ color: "#aaa", fontSize: 13 }}>No dispatch actions recorded.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {actions.map((a) => {
                let detail: string | null = null;
                if (a.payload) {
                  try {
                    detail = JSON.stringify(JSON.parse(a.payload), null, 2);
                  } catch {
                    detail = a.payload;
                  }
                }
                return (
                  <div
                    key={a.id}
                    style={{
                      border: "1px solid #e5e5e5",
                      borderRadius: 4,
                      padding: "8px 12px",
                      fontSize: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: detail ? 4 : 0,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          color: "#000",
                          fontSize: 11,
                        }}
                      >
                        {a.action_type.replace("_", " ")}
                      </span>
                      <span style={{ color: "#aaa", fontFamily: "monospace", fontSize: 11 }}>
                        {new Date(a.created_at).toLocaleTimeString()}
                        {a.officer_id && (
                          <span style={{ marginLeft: 8 }}>· {a.officer_id}</span>
                        )}
                      </span>
                    </div>
                    {detail && (
                      <pre
                        style={{
                          margin: 0,
                          fontSize: 11,
                          color: "#555",
                          background: "#f7f7f7",
                          borderRadius: 3,
                          padding: "5px 8px",
                          overflowX: "auto",
                          fontFamily: "monospace",
                        }}
                      >
                        {detail}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
