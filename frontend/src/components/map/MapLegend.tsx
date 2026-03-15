export function MapLegend() {
  return (
    <div className="flex h-10 items-center justify-between border-t border-slate-800 bg-command-panel px-4 text-xs text-slate-300">
      <div className="flex items-center gap-3">
        <span className="font-semibold">Severity</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-green-500" />1</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-blue-500" />2</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-yellow-500" />3</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-orange-500" />4</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-red-500" />5</span>
      </div>
      <div className="hidden items-center gap-3 md:flex">
        <span className="font-semibold">Unit Status</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-green-500" />available</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-500" />dispatched</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-violet-500" />on scene</span>
      </div>
    </div>
  );
}
