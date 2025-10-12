```tsx
import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Brush,
  ReferenceArea,
} from 'recharts';

export type TrendMetric = {
  key: string;
  name: string;
  color: string;
  normalRange?: { min: number; max: number };
};

export type DataPoint = {
  timestamp: number; // UTC epoch ms
  [metricKey: string]: number | number[] | string | undefined; 
  // timestamp is mandatory, other metrics as number
};

export type TimeRange = 'day' | 'week' | 'month' | 'year';

export interface TrendAnalysisChartProps {
  data: DataPoint[];
  metrics: TrendMetric[];
  initialTimeRange?: TimeRange;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

const timeRangeDurations: Record<TimeRange, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

function formatXAxis(tickItem: number): string {
  const date = new Date(tickItem);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatTooltipLabel(label: number): string {
  const date = new Date(label);
  return date.toLocaleString();
}

function downloadCsv(data: DataPoint[], metrics: TrendMetric[]) {
  if (!data.length) return;

  const headers = ['timestamp', ...metrics.map((m) => m.name)];
  const rows = data.map((dp) => {
    const row = [new Date(dp.timestamp).toISOString()];
    for (const metric of metrics) {
      const val = dp[metric.key];
      row.push(typeof val === 'number' ? val.toString() : '');
    }
    return row.join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `trend-analysis-data-${new Date().toISOString()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function isAbnormal(value: number, range?: { min: number; max: number }): boolean {
  if (!range) return false;
  return value < range.min || value > range.max;
}

const TrendAnalysisChart: React.FC<TrendAnalysisChartProps> = ({
  data,
  metrics,
  initialTimeRange = 'month',
  height = 400,
  className,
  style,
}) => {
  const [timeRange, setTimeRange] = useState<TimeRange>(initialTimeRange);
  const [filteredData, setFilteredData] = useState<DataPoint[]>([]);
  const [zoomDomain, setZoomDomain] = useState<{ startIndex: number; endIndex: number } | null>(null);

  // Sort data by timestamp ascending
  const sortedData = useMemo(() => [...data].sort((a, b) => a.timestamp - b.timestamp), [data]);

  // Determine filtering by time range from last data point
  useEffect(() => {
    if (!sortedData.length) {
      setFilteredData([]);
      return;
    }
    const end = sortedData[sortedData.length - 1].timestamp;
    const duration = timeRangeDurations[timeRange];
    const rangeStart = end - duration;

    const filtered = sortedData.filter((d) => d.timestamp >= rangeStart && d.timestamp <= end);
    setFilteredData(filtered);
    setZoomDomain(null);
  }, [timeRange, sortedData]);

  // Manage zoom and pan with Brush + ReferenceArea (for pan, we use Brush only)
  // We keep zoomDomain to slice data shown in lines

  const displayedData = useMemo(() => {
    if (!filteredData.length) return [];
    if (!zoomDomain) return filteredData;
    const { startIndex, endIndex } = zoomDomain;
    return filteredData.slice(startIndex, endIndex + 1);
  }, [filteredData, zoomDomain]);

  const handleBrushChange = (newDomain: any) => {
    if (!newDomain || newDomain.startIndex === undefined || newDomain.endIndex === undefined) {
      setZoomDomain(null);
      return;
    }
    setZoomDomain({ startIndex: newDomain.startIndex, endIndex: newDomain.endIndex });
  };

  return (
    <div className={className} style={{ position: 'relative', userSelect: 'none', ...style }}>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {(['day', 'week', 'month', 'year'] as TimeRange[]).map((range) => (
          <button
            key={range}
            type="button"
            onClick={() => setTimeRange(range)}
            style={{
              padding: '6px 12px',
              backgroundColor: timeRange === range ? '#1976d2' : '#e0e0e0',
              color: timeRange === range ? '#fff' : '#000',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
            aria-pressed={timeRange === range}
          >
            {range.charAt(0).toUpperCase() + range.slice(1)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => downloadCsv(displayedData, metrics)}
          style={{
            marginLeft: 'auto',
            padding: '6px 12px',
            backgroundColor: '#4caf50',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            userSelect: 'none',
          }}
          title="Export visible data to CSV"
        >
          Export CSV
        </button>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={displayedData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={formatXAxis}
            tick={{ fontSize: 12 }}
            scale="time"
          />
          <YAxis allowDecimals={false} />
          <Tooltip
            labelFormatter={formatTooltipLabel}
            formatter={(value: any, name: string) => {
              if (typeof value === 'number') return [value.toFixed(2), name];
              return [value, name];
            }}
          />
          <Legend />
          {metrics.map(({ key, color, name, normalRange }) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={color}
              dot={false}
              isAnimationActive={false}
              strokeWidth={2}
              strokeOpacity={1}
              label={false}
              // Custom dot to color-code abnormal points
              dot={(props) => {
                const { cx, cy, payload, index } = props;
                if (typeof payload[key] !== 'number') return null;
                const val = payload[key] as number;
                const abnormal = isAbnormal(val, normalRange);
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill={abnormal ? '#e53935' : color}
                    stroke={abnormal ? '#b71c1c' : color}
                    strokeWidth={1.5}
                  />
                );
              }}
            />
          ))}
          <Brush
            dataKey="timestamp"
            height={30}
            stroke="#1976d2"
            travellerWidth={10}
            tickFormatter={formatXAxis}
            startIndex={zoomDomain?.startIndex}
            endIndex={zoomDomain?.endIndex}
            onChange={handleBrushChange}
            travellerFontSize={12}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TrendAnalysisChart;
```