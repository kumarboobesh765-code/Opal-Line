import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { SilverRatePoint } from '@/types'
import { ChartTooltipBox } from './chart-tooltip'

const PURPLE = '#7c3aed'
const GREEN = '#16a34a'

export function SilverRateChart({ data }: { data: SilverRatePoint[] }) {
  const rates = data.map((d) => d.rate).filter((r) => Number.isFinite(r))
  const min = rates.length ? Math.floor(Math.min(...rates)) - 2 : 80
  const max = rates.length ? Math.ceil(Math.max(...rates)) + 2 : 100
  const domain = rates.length ? [Math.max(0, min), max] : [80, 100]

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 15% 90%)" vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tick={{ fill: '#71717a', fontSize: 11 }}
            dy={6}
          />
          <YAxis
            domain={domain as [number, number]}
            tickLine={false}
            axisLine={false}
            width={42}
            tick={{ fill: '#71717a', fontSize: 11 }}
            tickFormatter={(v: number) => `₹${v}`}
          />
          <Tooltip
            cursor={{ stroke: PURPLE, strokeWidth: 1, strokeDasharray: '4 4' }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as SilverRatePoint
              return (
                <ChartTooltipBox
                  title={String(label)}
                  rows={[{ label: 'Rate', value: `₹${p.rate.toFixed(2)} / gm`, color: GREEN }]}
                />
              )
            }}
          />
          <Line
            type="monotone"
            dataKey="rate"
            stroke={GREEN}
            strokeWidth={2}
            dot={{ r: 2.5, fill: PURPLE, strokeWidth: 0 }}
            activeDot={{ r: 4, fill: PURPLE, stroke: '#fff', strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
