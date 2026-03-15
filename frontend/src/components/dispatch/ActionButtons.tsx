type ActionButtonsProps = {
  onAccept: () => Promise<void>;
  onEscalate: () => Promise<void>;
  onComplete: () => Promise<void>;
};

export function ActionButtons({ onAccept, onEscalate, onComplete }: ActionButtonsProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <button
        type="button"
        onClick={() => void onAccept()}
        className="rounded-md border border-emerald-700 bg-emerald-500/20 px-2 py-1.5 text-xs font-semibold text-emerald-100"
      >
        Accept
      </button>
      <button
        type="button"
        onClick={() => {
          if (window.confirm("Escalate this incident?")) {
            void onEscalate();
          }
        }}
        className="rounded-md border border-amber-700 bg-amber-500/20 px-2 py-1.5 text-xs font-semibold text-amber-100"
      >
        Escalate
      </button>
      <button
        type="button"
        onClick={() => void onComplete()}
        className="rounded-md border border-blue-700 bg-blue-500/20 px-2 py-1.5 text-xs font-semibold text-blue-100"
      >
        Complete
      </button>
    </div>
  );
}
