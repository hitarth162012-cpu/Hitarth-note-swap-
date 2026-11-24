export function NoteGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="aspect-[4/3] w-full animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
          <div className="mt-4 h-3 w-1/2 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          <div className="mt-2 h-5 w-4/5 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          <div className="mt-3 flex items-center justify-between">
            <div className="h-4 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
            <div className="h-9 w-24 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
          </div>
        </div>
      ))}
    </div>
  );
}
