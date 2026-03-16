import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Siren,
  RefreshCw,
  MapPin,
  Flame,
  AlertTriangle,
  Skull,
  ShieldX,
  ActivitySquare,
  EyeOff,
  Lock,
} from "lucide-react";
import type {
  ApiResponse,
  DashboardIncident,
  DashboardUnit,
  Department,
  QAEntry,
  TranscriptLine,
  SseTranscriptUpdateEvent,
  SseAnswerUpdateEvent,
} from "@/types/dashboard";
import { SeverityBadge } from "@/components/common/SeverityBadge";
import { StatusBadge } from "@/components/common/StatusBadge";
import { LiveTranscript } from "@/components/transcript/LiveTranscript";
import { QAThread } from "@/components/dispatch/QAThread";
import { QuestionInput } from "@/components/dispatch/QuestionInput";
import { UnitSelector } from "@/components/dispatch/UnitSelector";
import { ActionButtons } from "@/components/dispatch/ActionButtons";
import { SummaryModal } from "@/components/dispatch/SummaryModal";
import { BackupModal } from "@/components/dispatch/BackupModal";
import { useSSE } from "@/hooks/useSSE";
import { useSession, canViewFullDetail } from "@/context/SessionContext";

type IncidentDetailProps = {
  incident: DashboardIncident;
  units: DashboardUnit[];
  officerId: string;
  onBack: () => void;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

// ---------------------------------------------------------------------------
// AI Report card — structured, scannable, color-coded
// ---------------------------------------------------------------------------

const PRIORITY_CONFIG = {
  P1: {
    label: "P1 — CRITICAL",
    border: "border-red-700/60",
    bg: "bg-red-950/30",
    text: "text-red-300",
    dot: "bg-red-500",
  },
  P2: {
    label: "P2 — SERIOUS",
    border: "border-orange-700/60",
    bg: "bg-orange-950/20",
    text: "text-orange-300",
    dot: "bg-orange-500",
  },
  P3: {
    label: "P3 — MODERATE",
    border: "border-yellow-700/60",
    bg: "bg-yellow-950/20",
    text: "text-yellow-300",
    dot: "bg-yellow-500",
  },
  P4: {
    label: "P4 — LOW",
    border: "border-slate-700/60",
    bg: "bg-slate-900/20",
    text: "text-slate-400",
    dot: "bg-slate-500",
  },
} as const;

function HazardPill({ active, label, icon }: { active: boolean; label: string; icon: React.ReactNode }) {
  if (!active) return null;
  return (
    <span className="flex items-center gap-1 rounded border border-red-700/50 bg-red-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
      {icon}
      {label}
    </span>
  );
}

function AIReportCard({ incident }: { incident: DashboardIncident }) {
  const cfg = PRIORITY_CONFIG[incident.priority ?? "P4"];
  const ageMs = Date.now() - Date.parse(incident.created_at);
  const ageMin = Math.floor(ageMs / 60000);

  const activeHazards = [
    { active: incident.hazards.fire, label: "Fire", icon: <Flame className="h-2.5 w-2.5" /> },
    { active: incident.hazards.smoke, label: "Smoke", icon: <ActivitySquare className="h-2.5 w-2.5" /> },
    { active: incident.hazards.chemicals, label: "Chemical", icon: <AlertTriangle className="h-2.5 w-2.5" /> },
    { active: incident.hazards.weapon, label: "Weapon", icon: <ShieldX className="h-2.5 w-2.5" /> },
    { active: incident.hazards.collapseRisk, label: "Collapse Risk", icon: <Skull className="h-2.5 w-2.5" /> },
  ];

  return (
    <div
      className={`rounded-lg border p-3 ${cfg.border} ${cfg.bg}`}
    >
      {/* Header row */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 animate-pulse rounded-full ${cfg.dot}`} />
          <p className={`text-[10px] font-bold uppercase tracking-widest ${cfg.text}`}>
            AI Incident Report
          </p>
          <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${cfg.border} ${cfg.text}`}>
            {cfg.label}
          </span>
        </div>
        <span className="text-[10px] text-slate-500">
          {ageMin > 0 ? `${ageMin}m ago` : "Just now"}
        </span>
      </div>

      {/* Summary */}
      <p className="mb-2 text-sm font-semibold leading-snug text-slate-100">
        {incident.summary_line}
      </p>

      {/* Location */}
      <div className="mb-2 flex items-start gap-1.5 text-xs text-slate-400">
        <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-slate-500" />
        <span>{incident.location.address}</span>
      </div>

      {/* Grid: casualties + hazards */}
      <div className="mb-2 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
            Casualties
          </p>
          <p className={`mt-0.5 text-base font-bold ${incident.injuries.count > 0 ? "text-red-300" : "text-slate-400"}`}>
            {incident.injuries.count}
          </p>
          <p className="text-[10px] capitalize text-slate-500">
            {incident.injuries.severity} severity
          </p>
          {incident.injuries.notes && incident.injuries.notes !== "No injuries reported yet" && (
            <p className="mt-0.5 text-[10px] italic text-slate-400">{incident.injuries.notes}</p>
          )}
        </div>

        <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
            Urgency
          </p>
          <p className={`mt-0.5 text-base font-bold capitalize ${
            incident.urgency === "critical"
              ? "text-red-300"
              : incident.urgency === "high"
                ? "text-orange-300"
                : "text-slate-300"
          }`}>
            {incident.urgency}
          </p>
          <p className="text-[10px] text-slate-500">
            {incident.status.replace(/_/g, " ")}
          </p>
        </div>
      </div>

      {/* Hazard pills */}
      {activeHazards.some((h) => h.active) && (
        <div className="mb-2 flex flex-wrap gap-1">
          {activeHazards.map((h) => (
            <HazardPill key={h.label} active={h.active} label={h.label} icon={h.icon} />
          ))}
        </div>
      )}

      {/* Hazard notes */}
      {incident.hazards.notes && incident.hazards.notes !== "No major hazards reported" && (
        <p className="text-[10px] italic text-slate-400">
          {incident.hazards.notes}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Restricted view — shown to unit officers not assigned to this incident
// ---------------------------------------------------------------------------

function RestrictedView({ incident }: { incident: DashboardIncident }) {
  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3">
      <AIReportCard incident={incident} />

      <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-4 text-center">
        <Lock className="mx-auto mb-2 h-5 w-5 text-slate-500" />
        <p className="text-sm font-semibold text-slate-400">Not assigned to you</p>
        <p className="mt-1 text-xs text-slate-600">
          Full incident controls are only available to the assigned unit.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function IncidentDetail({ incident, units, officerId, onBack }: IncidentDetailProps) {
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [qaEntries, setQaEntries] = useState<QAEntry[]>([]);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { lastEvent } = useSSE();
  const { session } = useSession();

  const isUnitOfficer = session?.role === "unit_officer";
  const myUnitId = session?.unit?.id;
  const fullAccess = canViewFullDetail(session, incident);

  // Auto-dismiss action error after 6 seconds
  useEffect(() => {
    if (!actionError) return;
    const t = setTimeout(() => setActionError(null), 6000);
    return () => clearTimeout(t);
  }, [actionError]);

  // Auto-append new transcript lines from SSE
  useEffect(() => {
    if (!lastEvent || lastEvent.type !== "transcript_update") return;
    const ev = { type: "transcript_update", data: lastEvent.data } as SseTranscriptUpdateEvent;
    if (ev.data.incident_id !== incident.id) return;
    const line: TranscriptLine = {
      id: crypto.randomUUID(),
      incident_id: ev.data.incident_id,
      role: ev.data.role,
      text: ev.data.text,
      timestamp: ev.data.timestamp,
    };
    setTranscript((prev) => [...prev, line]);
  }, [lastEvent, incident.id]);

  // Auto-update Q&A entries when an answer arrives
  useEffect(() => {
    if (!lastEvent || lastEvent.type !== "answer_update") return;
    const ev = { type: "answer_update", data: lastEvent.data } as SseAnswerUpdateEvent;
    if (ev.data.incident_id !== incident.id) return;
    setQaEntries((prev) =>
      prev.map((entry) =>
        entry.question === ev.data.question
          ? { ...entry, answer: ev.data.answer, answered_at: new Date().toISOString() }
          : entry
      )
    );
  }, [lastEvent, incident.id]);

  // Load transcript + questions automatically when incident is opened
  useEffect(() => {
    void loadTranscript();
    void loadQuestions();
    // Reset unit selection when switching incidents
    setSelectedUnitIds([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incident.id]);

  const assignedDepartments = useMemo<Department[]>(() => {
    return units
      .filter((unit) => selectedUnitIds.includes(unit.id))
      .map((unit) => unit.department)
      .filter((dept, index, arr) => arr.indexOf(dept) === index);
  }, [selectedUnitIds, units]);

  function toggleUnit(unitId: string) {
    setSelectedUnitIds((prev) =>
      prev.includes(unitId) ? prev.filter((id) => id !== unitId) : [...prev, unitId]
    );
  }

  async function loadTranscript() {
    setTranscriptLoading(true);
    try {
      const response = await fetch(`${API_BASE}/incidents/${incident.id}/transcript`);
      if (!response.ok) return;
      const payload = (await response.json()) as ApiResponse<
        Array<{ id: string; incident_id: string; role: "caller" | "agent"; text: string; created_at: string }>
      >;
      if (!payload.ok) return;
      setTranscript(
        payload.data.map((line) => ({
          id: line.id,
          incident_id: line.incident_id,
          role: line.role,
          text: line.text,
          timestamp: line.created_at,
        }))
      );
    } finally {
      setTranscriptLoading(false);
    }
  }

  async function loadQuestions() {
    const response = await fetch(`${API_BASE}/incidents/${incident.id}/questions`);
    if (!response.ok) return;
    const payload = (await response.json()) as ApiResponse<QAEntry[]>;
    if (!payload.ok) return;
    setQaEntries(payload.data);
  }

  async function handleAccept() {
    try {
      const res = await fetch(`${API_BASE}/dispatch/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_id: incident.id,
          unit_ids: selectedUnitIds,
          officer_id: officerId,
        }),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`Action failed — please retry or contact supervisor. ${msg}`);
      throw err;
    }
  }

  async function handleAsk(question: string) {
    const optimisticEntry: QAEntry = {
      id: crypto.randomUUID(),
      incident_id: incident.id,
      question,
      refined_question: null,
      answer: null,
      asked_at: new Date().toISOString(),
      answered_at: null,
      officer_id: officerId,
    };
    setQaEntries((prev) => [...prev, optimisticEntry]);

    const res = await fetch(`${API_BASE}/dispatch/question`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: incident.id, question, officer_id: officerId }),
    });
    if (!res.ok) {
      setQaEntries((prev) => prev.filter((e) => e.id !== optimisticEntry.id));
      setActionError(`Question failed to send — please retry. (${res.status})`);
      return;
    }
    await loadQuestions();
  }

  async function handleEscalate() {
    try {
      const requested = assignedDepartments.length > 0 ? assignedDepartments : ["patrol", "medical"];
      const res = await fetch(`${API_BASE}/dispatch/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_id: incident.id,
          reason: "Dispatcher escalation from DECC dashboard",
          requested_unit_types: requested,
        }),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`Action failed — please retry or contact supervisor. ${msg}`);
      throw err;
    }
  }

  async function handleComplete() {
    try {
      const response = await fetch(`${API_BASE}/dispatch/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incident_id: incident.id }),
      });
      if (!response.ok) throw new Error(`Server responded ${response.status}`);
      setSummaryOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`Action failed — please retry or contact supervisor. ${msg}`);
      throw err;
    }
  }

  async function handleSaveReport(summary: string) {
    await fetch(`${API_BASE}/dispatch/save-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: incident.id, summary }),
    });
  }

  const openedAt = new Date(incident.created_at).toLocaleTimeString("en-IE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <section className="flex h-full flex-col bg-command-panel">
      <SummaryModal
        open={summaryOpen}
        initialSummary={incident.summary ?? incident.summary_line}
        onSave={handleSaveReport}
        onClose={() => setSummaryOpen(false)}
      />

      {backupOpen && myUnitId && (
        <BackupModal
          incidentId={incident.id}
          requestingUnit={myUnitId}
          onClose={() => setBackupOpen(false)}
        />
      )}

      {/* Detail header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          title="Back to incident list (Esc)"
          className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800"
        >
          <ArrowLeft className="h-3 w-3" />
          Back
        </button>

        <div className="flex flex-col items-center">
          <p className="font-mono text-[10px] font-bold text-slate-400">
            {incident.cad_number ?? `#${incident.id.slice(0, 8).toUpperCase()}`}
          </p>
          <p className="text-[9px] text-slate-600">Opened {openedAt}</p>
        </div>

        <div className="flex items-center gap-1.5">
          <SeverityBadge severity={incident.severity} />
          <StatusBadge status={incident.status} />
        </div>
      </div>

      {/* Scrollable body — gated by role */}
      {!fullAccess ? (
        <RestrictedView incident={incident} />
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto p-3">

          {/* Covert distress banner */}
          {incident.covert_distress && (
            <div className="rounded-lg border border-violet-700/60 bg-violet-950/40 px-3 py-2.5">
              <div className="mb-1 flex items-center gap-2">
                <EyeOff className="h-3.5 w-3.5 text-violet-300" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-violet-300">
                  Silent Approach Required
                </p>
              </div>
              <p className="text-xs text-violet-200">
                Caller cannot speak freely. AI has switched to yes/no mode. Dispatch units with NO SIRENS. Do not announce approach on radio.
              </p>
            </div>
          )}

          {/* AI Report — always shown */}
          <AIReportCard incident={incident} />

          {/* Transcript */}
          <div className="rounded-lg border border-slate-700 bg-command-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Live Transcript
                {transcript.length > 0 && (
                  <span className="ml-2 rounded-full bg-slate-700 px-1.5 py-0.5 text-slate-300">
                    {transcript.length}
                  </span>
                )}
              </p>
              <button
                type="button"
                onClick={() => void loadTranscript()}
                disabled={transcriptLoading}
                title="Refresh transcript"
                className="flex items-center gap-1 text-xs text-blue-400 transition-colors hover:text-blue-300 disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${transcriptLoading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
            <LiveTranscript lines={transcript} />
          </div>

          {/* Dispatch Q&A */}
          <div className="rounded-lg border border-slate-700 bg-command-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Dispatch Q&amp;A
                {qaEntries.length > 0 && (
                  <span className="ml-2 rounded-full bg-slate-700 px-1.5 py-0.5 text-slate-300">
                    {qaEntries.length}
                  </span>
                )}
              </p>
              <button
                type="button"
                onClick={() => void loadQuestions()}
                className="text-xs text-blue-400 transition-colors hover:text-blue-300"
              >
                Refresh
              </button>
            </div>
            <QAThread entries={qaEntries} />
            <div className="mt-2">
              <QuestionInput onAsk={handleAsk} />
            </div>
          </div>

          {/* Unit assignment — dispatcher only */}
          {!isUnitOfficer && (
            <div className="rounded-lg border border-slate-700 bg-command-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Assign Units
                </p>
                <div className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300">
                  <Siren className="h-3 w-3 text-amber-300" />
                  {selectedUnitIds.length} selected
                </div>
              </div>

              <UnitSelector
                units={units}
                selectedUnitIds={selectedUnitIds}
                onToggle={toggleUnit}
                incidentLat={incident.location.lat}
                incidentLng={incident.location.lng}
              />

              {actionError && (
                <div className="mt-2 rounded-md border border-red-700/60 bg-red-950/60 px-3 py-2 text-xs font-medium text-red-200">
                  {actionError}
                </div>
              )}

              <div className="mt-3">
                <ActionButtons
                  onAccept={handleAccept}
                  onEscalate={handleEscalate}
                  onComplete={handleComplete}
                  incidentStatus={incident.status}
                  selectedUnitIds={selectedUnitIds}
                />
              </div>
            </div>
          )}

          {/* Backup button — unit officers only (on their own incident) */}
          {isUnitOfficer && myUnitId && (
            <div className="rounded-lg border border-slate-700 bg-command-card p-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Unit Actions
              </p>

              {actionError && (
                <div className="mb-2 rounded-md border border-red-700/60 bg-red-950/60 px-3 py-2 text-xs font-medium text-red-200">
                  {actionError}
                </div>
              )}

              <button
                type="button"
                onClick={() => setBackupOpen(true)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-700/70 bg-red-600/10 px-4 py-2.5 text-sm font-semibold text-red-200 transition-colors hover:bg-red-600/20"
              >
                Call Backup
              </button>
            </div>
          )}

        </div>
      )}
    </section>
  );
}
