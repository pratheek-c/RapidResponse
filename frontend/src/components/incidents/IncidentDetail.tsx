import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Siren } from "lucide-react";
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
import { useSSE } from "@/hooks/useSSE";

type IncidentDetailProps = {
  incident: DashboardIncident;
  units: DashboardUnit[];
  officerId: string;
  onBack: () => void;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export function IncidentDetail({ incident, units, officerId, onBack }: IncidentDetailProps) {
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [qaEntries, setQaEntries] = useState<QAEntry[]>([]);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const { lastEvent } = useSSE();

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
  }

  async function loadQuestions() {
    const response = await fetch(`${API_BASE}/incidents/${incident.id}/questions`);
    if (!response.ok) return;
    const payload = (await response.json()) as ApiResponse<QAEntry[]>;
    if (!payload.ok) return;
    setQaEntries(payload.data);
  }

  async function handleAccept() {
    await fetch(`${API_BASE}/dispatch/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: incident.id,
        unit_ids: selectedUnitIds,
        officer_id: officerId,
      }),
    });
  }

  async function handleAsk(question: string) {
    await fetch(`${API_BASE}/dispatch/question`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: incident.id, question, officer_id: officerId }),
    });
    await loadQuestions();
  }

  async function handleEscalate() {
    const requested = assignedDepartments.length > 0 ? assignedDepartments : ["patrol", "medical"];
    await fetch(`${API_BASE}/dispatch/escalate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: incident.id,
        reason: "Dispatcher escalation from dashboard",
        requested_unit_types: requested,
      }),
    });
  }

  async function handleComplete() {
    const response = await fetch(`${API_BASE}/dispatch/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: incident.id }),
    });
    if (response.ok) setSummaryOpen(true);
  }

  async function handleSaveReport(summary: string) {
    await fetch(`${API_BASE}/dispatch/save-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: incident.id, summary }),
    });
  }

  return (
    <section className="flex h-full flex-col bg-command-panel">
      <SummaryModal
        open={summaryOpen}
        initialSummary={incident.summary ?? incident.summary_line}
        onSave={handleSaveReport}
        onClose={() => setSummaryOpen(false)}
      />

      <div className="flex items-center justify-between border-b border-slate-800 p-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300"
        >
          <ArrowLeft className="h-3 w-3" />
          Back
        </button>
        <div className="flex items-center gap-2">
          <SeverityBadge severity={incident.severity} />
          <StatusBadge status={incident.status} />
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <div className="rounded-lg border border-slate-700 bg-command-card p-3">
          <p className="text-xs uppercase tracking-[0.15em] text-slate-400">AI Report</p>
          <p className="mt-1 text-sm font-semibold text-slate-100">{incident.summary_line}</p>
          <p className="mt-1 text-xs text-slate-400">{incident.location.address}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300">
            <p>Injuries: {incident.injuries.count}</p>
            <p>Fire Risk: {incident.hazards.fire ? "Yes" : "No"}</p>
            <p>Chemicals: {incident.hazards.chemicals ? "Yes" : "No"}</p>
            <p>Weapon: {incident.hazards.weapon ? "Yes" : "No"}</p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-700 bg-command-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.15em] text-slate-400">Live Transcript</p>
            <button
              type="button"
              onClick={() => void loadTranscript()}
              className="text-xs text-blue-300 hover:text-blue-200"
            >
              Refresh
            </button>
          </div>
          <LiveTranscript lines={transcript} />
        </div>

        <div className="rounded-lg border border-slate-700 bg-command-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.15em] text-slate-400">Dispatch Q&A</p>
            <button
              type="button"
              onClick={() => void loadQuestions()}
              className="text-xs text-blue-300 hover:text-blue-200"
            >
              Refresh
            </button>
          </div>
          <QAThread entries={qaEntries} />
          <div className="mt-2">
            <QuestionInput onAsk={handleAsk} />
          </div>
        </div>

        <div className="rounded-lg border border-slate-700 bg-command-card p-3">
          <p className="mb-2 text-xs uppercase tracking-[0.15em] text-slate-400">Assign Units</p>
          <UnitSelector units={units} selectedUnitIds={selectedUnitIds} onToggle={toggleUnit} />
          <div className="mt-3">
            <ActionButtons onAccept={handleAccept} onEscalate={handleEscalate} onComplete={handleComplete} />
          </div>
          <div className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300">
            <Siren className="h-3 w-3 text-amber-300" />
            Selected units: {selectedUnitIds.length}
          </div>
        </div>
      </div>
    </section>
  );
}
