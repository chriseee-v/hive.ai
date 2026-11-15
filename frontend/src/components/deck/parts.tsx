import { useEffect, useRef } from "react";
import type { Agent, Container, LogLine, State } from "@/lib/hive";
import { cn } from "@/lib/utils";

export const pill = "h-11 min-w-11 rounded-full px-5 text-sm font-semibold transition active:scale-95 disabled:opacity-40";

export function Corner({ children, onClick, label }: { children: React.ReactNode; onClick?: () => void; label?: string }) {
  return (
    <button aria-label={label} onClick={onClick}
      className="absolute right-1 top-0 grid h-11 w-11 place-items-center rounded-full bg-card-2 text-sm text-foreground active:scale-95">
      {children}
    </button>
  );
}

export function Ring({ value, size = 116 }: { value: number; size?: number }) {
  const r = size / 2 - 12, c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--card-2)" strokeWidth="11" />
        <circle cx={size / 2} cy={size / 2} r={r + 9} fill="none" stroke="var(--border)" strokeWidth="2" strokeDasharray="1.5 5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--primary)" strokeWidth="11"
          strokeDasharray={`${(value / 100) * c} ${c}`} style={{ transition: "stroke-dasharray .8s" }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center font-mono text-3xl font-medium">
        <span>{value}<span className="text-base text-muted-foreground">%</span></span>
      </div>
    </div>
  );
}

export function Spark({ data, h = 56, color = "var(--primary)" }: { data: number[]; h?: number; color?: string }) {
  const w = 240, lo = Math.min(...data) - 5, hi = Math.max(...data) + 5;
  const pts = data.map((v, i) => `${(i / Math.max(1, data.length - 1)) * w},${h - ((v - lo) / (hi - lo)) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: h }} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function DotBar({ value, cols = 24, rows = 4 }: { value: number; cols?: number; rows?: number }) {
  const lit = Math.round((value / 100) * cols);
  return (
    <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
      {Array.from({ length: cols * rows }).map((_, i) => {
        const col = i % cols;
        return <span key={i} className={cn("aspect-square rounded-full", col < lit ? (col > cols * 0.85 ? "bg-destructive" : "bg-primary") : "bg-card-2")} />;
      })}
    </div>
  );
}

export function PodGrid({ containers, onPick }: { containers: Container[]; onPick: (c: Container) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {containers.map((c) => (
        <button key={c.id} aria-label={`${c.name} ${c.state}`} onClick={() => onPick(c)}
          className={cn("h-7 w-7 rounded-[6px] transition active:scale-90",
            c.state === "running" && "bg-pod", c.state === "restarting" && "bg-primary animate-pulse", c.state === "stopped" && "bg-card-2 ring-1 ring-border")} />
      ))}
    </div>
  );
}

export function statusLabel(g: Agent) {
  return g.status === "EXEC" ? `EXEC // ${g.tool}` : g.status;
}

export function StatusBadge({ g, inverted }: { g: Agent; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex h-8 items-center rounded-full px-3 font-mono text-[11px] tracking-wide",
      inverted ? "bg-primary-foreground text-primary" :
      g.status === "AWAITING_INPUT" ? "border border-primary text-primary" :
      g.status === "ERROR" ? "border border-destructive text-destructive" :
      "border border-border text-foreground")}>
      {statusLabel(g)}
    </span>
  );
}

const tone: Record<string, string> = { cmd: "text-foreground", out: "text-muted-foreground", step: "text-muted-foreground", ok: "text-foreground", err: "text-destructive", info: "text-cyan", input: "text-primary" };

export function Terminal({ logs, live, className }: { logs: LogLine[]; live: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" }); }, [logs.length]);
  return (
    <div ref={ref} className={cn("overflow-y-auto font-mono text-[12.5px] leading-[1.6]", className)}>
      {logs.map((l, i) => (
        <div key={l.id} className={tone[l.kind]}>
          {l.kind === "cmd" && <span className="text-primary">$ </span>}
          {l.text.replace(/^=>/, "⇒")}
          {live && i === logs.length - 1 && <span className="caret ml-1 inline-block h-4 w-2 translate-y-0.5 bg-primary" />}
        </div>
      ))}
      {logs.length === 0 && <div className="text-muted-foreground">Waiting for output…</div>}
    </div>
  );
}

export const isLive = (g: Agent, s: State) => !s.paused && (g.status === "EXEC" || g.status === "THINKING");
