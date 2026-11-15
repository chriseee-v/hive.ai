import { useEffect, useRef, useState } from "react";
import type { Container, State } from "@/lib/hive";
import { cn } from "@/lib/utils";

const RANGES = [{ label: "30s", n: 23 }, { label: "1m", n: 46 }, { label: "2.5m", n: 120 }];
type Metric = "CPU" | "GPU" | "Both";

const stats = (d: number[]) => ({ now: d.at(-1) ?? 0, avg: Math.round(d.reduce((a, b) => a + b, 0) / Math.max(1, d.length)), peak: Math.max(0, ...d) });

export function HistoryChart({ s, className }: { s: State; className?: string }) {
  const [metric, setMetric] = useState<Metric>("Both");
  const [range, setRange] = useState(1);
  const n = RANGES[range]!.n;
  const series = [
    { key: "CPU", data: s.cpuHist.slice(-n), color: "var(--primary)" },
    { key: "GPU", data: s.gpuHist.slice(-n), color: "var(--cyan)" },
  ].filter((x) => metric === "Both" || x.key === metric);
  const W = 600, H = 160;
  const path = (d: number[]) => d.map((v, i) => `${i === 0 ? "M" : "L"}${(i / Math.max(1, n - 1)) * W + (n - d.length) / Math.max(1, n - 1) * W},${H - (v / 100) * H}`).join(" ");
  const Seg = <T,>({ opts, val, set }: { opts: T[]; val: T; set: (v: T) => void }) => (
    <div className="flex gap-1 rounded-full bg-background p-1">
      {opts.map((o) => <button key={String(o)} onClick={() => set(o)} className={cn("h-11 min-w-14 rounded-full px-4 text-sm", val === o ? "bg-foreground font-semibold text-background" : "text-muted-foreground")}>{String(o)}</button>)}
    </div>
  );
  return (
    <div className={cn("border border-border bg-card p-6", className)}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="font-mono text-[11px] tracking-widest text-muted-foreground">00 LOAD HISTORY</div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Seg opts={["CPU", "GPU", "Both"] as Metric[]} val={metric} set={setMetric} />
          <Seg opts={RANGES.map((r) => r.label)} val={RANGES[range]!.label} set={(l) => setRange(RANGES.findIndex((r) => r.label === l))} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-6 font-mono">
        {series.map((x) => { const st = stats(x.data); const diff = st.now - st.avg; return (
          <div key={x.key} className="flex items-baseline gap-4">
            <span className="text-[11px]" style={{ color: x.color }}>● {x.key}</span>
            <span className="text-2xl">{st.now}%</span>
            <span className="text-xs text-muted-foreground">avg {st.avg}% · peak {st.peak}%</span>
            <span className={cn("text-xs", diff > 0 ? "text-primary" : "text-success")}>{diff > 0 ? "▲" : "▼"} {Math.abs(diff)} vs avg</span>
          </div>); })}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="dotgrid mt-4 h-44 w-full rounded-2xl">
        {[25, 50, 75].map((y) => <line key={y} x1="0" x2={W} y1={H - (y / 100) * H} y2={H - (y / 100) * H} stroke="var(--border)" strokeDasharray="2 6" vectorEffect="non-scaling-stroke" />)}
        {series.map((x) => <g key={x.key}>
          <path d={path(x.data)} fill="none" stroke={x.color} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <line x1="0" x2={W} y1={H - (stats(x.data).avg / 100) * H} y2={H - (stats(x.data).avg / 100) * H} stroke={x.color} opacity=".35" strokeDasharray="6 6" vectorEffect="non-scaling-stroke" />
        </g>)}
      </svg>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground"><span>−{RANGES[range]!.label}</span><span>dashed = average</span><span>now</span></div>
    </div>
  );
}

export function HealthBadge({ c }: { c: Container }) {
  const [label, cls] = c.state === "restarting" ? ["RESTARTING", "border-primary text-primary animate-pulse"]
    : c.state === "stopped" ? ["STOPPED", "border-border text-muted-foreground"]
    : c.health === "starting" ? ["STARTING", "border-primary text-primary"]
    : c.health === "unhealthy" ? ["UNHEALTHY", "border-destructive text-destructive"]
    : ["HEALTHY", "border-success text-success"];
  return <span className={cn("rounded-full border px-2.5 py-1 font-mono text-[11px]", cls)}>{label}</span>;
}

export function ContainerLog({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => { if (follow) ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [lines.length, follow]);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
        <span>LOGS · {lines.length} lines</span>
        <button onClick={() => setFollow(!follow)} className={cn("h-11 rounded-full px-4", follow ? "bg-foreground text-background" : "bg-card-2")}>{follow ? "Following" : "Paused · follow"}</button>
      </div>
      <div ref={ref} onTouchStart={() => setFollow(false)} onWheel={() => setFollow(false)} className="h-56 overflow-y-auto rounded-2xl bg-background p-3 font-mono text-xs leading-relaxed">
        {lines.map((l, i) => <div key={i} className={/restart|SIGTERM|pending/.test(l) ? "text-primary" : /healthy|started/.test(l) ? "text-success" : "text-muted-foreground"}>{l}</div>)}
      </div>
    </div>
  );
}
