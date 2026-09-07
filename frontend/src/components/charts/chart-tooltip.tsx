interface ChartTooltipRow {
  label: string
  value: string | number
  color?: string
}

export function ChartTooltipBox({ title, rows }: { title: string; rows: ChartTooltipRow[] }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5 shadow-popover">
      <p className="mb-1.5 text-xs font-semibold text-foreground">{title}</p>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {row.color ? (
                <span className="h-2 w-2 rounded-full" style={{ background: row.color }} />
              ) : null}
              {row.label}
            </span>
            <span className="ml-auto font-semibold tabular-nums text-foreground">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
