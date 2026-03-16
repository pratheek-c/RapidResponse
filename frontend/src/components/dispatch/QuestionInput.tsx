import { useState, useRef, useEffect } from "react";
import { Mic, MicOff, Send, Loader2 } from "lucide-react";

type QuestionInputProps = {
  onAsk: (question: string) => Promise<void>;
};

// Web Speech API — not in TypeScript's default lib; declare minimal types here
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export function QuestionInput({ onAsk }: QuestionInputProps) {
  const [question, setQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceSupported] = useState(
    () => typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
  );
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function startVoice() {
    const SpeechRecognitionCtor =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-IE"; // Irish English for Dublin DECC
    recognition.continuous = false;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    recognition.onstart = () => setRecording(true);

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setQuestion(transcript);

      // If final result, clear any pending debounce and start a new one
      if (event.results[event.results.length - 1].isFinal) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          // Don't auto-submit — let dispatcher review before sending
        }, 1200);
      }
    };

    recognition.onerror = () => setRecording(false);
    recognition.onend = () => setRecording(false);

    recognition.start();
  }

  function stopVoice() {
    recognitionRef.current?.stop();
    setRecording(false);
  }

  function toggleVoice() {
    if (recording) {
      stopVoice();
    } else {
      startVoice();
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    // Stop any active recording before submitting
    if (recording) stopVoice();
    setSubmitting(true);
    try {
      await onAsk(trimmed);
      setQuestion("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={recording ? "Listening…" : "Ask caller a follow-up question"}
            disabled={submitting}
            aria-label="Follow-up question for caller"
            className={`w-full rounded-md border bg-slate-950 px-2 py-1.5 pr-8 text-sm text-slate-100 outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60 ${
              recording
                ? "border-red-500/70 ring-1 ring-red-500/50"
                : "border-slate-700"
            }`}
          />
          {recording && (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
              <span className="block h-2 w-2 animate-ping rounded-full bg-red-500 opacity-75" />
            </span>
          )}
        </div>

        {/* Voice button — only rendered if supported */}
        {voiceSupported && (
          <button
            type="button"
            onClick={toggleVoice}
            disabled={submitting}
            title={recording ? "Stop recording (click to stop)" : "Start voice input (hold or click)"}
            aria-label={recording ? "Stop voice recording" : "Start voice input"}
            className={`flex items-center justify-center rounded-md border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-60 ${
              recording
                ? "border-red-600 bg-red-600/30 text-red-200 hover:bg-red-600/40"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:bg-slate-800"
            }`}
          >
            {recording ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          </button>
        )}

        <button
          type="submit"
          disabled={submitting || !question.trim()}
          title="Send question to AI dispatcher (Enter)"
          className="flex items-center gap-1 rounded-md border border-blue-700 bg-blue-600/30 px-3 py-1.5 text-xs font-semibold text-blue-100 transition-colors hover:bg-blue-600/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          {submitting ? "Sending" : "Ask"}
        </button>
      </form>

      {recording && (
        <p className="mt-1 text-[10px] text-red-400">
          Recording — speak clearly, then click Stop or press Ask to submit.
        </p>
      )}
    </div>
  );
}
