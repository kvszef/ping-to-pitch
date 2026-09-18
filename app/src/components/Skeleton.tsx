// Placeholders in the card style for briefing tiers that are still loading.

const Bar = ({ className = '' }: { className?: string }) => <div className={`skeleton h-3 ${className}`} />

export function CardSkeleton({ lines = 3, label }: { lines?: number; label?: string }) {
  const widths = ['w-11/12', 'w-4/5', 'w-2/3', 'w-3/4', 'w-1/2']
  return (
    <section aria-busy="true" aria-label={label ?? 'Wird geladen'} data-skeleton className="bg-white p-5 shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <div className="skeleton h-4 w-4" />
        <Bar className="h-4 w-40" />
        {label && <span className="ml-auto text-[10px] uppercase tracking-wide text-muted">{label}</span>}
      </div>
      <div className="space-y-2.5">{Array.from({ length: lines }, (_, i) => <Bar key={i} className={widths[i % widths.length]} />)}</div>
    </section>
  )
}

export function MetricsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Kennzahlen werden geladen" data-skeleton className="grid grid-cols-2 gap-2.5">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex aspect-[4/3] flex-col bg-white p-3 shadow-card">
          <Bar className="w-2/3" />
          <div className="skeleton mt-auto h-6 w-1/2" />
        </div>
      ))}
    </div>
  )
}
