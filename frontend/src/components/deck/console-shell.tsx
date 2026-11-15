import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Tab } from "@/components/deck/hive-provider";
import { liveCount, type State } from "@/lib/hive";
import { cn } from "@/lib/utils";

type Stat = { label: string; value: string; icon?: string };

/** Console-style home: full-bleed art per section, a tile shelf as navigation, big title + stats. */
export function ConsoleShell({ s, tab, setTab, sel, onDispatch, children }: {
  s: State; tab: Tab; setTab: (t: Tab) => void; sel: string | null; onDispatch: () => void; children: React.ReactNode;
}) {
  const agent = s.agents.find((g) => g.id === sel) ?? s.agents[0];
  const online = s.containers.filter((c) => c.state === "running").length;
  const live = liveCount(s);
  const lines = s.agents.reduce((n, g) => n + g.logs.length, 0);

  const sq = "grid h-11 min-w-11 place-items-center border border-border px-4 font-mono text-[11px] uppercase tracking-wider active:bg-foreground active:text-background";
  void setTab;
  const tiles: { tab: Tab; title: string; sub: string; glyph: string }[] = [
    { tab: "Swarm", title: "Swarm", sub: `${live} live`, glyph: "◍" },
    { tab: "Hardware", title: "Hardware", sub: `GPU ${Math.round(s.gpu)}%`, glyph: "▦" },
    { tab: "Containers", title: "Containers", sub: `${online}/${s.containers.length} up`, glyph: "▣" },
    { tab: "Logs", title: "Logs", sub: `${lines} lines`, glyph: "≡" },
    { tab: "Map", title: "Constellation", sub: "topology", glyph: "✳" },
    { tab: "Chat", title: "Command Centre", sub: "chat", glyph: "✉" },
  ];
  const meta: Record<Tab, { kicker: string; title: string; stats: Stat[] }> = {
    Swarm: { kicker: "SELECTED AGENT", title: agent ? `${agent.name} · ${agent.specialty}` : "Swarm",
      stats: [{ label: "Status", value: agent?.status.replace("_", " ") ?? "—" }, { label: "Tool", value: agent?.tool ?? "—" }, { label: "Current task", value: agent?.task ?? "—", icon: "◆" }] },
    Hardware: { kicker: "HOST TELEMETRY", title: "Hardware",
      stats: [{ label: "CPU load", value: `${Math.round(s.cpu)}%` }, { label: "GPU load", value: `${Math.round(s.gpu)}%` }, { label: "GPU temp", value: `${Math.round(s.gpuTemp)}°C`, icon: "◆" }] },
    Containers: { kicker: "DOCKER CLUSTER", title: "Containers",
      stats: [{ label: "Online", value: `${online}` }, { label: "Restarting", value: `${s.containers.filter((c) => c.state === "restarting").length}` }, { label: "Unhealthy", value: `${s.containers.filter((c) => c.health === "unhealthy").length}`, icon: "◆" }] },
    Logs: { kicker: "EVENT STREAM", title: "Logs", stats: [{ label: "Lines", value: `${lines}` }, { label: "Agents", value: `${s.agents.length}` }, { label: "Awaiting input", value: `${s.agents.filter((g) => g.status === "AWAITING_INPUT").length}`, icon: "◆" }] },
    Map: { kicker: "AGENT TOPOLOGY", title: "Constellation", stats: [{ label: "Nodes", value: `${s.agents.length + 1}` }, { label: "Live", value: `${live}` }, { label: "Swarm", value: s.paused ? "Paused" : "Running", icon: "◆" }] },
    Chat: { kicker: "LOCAL AGENTS", title: "Command Centre", stats: [] },
  };
  const m = meta[tab];
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-background text-foreground">
      {/* plain backdrop: the deck's own colour scheme, no artwork */}

      <div className="relative flex min-h-screen flex-col px-4 pb-20 pt-4 sm:px-8">
        {/* top bar — same square, mono look as Today */}
        <header className="flex flex-wrap items-center gap-2">
          <Link to="/today" className={cn(sq, "gap-2")}>← Today</Link>
          <span className={cn(sq, "bg-foreground text-background")}>{tiles.find((x) => x.tab === tab)?.title}</span>
          <button onClick={onDispatch} className={sq}>+ Dispatch</button>
          <span className="ml-auto flex items-center gap-2 font-mono text-[11px] uppercase text-muted-foreground">
            <span className={cn("h-1.5 w-1.5 bg-primary", !s.paused && "animate-pulse")} />{s.paused ? "swarm paused" : `${live} agents live`} · {online} up ·
            <span suppressHydrationWarning className="text-foreground">{now?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) ?? "--:--"}</span>
          </span>
        </header>

        {/* title + stats */}
        {tab !== "Chat" && (
          <section className="mt-6 border border-border p-6">
            <div className="font-mono text-[11px] tracking-widest text-muted-foreground">{m.kicker}</div>
            <h1 className="mt-1 truncate font-mono text-4xl uppercase tracking-tight sm:text-5xl">{m.title}</h1>
            <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-3">
              {m.stats.map((x) => (
                <div key={x.label} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{x.label}</dt>
                  <dd className="mt-0.5 flex max-w-md items-center gap-2 truncate text-xl font-semibold">{x.icon && <span className="text-primary">{x.icon}</span>}<span className="truncate">{x.value}</span></dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* section content */}
        <main className="mt-6 flex min-h-0 flex-1 flex-col gap-4">{children}</main>
      </div>

      {/* hint bar */}
      <footer className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t border-border bg-background/85 backdrop-blur px-4 py-1 text-xs text-muted-foreground sm:px-8">
        <div className="flex gap-2">
          <button onClick={onDispatch} className="flex h-11 items-center gap-2 rounded-full px-3"><span className="grid h-5 w-5 place-items-center rounded-full border border-border text-[9px]">○</span>Dispatch</button>
          <Link to="/today" className="flex h-11 items-center gap-2 rounded-full px-3"><span className="grid h-5 w-5 place-items-center rounded-full border border-border text-[9px]">△</span>Today</Link>
        </div>
        <span className="font-mono">{s.paused ? "ALL AGENTS PAUSED" : "SWARM ONLINE"}</span>
      </footer>
    </div>
  );
}
