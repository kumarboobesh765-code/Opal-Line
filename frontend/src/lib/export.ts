import type { ColumnDef } from '@/lib/table'

function csvCell(value: unknown): string {
  if (value == null) return ''
  let s = String(value)
  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  // Prevent formula injection: neutralise cells that start with = + - @ tab CR
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return s
}

export function exportTable<TData extends Record<string, any> | Array<any>>(
  filename: string,
  columns: ColumnDef<TData>[],
  rows: TData[],
): void {
  const header: string[] = []
  const accessors: ((row: TData) => unknown)[] = []

  for (const col of columns) {
    const c = col as {
      id?: string
      accessorKey?: string
      accessorFn?: (row: TData, index: number) => unknown
      header?: unknown
    }
    const id = c.id ?? c.accessorKey ?? ''
    if (id === 'actions' || id === 'select') continue
    const label = typeof c.header === 'string' ? c.header : id
    if (!label) continue
    header.push(label)
    if (typeof c.accessorKey === 'string') {
      const key = c.accessorKey
      accessors.push((row) => (row as Record<string, unknown>)[key])
    } else if (typeof c.accessorFn === 'function') {
      accessors.push((row) => (c.accessorFn as (row: TData, index: number) => unknown)(row, 0))
    } else if (id) {
      accessors.push((row) => (row as Record<string, unknown>)[id])
    } else {
      accessors.push(() => '')
    }
  }

  const lines = [header.map(csvCell)]
  for (const row of rows) {
    lines.push(accessors.map((acc) => csvCell(acc(row))))
  }

  const csv = lines.map((line) => line.join(',')).join('\r\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function exportCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return
  const keys = Object.keys(rows[0])
  const lines = [keys.map(csvCell)]
  for (const row of rows) {
    lines.push(keys.map((k) => csvCell(row[k])))
  }
  const csv = lines.map((line) => line.join(',')).join('\r\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
