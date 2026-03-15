import { useState } from "react";

type QuestionInputProps = {
  onAsk: (question: string) => Promise<void>;
};

export function QuestionInput({ onAsk }: QuestionInputProps) {
  const [question, setQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onAsk(trimmed);
      setQuestion("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="Ask caller follow-up"
        className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none focus:ring-1 focus:ring-blue-500"
      />
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md border border-blue-700 bg-blue-600/30 px-3 py-1.5 text-xs font-semibold text-blue-100 disabled:opacity-60"
      >
        {submitting ? "Sending..." : "Ask"}
      </button>
    </form>
  );
}
