/**
 * useCallSocket — manages the WebSocket connection for the CallerView.
 * Handles mic audio capture, PCM encoding, and playback of Nova Sonic audio.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WsClientMessage,
  WsServerMessage,
  WsTranscriptUpdateMessage,
  WsIncidentClassifiedMessage,
  TranscriptionRole,
  IncidentType,
  IncidentPriority,
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

export function useCallSocket() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [classification, setClassification] =
    useState<ClassificationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
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
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => {
      playingRef.current = false;
      playNextInQueue();
    };
    src.start();
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

        // Capture audio via MediaRecorder, emit ~32ms chunks
        const recorder = new MediaRecorder(stream, {
          mimeType: "audio/webm;codecs=opus",
        });
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = async (e) => {
          if (e.data.size === 0) return;
          const arrayBuf = await e.data.arrayBuffer();
          const base64 = btoa(
            String.fromCharCode(...new Uint8Array(arrayBuf))
          );
          send({ type: "audio_chunk", data: base64 });
        };

        recorder.start(32); // 32ms chunks
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
          case "error":
            setErrorMessage(msg.message);
            break;
          case "call_ended":
            setStatus("ended");
            mediaRecorderRef.current?.stop();
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
    mediaRecorderRef.current?.stop();
    flushAudioQueue();
    wsRef.current?.close();
    setStatus("ended");
  }, [send, flushAudioQueue]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      mediaRecorderRef.current?.stop();
      audioCtxRef.current?.close().catch(() => undefined);
    };
  }, []);

  return {
    status,
    incidentId,
    transcript,
    classification,
    errorMessage,
    startCall,
    endCall,
    flushAudioQueue,
  };
}
