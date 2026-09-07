import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { SalesOverviewPoint } from '@/types'
import { compactCurrency } from '@/lib/format'
import { ChartTooltipBox } from './chart-tooltip'

const PURPLE = '#7c3aed'
const PURPLE_LIGHT = '#a78bfa'

export function SalesOverviewChart({ data }: { data: SalesOverviewPoint[] }) {
  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PURPLE} stopOpacity={0.22} />
              <stop offset="100%" stopColor={PURPLE} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 15% 90%)" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: '#71717a', fontSize: 11 }}
            dy={6}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={58}
            tick={{ fill: '#71717a', fontSize: 11 }}
            tickFormatter={(v: number) => compactCurrency(v)}
          />
          <Tooltip
            cursor={{ stroke: PURPLE_LIGHT, strokeWidth: 1, strokeDasharray: '4 4' }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as SalesOverviewPoint
              return (
                <ChartTooltipBox
                  title={String(label)}
                  rows={[
                    { label: 'Revenue', value: compactCurrency(p.revenue), color: PURPLE },
                    { label: 'Orders', value: p.orders, color: '#71717a' },
                  ]}
                />
              )
            }}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke={PURPLE}
            strokeWidth={2}
            fill="url(#salesFill)"
            dot={false}
            activeDot={{ r: 4, fill: PURPLE, strokeWidth: 2, stroke: '#fff' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
