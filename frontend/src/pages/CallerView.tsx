/**
 * CallerView — Emergency 112 caller page.
 *
 * Auto-arms on mount: as soon as geolocation resolves the voice agent
 * connects automatically (mic permission → WebSocket open → agent greeting).
 *
 * Voice state machine:
 *   arming    → requesting mic + connecting WS
 *   ready     → WS open, agent greeting may be playing, waiting for caller to speak
 *   listening → caller is speaking (audio being sent)
 *   agent_speaking → receiving and playing agent audio
 *   ended     → call finalized
 *   error     → unrecoverable failure
 *
 * Panels shown during/after call:
 *   - Assigned dispatcher card (from report_update)
 *   - "Help is on the way" banner with ETA countdown
 *   - Dispatcher approaching alert when ETA <= 3 min
 *   - Live incident report (collapsible)
 *   - Live transcript
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useCallSocket } from "@/hooks/useCallSocket";
import { useCallerInfo } from "@/hooks/useCallerInfo";
import type { IncidentReport, DispatcherAssigned, DispatchedUnitSummary } from "@/types";

// ---------------------------------------------------------------------------
// Waveform animation component
// ---------------------------------------------------------------------------

type WaveformState = "idle" | "arming" | "ready" | "listening" | "agent_speaking";

function Waveform({ state }: { state: WaveformState }) {
  const bars = 7;
  const config: Record<WaveformState, { color: string; heights: number[]; animated: boolean }> = {
    idle:          { color: "#333", heights: [4,4,4,4,4,4,4], animated: false },
    arming:        { color: "#888", heights: [8,14,10,16,10,14,8], animated: true },
    ready:         { color: "#ccc", heights: [6,10,8,12,8,10,6], animated: true },
    listening:     { color: "#fff", heights: [10,20,14,24,14,20,10], animated: true },
    agent_speaking:{ color: "#ddd", heights: [12,22,16,28,16,22,12], animated: true },
  };
  const { color, heights, animated } = config[state];

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, height: 36 }}>
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 4,
            height: heights[i],
            borderRadius: 2,
            background: color,
            ...(animated
              ? { animation: `wave ${0.6 + i * 0.08}s ease-in-out infinite alternate`, animationDelay: `${i * 0.07}s` }
              : {}),
            transition: "height 0.3s, background 0.3s",
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voice status label
// ---------------------------------------------------------------------------

function VoiceStatusLabel({ state, hasAudio }: { state: WaveformState; hasAudio: boolean }) {
  const labels: Record<WaveformState, string> = {
    idle:           "",
    arming:         "Connecting…",
    ready:          hasAudio ? "Agent Speaking" : "Agent Ready — Speak when ready",
    listening:      "Listening…",
    agent_speaking: "Agent Speaking",
  };
  const colors: Record<WaveformState, string> = {
    idle:           "#444",
    arming:         "#999",
    ready:          "#ccc",
    listening:      "#fff",
    agent_speaking: "#ddd",
  };
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: colors[state], textAlign: "center", letterSpacing: 0.3, minHeight: 18 }}>
      {labels[state]}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Info row (before call)
// ---------------------------------------------------------------------------

function InfoRow({ label, value, status, icon }: {
  label: string; value: string; status: "loading" | "ok" | "warn" | "error"; icon: string;
}) {
  const statusColor = { loading: "#666", ok: "#ccc", warn: "#aaa", error: "#888" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#111", borderRadius: 8, padding: "10px 14px", border: "1px solid #222" }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
        <div style={{ fontSize: 13, color: value ? "#ccc" : "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value || "Detecting…"}
        </div>
      </div>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor[status], flexShrink: 0, ...(status === "loading" ? { animation: "pulse 1.2s ease-in-out infinite" } : {}) }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dispatcher card
// ---------------------------------------------------------------------------

function DispatcherCard({ dispatcher }: { dispatcher: DispatcherAssigned }) {
  return (
    <div style={{ background: "#111", border: "1px solid #222", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
        Assigned Dispatcher
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: "50%", background: "#222",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: "#fff", flexShrink: 0,
        }}>
          {dispatcher.name.split(" ").map(w => w[0]).join("").slice(0, 2)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>{dispatcher.name}</div>
          <div style={{ fontSize: 11, color: "#555" }}>Badge {dispatcher.badge} · {dispatcher.desk}</div>
        </div>
      </div>
      {dispatcher.certifications.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
          {dispatcher.certifications.map((cert) => (
            <span key={cert} style={{ fontSize: 10, background: "#1a1a1a", color: "#aaa", border: "1px solid #333", borderRadius: 4, padding: "2px 7px", fontWeight: 600 }}>
              {cert}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Help is on the way banner (ETA countdown)
// ---------------------------------------------------------------------------

function HelpBanner({ unit, onTick }: { unit: DispatchedUnitSummary; onTick: (eta: number) => void }) {
  const [eta, setEta] = useState(unit.eta_minutes);

  useEffect(() => {
    setEta(unit.eta_minutes);
  }, [unit.eta_minutes]);

  useEffect(() => {
    const id = setInterval(() => {
      setEta((prev) => {
        const next = Math.max(0, prev - 1 / 60); // tick every second
        onTick(next);
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [onTick]);

  const unitIcon: Record<string, string> = { ems: "🚑", fire: "🚒", police: "🚔", hazmat: "☣️", rescue: "🪝" };
  const icon = unitIcon[unit.type] ?? "🚨";
  const etaMins = Math.floor(eta);
  const etaSecs = Math.floor((eta - etaMins) * 60);

  return (
    <div style={{
      background: "#111",
      border: "1px solid #444",
      borderRadius: 12,
      padding: "14px 16px",
      marginBottom: 14,
      display: "flex",
      alignItems: "center",
      gap: 12,
    }}>
      <span style={{ fontSize: 24 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>Help is on the way</div>
        <div style={{ fontSize: 12, color: "#aaa" }}>
          {unit.unit_code} · {unit.crew_lead} · ETA{" "}
          <strong style={{ color: "#fff" }}>
            {etaMins}:{etaSecs.toString().padStart(2, "0")} min
          </strong>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dispatcher approaching alert
// ---------------------------------------------------------------------------

function ApproachingAlert({ unitCode, etaMinutes, crew }: {
  unitCode: string; etaMinutes: number; crew: { name: string; role: string }[];
}) {
  const lead = crew[0];
  return (
    <div style={{
      background: "#000",
      border: "2px solid #fff",
      borderRadius: 12,
      padding: "14px 16px",
      marginBottom: 14,
      display: "flex",
      alignItems: "center",
      gap: 12,
      animation: "pulse 1.2s ease-in-out infinite",
    }}>
      <span style={{ fontSize: 22 }}>🚨</span>
      <div>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>
          {unitCode} is arriving in ~{Math.ceil(etaMinutes)} min
        </div>
        {lead && (
          <div style={{ fontSize: 12, color: "#aaa" }}>
            {lead.name} ({lead.role}) is approaching your location
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live report panel (collapsible)
// ---------------------------------------------------------------------------

function ReportPanel({ report }: { report: IncidentReport }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ background: "#0a0a0a", border: "1px solid #222", borderRadius: 12, marginTop: 16, overflow: "hidden" }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          color: "#666",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
          Live Incident Report
        </span>
        <span style={{ fontSize: 12 }}>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div style={{ padding: "0 16px 16px" }}>
          {/* Summary */}
          <div style={{ fontSize: 13, color: "#bbb", lineHeight: 1.6, marginBottom: 12 }}>
            {report.summary}
          </div>

          {/* Caller details */}
          {report.caller_details && (
            <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
              {report.caller_details}
            </div>
          )}

          {/* Recommended actions */}
          {report.recommended_actions.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
                Recommended Actions
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {report.recommended_actions.map((action, i) => (
                  <li key={i} style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>{action}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Timeline */}
          {report.timeline.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
                Timeline
              </div>
              {report.timeline.map((ev, i) => (
                <div key={i} style={{ display: "flex", gap: 10, marginBottom: 6, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 10, color: "#555", flexShrink: 0, minWidth: 40 }}>
                    {Math.floor(ev.timestamp_ms / 1000)}s
                  </span>
                  <span style={{ fontSize: 12, color: "#888" }}>{ev.event}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 10, color: "#333", marginTop: 10 }}>
            Generated {new Date(report.generated_at).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function CallerView() {
  const { callerId, coords, address, geoStatus, geoError, requestLocation } = useCallerInfo();

  const {
    status,
    incidentId,
    transcript,
    classification,
    errorMessage,
    report,
    approachingUnit,
    startCall,
    endCall,
  } = useCallSocket();

  const [voiceState, setVoiceState] = useState<WaveformState>("idle");
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const agentSpeakingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // No auto-arm — call only starts on button click

  // Derive voiceState from call status
  useEffect(() => {
    if (status === "connecting") {
      setVoiceState("arming");
    } else if (status === "active") {
      setVoiceState(agentSpeaking ? "agent_speaking" : "ready");
    } else if (status === "ended" || status === "error") {
      setVoiceState("idle");
    }
  }, [status, agentSpeaking]);

  const onAgentAudio = useCallback(() => {
    setAgentSpeaking(true);
    if (agentSpeakingTimer.current) clearTimeout(agentSpeakingTimer.current);
    agentSpeakingTimer.current = setTimeout(() => {
      setAgentSpeaking(false);
    }, 1500);
  }, []);

  useEffect(() => {
    return () => {
      if (agentSpeakingTimer.current) clearTimeout(agentSpeakingTimer.current);
    };
  }, []);

  const prevTranscriptLen = useRef(0);
  useEffect(() => {
    if (transcript.length > prevTranscriptLen.current) {
      const lastLine = transcript[transcript.length - 1];
      if (lastLine?.role === "agent") {
        onAgentAudio();
      }
      prevTranscriptLen.current = transcript.length;
    }
  }, [transcript, onAgentAudio]);

  const isArmed = status === "active";
  const isConnecting = status === "connecting";
  const isEnded = status === "ended";
  const isError = status === "error";
  const canManualStart = status === "idle" || isEnded || isError;

  const geoInfoStatus =
    geoStatus === "granted" ? "ok"
    : geoStatus === "requesting" || geoStatus === "idle" ? "loading"
    : "error";

  const addressInfoStatus =
    address ? "ok" : geoStatus === "granted" ? "loading" : geoInfoStatus;

  // ETA countdown callback — track if we should show approaching alert
  const handleEtaTick = useCallback((_eta: number) => {
    // approaching alert is driven by dispatcher_approaching WS message from backend
  }, []);

  const firstDispatchedUnit = report?.units_dispatched?.[0] ?? null;
  const dispatcherInfo: DispatcherAssigned | null = report?.dispatcher_assigned ?? null;

  return (
    <div style={{ minHeight: "100vh", background: "#080a0f", display: "flex", flexDirection: "column", alignItems: "center", padding: "32px 16px 60px", fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ width: "100%", maxWidth: 560, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "#111", border: "1px solid #444", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
            🚨
          </div>
          <span style={{ fontWeight: 800, fontSize: 18, color: "#f8fafc", letterSpacing: -0.5 }}>
            RapidResponse.ai
          </span>
        </div>
        {incidentId && (
          <div style={{ fontSize: 11, color: "#555", fontFamily: "monospace" }}>
            #{incidentId.slice(0, 8)}
          </div>
        )}
      </div>

      {/* Approaching alert — full-width, above main card */}
      {approachingUnit && (isArmed || isConnecting) && (
        <div style={{ width: "100%", maxWidth: 560, marginBottom: 12 }}>
          <ApproachingAlert
            unitCode={approachingUnit.unit_code}
            etaMinutes={approachingUnit.eta_minutes}
            crew={approachingUnit.crew}
          />
        </div>
      )}

      {/* Main card */}
      <div style={{ width: "100%", maxWidth: 560, background: "#0d0d0d", borderRadius: 20, border: "1px solid #222", padding: "28px 28px 32px", boxShadow: "0 24px 48px rgba(0,0,0,0.5)" }}>

        {/* Voice UI — always visible when arming or armed */}
        {(isArmed || isConnecting || isEnded) && (
          <div style={{ textAlign: "center", marginBottom: 24, padding: "24px 16px", background: "#080808", borderRadius: 14, border: "1px solid #222" }}>
            {incidentId && (
              <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
                Incident #{incidentId.slice(0, 8)}
              </div>
            )}
            <div style={{ marginBottom: 10 }}>
              <Waveform state={isEnded ? "idle" : voiceState} />
            </div>
            {!isEnded && (
              <VoiceStatusLabel state={voiceState} hasAudio={agentSpeaking} />
            )}
            {isEnded && (
              <div style={{ fontSize: 13, color: "#555" }}>
                Call ended.{incidentId && <span> Incident #{incidentId.slice(0, 8)} has been logged.</span>}
              </div>
            )}
          </div>
        )}

        {/* Dispatcher card — shown once we have report */}
        {dispatcherInfo && (isArmed || isConnecting || isEnded) && (
          <DispatcherCard dispatcher={dispatcherInfo} />
        )}

        {/* Help is on the way banner */}
        {firstDispatchedUnit && (isArmed || isConnecting) && (
          <HelpBanner unit={firstDispatchedUnit} onTick={handleEtaTick} />
        )}

        {/* Pre-call: detected info */}
        {canManualStart && !isEnded && !isError && (
          <>
            <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
              Detected Info
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              <InfoRow label="Caller ID" value={callerId} status="ok" icon="🪪" />
              <InfoRow label="GPS Coordinates" value={coords} status={geoInfoStatus} icon="📍" />
              <InfoRow label="Address" value={address} status={addressInfoStatus} icon="🏠" />
            </div>
          </>
        )}

        {/* Connecting state */}
        {isConnecting && !isArmed && (
          <div style={{ fontSize: 13, color: "#aaa", fontWeight: 600, textAlign: "center", marginBottom: 16 }}>
            Connecting to dispatch…
          </div>
        )}

        {/* Geo error */}
        {geoError && canManualStart && (
          <div style={{ background: "#111", border: "1px solid #333", borderRadius: 8, padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 12, color: "#aaa" }}>{geoError}</span>
            <button
              onClick={requestLocation}
              style={{ background: "none", border: "1px solid #444", borderRadius: 6, color: "#aaa", fontSize: 11, fontWeight: 600, padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              Retry
            </button>
          </div>
        )}

        {/* WS / mic error */}
        {errorMessage && (
          <div style={{ background: "#111", border: "1px solid #333", borderRadius: 8, padding: "10px 14px", color: "#aaa", fontSize: 13, marginBottom: 16 }}>
            {errorMessage}
          </div>
        )}

        {/* Classification banner */}
        {classification && (
          <div style={{ background: "#111", border: "1px solid #333", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#ccc", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>🚔</span>
            <div>
              <strong>Incident classified:</strong>{" "}
              {classification.incident_type.replace(/_/g, " ")}{" "}
              <span style={{ color: "#fff", fontWeight: 700 }}>[{classification.priority}]</span>
            </div>
          </div>
        )}

        {/* CTA area */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 8 }}>
          {canManualStart && (
            <button
              onClick={() => {
                setVoiceState("arming");
                void startCall(
                  callerId || "CALLER-ANON",
                  coords || "Unknown location",
                  address || coords || "Unknown address"
                );
              }}
              style={{ background: "#000", color: "#fff", border: "1px solid #444", borderRadius: 10, padding: "14px 40px", fontSize: 16, fontWeight: 800, cursor: "pointer", letterSpacing: 0.5 }}
            >
              {isEnded || isError ? "Call 112 Again" : "Call 112"}
            </button>
          )}
          {isArmed && (
            <button
              onClick={endCall}
              style={{ background: "#111", color: "#888", border: "1px solid #222", borderRadius: 10, padding: "14px 32px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
            >
              End Call
            </button>
          )}
        </div>

        {/* Live transcript */}
        {transcript.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 11, color: "#444", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14, textAlign: "center" }}>
              Live Transcript
            </div>
            <div style={{ maxHeight: 380, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, paddingRight: 4 }}>
              {transcript.map((line, i) => (
                <div key={i} style={{ display: "flex", flexDirection: line.role === "agent" ? "row-reverse" : "row", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: line.role === "agent" ? "#333" : "#222", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                    {line.role === "agent" ? "AI" : "Me"}
                  </div>
                  <div style={{ background: line.role === "agent" ? "#1a1a1a" : "#111", borderRadius: line.role === "agent" ? "12px 4px 12px 12px" : "4px 12px 12px 12px", padding: "9px 14px", fontSize: 13, color: "#ccc", maxWidth: "78%", lineHeight: 1.6 }}>
                    {line.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Live report panel */}
        {report && (isArmed || isEnded) && (
          <ReportPanel report={report} />
        )}
      </div>

      {/* Disclaimer */}
      <p style={{ marginTop: 20, fontSize: 11, color: "#333", textAlign: "center", maxWidth: 480 }}>
        Your location is used solely for emergency dispatch. GPS coordinates and address are
        transmitted to the 112 dispatch system and are not stored beyond the incident record.
      </p>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @keyframes wave {
          0% { transform: scaleY(0.6); }
          100% { transform: scaleY(1.4); }
        }
      `}</style>
    </div>
  );
}
