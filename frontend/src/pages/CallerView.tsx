/**
 * CallerView — Emergency 911 caller page.
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
 * The "Call 911" button only appears before arming starts.
 * Once armed it becomes "End Call".
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { useCallSocket } from "@/hooks/useCallSocket";
import { useCallerInfo } from "@/hooks/useCallerInfo";

// ---------------------------------------------------------------------------
// Waveform animation component
// ---------------------------------------------------------------------------

type WaveformState = "idle" | "arming" | "ready" | "listening" | "agent_speaking";

function Waveform({ state }: { state: WaveformState }) {
  const bars = 7;
  const config: Record<WaveformState, { color: string; heights: number[]; animated: boolean }> = {
    idle:          { color: "#334155", heights: [4,4,4,4,4,4,4], animated: false },
    arming:        { color: "#f97316", heights: [8,14,10,16,10,14,8], animated: true },
    ready:         { color: "#22c55e", heights: [6,10,8,12,8,10,6], animated: true },
    listening:     { color: "#3b82f6", heights: [10,20,14,24,14,20,10], animated: true },
    agent_speaking:{ color: "#a78bfa", heights: [12,22,16,28,16,22,12], animated: true },
  };
  const { color, heights, animated } = config[state];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        height: 36,
      }}
    >
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 4,
            height: heights[i],
            borderRadius: 2,
            background: color,
            ...(animated
              ? {
                  animation: `wave ${0.6 + i * 0.08}s ease-in-out infinite alternate`,
                  animationDelay: `${i * 0.07}s`,
                }
              : {}),
            transition: "height 0.3s, background 0.3s",
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status label for voice state
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
    idle:           "#334155",
    arming:         "#f97316",
    ready:          "#22c55e",
    listening:      "#3b82f6",
    agent_speaking: "#a78bfa",
  };
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 700,
        color: colors[state],
        textAlign: "center",
        letterSpacing: 0.3,
        minHeight: 18,
      }}
    >
      {labels[state]}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Info row (before call)
// ---------------------------------------------------------------------------

function InfoRow({
  label,
  value,
  status,
  icon,
}: {
  label: string;
  value: string;
  status: "loading" | "ok" | "warn" | "error";
  icon: string;
}) {
  const statusColor = { loading: "#f97316", ok: "#22c55e", warn: "#eab308", error: "#ef4444" };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "#111827",
        borderRadius: 8,
        padding: "10px 14px",
        border: "1px solid #1e2433",
      }}
    >
      <span style={{ fontSize: 16 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 1 }}>
          {label}
        </div>
        <div
          style={{
            fontSize: 13,
            color: value ? "#e2e8f0" : "#475569",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {value || "Detecting…"}
        </div>
      </div>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: statusColor[status],
          flexShrink: 0,
          ...(status === "loading" ? { animation: "pulse 1.2s ease-in-out infinite" } : {}),
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function CallerView() {
  const { callerId, coords, address, geoStatus, geoError, requestLocation } =
    useCallerInfo();

  const {
    status,
    incidentId,
    transcript,
    classification,
    errorMessage,
    startCall,
    endCall,
  } = useCallSocket();

  // Track whether we've kicked off auto-arm so we don't double-fire
  const hasAutoArmed = useRef(false);

  // Voice UI state (derived from call status + audio activity)
  const [voiceState, setVoiceState] = useState<WaveformState>("idle");
  // Track whether agent audio is currently playing (approximated by audio_response msgs)
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const agentSpeakingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-arm: fire startCall as soon as we have a callerId
  // (coords enhance the call but are not required to start)
  useEffect(() => {
    if (hasAutoArmed.current) return;
    if (!callerId) return;
    if (status !== "idle") return;

    hasAutoArmed.current = true;
    setVoiceState("arming");

    void startCall(
      callerId,
      coords || "Unknown location",
      address || coords || "Unknown address"
    );
  }, [callerId, coords, address, status, startCall]);

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

  // When agent audio arrives, mark as speaking for ~2s after last chunk
  const onAgentAudio = useCallback(() => {
    setAgentSpeaking(true);
    if (agentSpeakingTimer.current) clearTimeout(agentSpeakingTimer.current);
    agentSpeakingTimer.current = setTimeout(() => {
      setAgentSpeaking(false);
    }, 1500);
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (agentSpeakingTimer.current) clearTimeout(agentSpeakingTimer.current);
    };
  }, []);

  // Signal agent speaking on new agent transcript turns
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
    geoStatus === "granted"
      ? "ok"
      : geoStatus === "requesting" || geoStatus === "idle"
      ? "loading"
      : "error";

  const addressInfoStatus =
    address ? "ok" : geoStatus === "granted" ? "loading" : geoInfoStatus;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#080a0f",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "32px 16px 60px",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 28,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "#ef4444",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
            }}
          >
            🚨
          </div>
          <span style={{ fontWeight: 800, fontSize: 18, color: "#f8fafc", letterSpacing: -0.5 }}>
            RapidResponse.ai
          </span>
        </div>
        <Link
          to="/dashboard"
          style={{ color: "#475569", textDecoration: "none", fontSize: 12, fontWeight: 600 }}
        >
          Dispatcher Dashboard
        </Link>
      </div>

      {/* Main card */}
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          background: "#0d1117",
          borderRadius: 20,
          border: "1px solid #1e2433",
          padding: "28px 28px 32px",
          boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
        }}
      >
        {/* Voice UI — always visible when arming or armed */}
        {(isArmed || isConnecting || isEnded) && (
          <div
            style={{
              textAlign: "center",
              marginBottom: 24,
              padding: "24px 16px",
              background: "#080a0f",
              borderRadius: 14,
              border: "1px solid #1e2433",
            }}
          >
            {/* Incident badge */}
            {incidentId && (
              <div
                style={{
                  fontSize: 10,
                  color: "#475569",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 12,
                }}
              >
                Incident #{incidentId.slice(0, 8)}
              </div>
            )}

            {/* Waveform */}
            <div style={{ marginBottom: 10 }}>
              <Waveform state={isEnded ? "idle" : voiceState} />
            </div>

            {/* Status label */}
            {!isEnded && (
              <VoiceStatusLabel state={voiceState} hasAudio={agentSpeaking} />
            )}

            {/* Ended state */}
            {isEnded && (
              <div style={{ fontSize: 13, color: "#64748b" }}>
                Call ended.
                {incidentId && (
                  <span> Incident #{incidentId.slice(0, 8)} has been logged.</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Pre-call: detected info (only shown before auto-arm fires) */}
        {canManualStart && !isEnded && !isError && !hasAutoArmed.current && (
          <>
            <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
              Detected Info
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              <InfoRow label="Caller ID" value={callerId} status="ok" icon="🪪" />
              <InfoRow label="GPS Coordinates" value={coords} status={geoInfoStatus} icon="📍" />
              <InfoRow label="Address" value={address} status={addressInfoStatus} icon="🏠" />
            </div>
          </>
        )}

        {/* Connecting state (brief) */}
        {isConnecting && !isArmed && (
          <div style={{ fontSize: 13, color: "#f97316", fontWeight: 600, textAlign: "center", marginBottom: 16 }}>
            Connecting to dispatch…
          </div>
        )}

        {/* Geo error (shown before arm if blocked) */}
        {geoError && canManualStart && (
          <div
            style={{
              background: "#1a0f0f",
              border: "1px solid #7f1d1d",
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 12, color: "#fca5a5" }}>{geoError}</span>
            <button
              onClick={requestLocation}
              style={{
                background: "none",
                border: "1px solid #7f1d1d",
                borderRadius: 6,
                color: "#fca5a5",
                fontSize: 11,
                fontWeight: 600,
                padding: "4px 10px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* WS / mic error */}
        {errorMessage && (
          <div
            style={{
              background: "#2d0f0f",
              border: "1px solid #7f1d1d",
              borderRadius: 8,
              padding: "10px 14px",
              color: "#fca5a5",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {errorMessage}
          </div>
        )}

        {/* Classification banner */}
        {classification && (
          <div
            style={{
              background: "#0f2940",
              border: "1px solid #1d4ed8",
              borderRadius: 10,
              padding: "12px 16px",
              marginBottom: 16,
              fontSize: 13,
              color: "#bfdbfe",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 16 }}>🚔</span>
            <div>
              <strong>Incident classified:</strong>{" "}
              {classification.incident_type.replace(/_/g, " ")}{" "}
              <span style={{ color: "#f97316", fontWeight: 700 }}>
                [{classification.priority}]
              </span>
            </div>
          </div>
        )}

        {/* CTA area */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 8 }}>
          {/* Manual start — only if auto-arm failed or user manually ended */}
          {canManualStart && hasAutoArmed.current && (
            <button
              onClick={() => {
                hasAutoArmed.current = false;
                // Reset and re-arm
                void startCall(
                  callerId || "CALLER-ANON",
                  coords || "Unknown location",
                  address || coords || "Unknown address"
                );
              }}
              style={{
                background: "linear-gradient(135deg, #dc2626, #b91c1c)",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                padding: "14px 40px",
                fontSize: 16,
                fontWeight: 800,
                cursor: "pointer",
                letterSpacing: 0.5,
                boxShadow: "0 4px 20px rgba(220,38,38,0.4)",
              }}
            >
              Call 911 Again
            </button>
          )}

          {/* End call button once armed */}
          {isArmed && (
            <button
              onClick={endCall}
              style={{
                background: "#1e2433",
                color: "#94a3b8",
                border: "1px solid #334155",
                borderRadius: 10,
                padding: "14px 32px",
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              End Call
            </button>
          )}
        </div>

        {/* Live transcript */}
        {transcript.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div
              style={{
                fontSize: 11,
                color: "#334155",
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 14,
                textAlign: "center",
              }}
            >
              Live Transcript
            </div>
            <div
              style={{
                maxHeight: 380,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                paddingRight: 4,
              }}
            >
              {transcript.map((line, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexDirection: line.role === "agent" ? "row-reverse" : "row",
                    gap: 10,
                    alignItems: "flex-start",
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: line.role === "agent" ? "#1d4ed8" : "#166534",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#fff",
                      flexShrink: 0,
                    }}
                  >
                    {line.role === "agent" ? "AI" : "Me"}
                  </div>
                  <div
                    style={{
                      background: line.role === "agent" ? "#1e3a5f" : "#14291e",
                      borderRadius:
                        line.role === "agent"
                          ? "12px 4px 12px 12px"
                          : "4px 12px 12px 12px",
                      padding: "9px 14px",
                      fontSize: 13,
                      color: "#e2e8f0",
                      maxWidth: "78%",
                      lineHeight: 1.6,
                    }}
                  >
                    {line.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <p
        style={{
          marginTop: 20,
          fontSize: 11,
          color: "#1e2433",
          textAlign: "center",
          maxWidth: 480,
        }}
      >
        Your location is used solely for emergency dispatch. GPS coordinates and address are
        transmitted to the 911 dispatch system and are not stored beyond the incident record.
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
        input:focus {
          border-color: #3b82f6 !important;
          box-shadow: 0 0 0 2px rgba(59,130,246,0.15);
        }
      `}</style>
    </div>
  );
}
