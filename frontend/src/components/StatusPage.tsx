import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import type { SystemStatusResponse, SessionResourceUsage } from '@/types';

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '-';
  return `${value.toFixed(1)}%`;
}

type TotalPoint = {
  ts: number;
  cpu: number;
  mem: number;
  disk: number;
};

type SessionSeries = Record<string, { cpu: number[]; mem: number[]; disk: number[] }>;

function buildPolyline(points: number[]) {
  if (points.length === 0) return '';
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = Math.max(max - min, 1);
  return points
    .map((value, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * 100;
      const y = 40 - ((value - min) / range) * 36 - 2;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

function Sparkline({ points, color }: { points: number[]; color: string }) {
  const polyline = useMemo(() => buildPolyline(points), [points]);
  return (
    <svg viewBox="0 0 100 40" className="w-full h-10">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={polyline}
      />
    </svg>
  );
}

export function StatusPage() {
  const [data, setData] = useState<SystemStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalHistory, setTotalHistory] = useState<TotalPoint[]>([]);
  const [sessionHistory, setSessionHistory] = useState<SessionSeries>({});

  const maxPoints = 120; // 10 minutes at 5s interval

  const fetchStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getSystemStatus();
      setData(result);
      const now = Date.now();
      setTotalHistory((prev) => {
        const next = [
          ...prev,
          {
            ts: now,
            cpu: result.total.cpu_percent,
            mem: result.total.memory_percent,
            disk: result.total.disk_percent,
          },
        ];
        return next.slice(-maxPoints);
      });
      setSessionHistory((prev) => {
        const next: SessionSeries = { ...prev };
        result.sessions.forEach((session) => {
          const existing = next[session.session_id] || { cpu: [], mem: [], disk: [] };
          next[session.session_id] = {
            cpu: [...existing.cpu, session.cpu_percent].slice(-maxPoints),
            mem: [...existing.mem, session.memory_percent].slice(-maxPoints),
            disk: [...existing.disk, session.disk_percent].slice(-maxPoints),
          };
        });
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const sessions = data?.sessions || [];
  const total = data?.total;

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6" data-testid="status-page">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h1 className="text-2xl font-bold">系统资源状态</h1>
            <p className="text-sm text-muted-foreground">
              {data ? `更新时间 ${new Date(data.timestamp).toLocaleString()}` : '等待数据加载'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchStatus} disabled={loading} data-testid="status-refresh">
              刷新
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.location.assign('/')}
            >
              返回
            </Button>
          </div>
        </div>

        {error && (
          <div className="px-4 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">总资源占用率</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="rounded-lg border border-border/50 p-3">
              <div className="text-muted-foreground">CPU</div>
              <div className="text-xl font-semibold mt-1">{formatPercent(total?.cpu_percent ?? 0)}</div>
            </div>
            <div className="rounded-lg border border-border/50 p-3">
              <div className="text-muted-foreground">内存</div>
              <div className="text-xl font-semibold mt-1">{formatPercent(total?.memory_percent ?? 0)}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {formatBytes(total?.memory_used_bytes ?? 0)} / {formatBytes(total?.memory_total_bytes ?? 0)}
              </div>
            </div>
            <div className="rounded-lg border border-border/50 p-3">
              <div className="text-muted-foreground">硬盘</div>
              <div className="text-xl font-semibold mt-1">{formatPercent(total?.disk_percent ?? 0)}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {formatBytes(total?.disk_used_bytes ?? 0)} / {formatBytes(total?.disk_total_bytes ?? 0)}
              </div>
            </div>
          </CardContent>
          <CardContent className="pt-0 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="rounded-lg border border-border/50 p-3">
              <div className="text-xs text-muted-foreground mb-2">CPU 趋势（5s）</div>
              <Sparkline points={totalHistory.map((p) => p.cpu)} color="var(--primary)" />
            </div>
            <div className="rounded-lg border border-border/50 p-3">
              <div className="text-xs text-muted-foreground mb-2">内存趋势（5s）</div>
              <Sparkline points={totalHistory.map((p) => p.mem)} color="var(--primary)" />
            </div>
            <div className="rounded-lg border border-border/50 p-3">
              <div className="text-xs text-muted-foreground mb-2">硬盘趋势（5s）</div>
              <Sparkline points={totalHistory.map((p) => p.disk)} color="var(--primary)" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">各 Session 资源占用</CardTitle>
          </CardHeader>
          <CardContent>
            {sessions.length === 0 && (
              <div className="text-sm text-muted-foreground">暂无 session 数据</div>
            )}
            {sessions.length > 0 && (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-2 pr-4">Session</th>
                      <th className="py-2 pr-4">状态</th>
                      <th className="py-2 pr-4">CPU</th>
                      <th className="py-2 pr-4">内存</th>
                      <th className="py-2 pr-4">硬盘</th>
                      <th className="py-2 pr-4">趋势</th>
                      <th className="py-2 pr-4">进程</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((session: SessionResourceUsage) => {
                      const series = sessionHistory[session.session_id];
                      return (
                        <tr key={session.session_id} className="border-t border-border/50">
                        <td className="py-2 pr-4">
                          <div className="font-medium">
                            {session.display_name || session.session_id.slice(0, 8)}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {session.session_id}
                          </div>
                        </td>
                        <td className="py-2 pr-4">
                          <Badge variant="secondary" className="text-xs">
                            {session.status}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4">{formatPercent(session.cpu_percent)}</td>
                        <td className="py-2 pr-4">
                          <div>{formatPercent(session.memory_percent)}</div>
                          <div className="text-xs text-muted-foreground">{formatBytes(session.memory_bytes)}</div>
                        </td>
                        <td className="py-2 pr-4">
                          <div>{formatPercent(session.disk_percent)}</div>
                          <div className="text-xs text-muted-foreground">{formatBytes(session.disk_bytes)}</div>
                        </td>
                        <td className="py-2 pr-4 w-36">
                          <div className="grid grid-cols-1 gap-1">
                            <Sparkline points={series?.cpu || []} color="var(--primary)" />
                          </div>
                        </td>
                        <td className="py-2 pr-4">{session.process_count}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
