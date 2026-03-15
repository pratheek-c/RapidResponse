/**
 * useCallSocket — manages the WebSocket connection for the CallerView.
 * Handles mic audio capture, PCM encoding, and playback of Nova Sonic audio.
 * Also handles report_update and dispatcher_approaching messages from the Report Agent.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WsClientMessage,
  WsServerMessage,
  WsTranscriptUpdateMessage,
  WsIncidentClassifiedMessage,
  WsReportUpdateMessage,
  WsDispatcherApproachingMessage,
  TranscriptionRole,
  IncidentType,
  IncidentPriority,
  IncidentReport,
} from "@/types";

const WS_BASE = import.meta.env.VITE_WS_BASE ?? `ws://${window.location.host}`;

export type TranscriptLine = {
  role: TranscriptionRole;
  text: string;
};

export type CallStatus =
  | "idle"
  | "connecting"
  | "active"
  | "ended"
  | "error";

export type ClassificationResult = {
  incident_type: IncidentType;
  priority: IncidentPriority;
};

export type ApproachingUnit = {
  unit_code: string;
  eta_minutes: number;
  crew: { name: string; role: string }[];
};

export function useCallSocket() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [classification, setClassification] =
    useState<ClassificationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [report, setReport] = useState<IncidentReport | null>(null);
  const [approachingUnit, setApproachingUnit] = useState<ApproachingUnit | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mediaRecorderRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const playingRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Audio playback helpers (Nova Sonic 24kHz mono PCM response)
  // ---------------------------------------------------------------------------
  const getAudioContext = useCallback((): AudioContext => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext({ sampleRate: 24000 });
    }
    return audioCtxRef.current;
  }, []);

  const playNextInQueue = useCallback(() => {
    if (playingRef.current || audioQueueRef.current.length === 0) return;
    const ctx = getAudioContext();
    const buf = audioQueueRef.current.shift()!;
    playingRef.current = true;
    const play = () => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = () => {
        playingRef.current = false;
        playNextInQueue();
      };
      src.start();
    };
    if (ctx.state === "suspended") {
      ctx.resume().then(play).catch(() => { playingRef.current = false; });
    } else {
      play();
    }
  }, [getAudioContext]);

  const enqueueAudio = useCallback(
    (base64pcm: string) => {
      const ctx = getAudioContext();
      const binary = atob(base64pcm);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      // PCM 16-bit little-endian → float32
      const samples = bytes.length / 2;
      const buf = ctx.createBuffer(1, samples, 24000);
      const channel = buf.getChannelData(0);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < samples; i++) {
        channel[i] = view.getInt16(i * 2, true) / 32768;
      }
      audioQueueRef.current.push(buf);
      playNextInQueue();
    },
    [getAudioContext, playNextInQueue]
  );

  const flushAudioQueue = useCallback(() => {
    audioQueueRef.current = [];
    playingRef.current = false;
  }, []);

  const stopCapture = useCallback(() => {
    const cap = mediaRecorderRef.current;
    if (!cap) return;
    try {
      cap.processor?.disconnect();
      cap.source?.disconnect();
      cap.captureCtx?.close();
    } catch { /* ignore */ }
    mediaRecorderRef.current = null;
  }, []);

  // ---------------------------------------------------------------------------
  // Send helpers
  // ---------------------------------------------------------------------------
  const send = useCallback((msg: WsClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Start call
  // ---------------------------------------------------------------------------
  const startCall = useCallback(
    async (callerId: string, location: string, address: string) => {
      setStatus("connecting");
      setTranscript([]);
      setClassification(null);
      setErrorMessage(null);
      setReport(null);
      setApproachingUnit(null);

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setStatus("error");
        setErrorMessage("Microphone access denied.");
        return;
      }

      const ws = new WebSocket(`${WS_BASE}/call`);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("active");
        send({ type: "call_start", caller_id: callerId, location, address });

        // Capture raw PCM 16kHz 16-bit mono via ScriptProcessorNode
        // Nova Sonic requires LPCM — MediaRecorder gives WebM/Opus which it can't decode
        const captureCtx = new AudioContext({ sampleRate: 16000 });
        const source = captureCtx.createMediaStreamSource(stream);
        // 512 samples @ 16kHz = 32ms per chunk
        const processor = captureCtx.createScriptProcessor(512, 1, 1);
        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const float32 = e.inputBuffer.getChannelData(0);
          const int16 = new Int16Array(float32.length);
          for (let i = 0; i < float32.length; i++) {
            int16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
          }
          const bytes = new Uint8Array(int16.buffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          send({ type: "audio_chunk", data: btoa(binary) });
        };
        source.connect(processor);
        processor.connect(captureCtx.destination);

        // Store processor so we can disconnect on call end
        (mediaRecorderRef as React.MutableRefObject<unknown>).current = { captureCtx, source, processor };
      };

      ws.onmessage = (ev: MessageEvent<string>) => {
        let msg: WsServerMessage;
        try {
          msg = JSON.parse(ev.data) as WsServerMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case "call_accepted":
            setIncidentId(msg.incident_id);
            break;
          case "audio_response":
            enqueueAudio(msg.data);
            break;
          case "transcript_update": {
            const t = msg as WsTranscriptUpdateMessage;
            setTranscript((prev) => [...prev, { role: t.role, text: t.text }]);
            break;
          }
          case "incident_classified": {
            const c = msg as WsIncidentClassifiedMessage;
            setClassification({
              incident_type: c.incident_type,
              priority: c.priority,
            });
            break;
          }
          case "report_update": {
            const r = msg as WsReportUpdateMessage;
            setReport(r.report);
            break;
          }
          case "dispatcher_approaching": {
            const a = msg as WsDispatcherApproachingMessage;
            setApproachingUnit({
              unit_code: a.unit_code,
              eta_minutes: a.eta_minutes,
              crew: a.crew,
            });
            break;
          }
          case "error":
            setErrorMessage(msg.message);
            break;
          case "call_ended":
            setStatus("ended");
            stopCapture();
            stream.getTracks().forEach((t) => t.stop());
            break;
        }
      };

      ws.onerror = () => {
        setStatus("error");
        setErrorMessage("WebSocket connection error.");
      };

      ws.onclose = () => {
        if (status !== "ended") setStatus("ended");
        stopCapture();
        stream.getTracks().forEach((t) => t.stop());
      };
    },
    [send, enqueueAudio, status]
  );

  // ---------------------------------------------------------------------------
  // End call
  // ---------------------------------------------------------------------------
  const endCall = useCallback(() => {
    send({ type: "call_end" });
    stopCapture();
    flushAudioQueue();
    wsRef.current?.close();
    setStatus("ended");
  }, [send, stopCapture, flushAudioQueue]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      stopCapture();
      audioCtxRef.current?.close().catch(() => undefined);
    };
  }, [stopCapture]);

  return {
    status,
    incidentId,
    transcript,
    classification,
    errorMessage,
    report,
    approachingUnit,
    startCall,
    endCall,
    flushAudioQueue,
  };
}
