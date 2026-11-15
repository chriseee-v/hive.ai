import { createFileRoute, useNavigate , redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/deck/console-shell";
import { ChatPanel } from "@/components/chat/chat-panel";
import { useHive, TABS, type Tab } from "@/components/deck/hive-provider";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { liveCount, type Agent, type Container, type State, type Action } from "@/lib/hive";
import { HistoryChart, HealthBadge, ContainerLog } from "@/components/deck/history";
import { Corner, DotBar, PodGrid, Ring, Spark, StatusBadge, Terminal, isLive, pill } from "@/components/deck/parts";
import { cn } from "@/lib/utils";

const API = typeof window !== "undefined"
  ? `${window.location.protocol}//${window.location.hostname}:${import.meta.env["VITE_COMMAND_CENTRE_API_PORT"] ?? "8001"}`
  : (import.meta.env["VITE_COMMAND_CENTRE_API"] ?? "http://127.0.0.1:8001");

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hivedeck // Control Center" },
      { name: "description", content: "Touch-first command deck for your AI agent swarm, GPU/CPU telemetry and Docker containers." },
      { property: "og:title", content: "Hivedeck // Control Center" },
      { property: "og:description", content: "Touch-first command deck for your AI agent swarm, GPU/CPU telemetry and Docker containers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (q: Record<string, unknown>): { tab?: Tab; thread?: string } => ({
    ...(TABS.includes(q["tab"] as Tab) ? { tab: q["tab"] as Tab } : {}),
    ...(typeof q["thread"] === "string" && /^[0-9a-f-]{36}$/.test(q["thread"]) ? { thread: q["thread"] } : {}),
  }),
  beforeLoad: ({ search }) => { if (!search.tab) throw redirect({ to: "/today" }); },
  component: Deck,
});

type D = React.Dispatch<Action>;


function Deck() {
  const { s, dispatch, sel, setSel, lastTab, setLastTab, seen } = useHive();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const tab = search.tab ?? lastTab;
  const setTab = (t: Tab) => { setLastTab(t); void navigate({ to: "/", search: (p) => ({ ...p, tab: t }), replace: true }); };
  const setThread = useCallback((id: string | undefined) => { void navigate({ to: "/", search: (p) => { const { thread: _t, ...rest } = p; return id ? { ...rest, tab: "Chat" as Tab, thread: id } : { ...rest, tab: "Chat" as Tab }; }, replace: true }); }, [navigate]);
  useEffect(() => { if (search.tab) setLastTab(search.tab); }, [search.tab, setLastTab]);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [inputFor, setInputFor] = useState<string | null>(null);
  const [box, setBox] = useState<string | null>(null);
  const [stopId, setStopId] = useState<string | null>(null);
  const [dockerStatus, setDockerStatus] = useState<{docker_running: boolean; containers: any[]; error?: string} | null>(null);
  const stopAgent = s.agents.find((g) => g.id === stopId) ?? null;

  useEffect(() => {
    for (const a of s.alerts) {
      if (seen.current.has(a.id)) continue;
      seen.current.add(a.id);
      const agent = s.agents.find((g) => a.text.startsWith(g.name));
      const open = agent ? { label: a.kind === "input" ? "Reply" : "View", onClick: () => { setSel(agent.id); setTab("Swarm"); if (a.kind === "input") setInputFor(agent.id); } } : undefined;
      if (a.containerId) {
        const cid = a.containerId;
        toast.error(a.text, {
          description: `Health check failed at ${new Date(a.at ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} — the container is up but unhealthy.`,
          duration: Infinity, closeButton: true,
          action: { label: "Inspect", onClick: () => { setTab("Containers"); setBox(cid); } },
        });
      } else (a.kind === "error" ? toast.error : a.kind === "done" ? toast.success : toast)(a.text, { action: open });
      dispatch({ type: "dismiss", id: a.id });
    }
  }, [s.alerts, s.agents, seen, dispatch, setSel]); // eslint-disable-line react-hooks/exhaustive-deps
  // Fetch Docker status
  useEffect(() => {
    fetch(`${API}/api/docker/status`).then((r) => r.json()).then((data) => setDockerStatus(data)).catch(() => setDockerStatus({docker_running: false, containers: [], error: "Docker API error"}));
  }, []);

  const agent = s.agents.find((g) => g.id === sel) ?? null;
  const container = s.containers.find((c) => c.id === box) ?? null;
  const live = liveCount(s);
  const ask = (id: string) => { setSel(id); setInputFor(id); };

  return (
    <ConsoleShell s={s} tab={tab} setTab={setTab} sel={sel} onDispatch={() => setDispatchOpen(true)}>
      {tab !== "Chat" && <div className="flex justify-end gap-2">
        <button onClick={() => setDispatchOpen(true)} className={cn(pill, "bg-primary text-primary-foreground")}>+ Dispatch task</button>
        <button aria-label={s.paused ? "Resume all agents" : "Emergency pause"} onClick={() => dispatch({ type: "pauseAll" })}
          className={cn("grid h-11 w-11 place-items-center rounded-full active:scale-95", s.paused ? "bg-destructive text-destructive-foreground" : "bg-card-2")}>
          {s.paused ? "▶" : <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="3" width="3.5" height="12" /><rect x="10.5" y="3" width="3.5" height="12" /></svg>}
        </button>
      </div>}
      {tab === "Swarm" && <>
        <Shelf s={s} go={setTab} pick={setBox} />
        <section className="grid min-h-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_1.18fr]">
          {s.agents.map((g) => <AgentCard key={g.id} g={g} active={g.id === sel} d={dispatch} open={() => setSel(g.id)} stop={() => setStopId(g.id)} />)}
          {agent ? <Inspector g={agent} s={s} close={() => setSel(null)} ask={() => ask(agent.id)} className="sm:col-span-3 lg:col-span-1" />
            : <div className="grid min-h-48 place-items-center border border-dashed border-border p-6 text-center text-sm text-muted-foreground sm:col-span-3 lg:col-span-1">Tap an agent card to stream its live task log here.</div>}
        </section>
      </>}
      {tab === "Hardware" && <Hardware s={s} />}
      {tab === "Containers" && <Containers s={s} pick={setBox} d={dispatch} dockerStatus={dockerStatus} />}
      {tab === "Logs" && <Logs s={s} ask={ask} />}
      {tab === "Map" && <Constellation s={s} d={dispatch} ask={ask} stop={setStopId} />}
      {tab === "Chat" && <div className="flex min-h-[70vh] flex-col"><ChatPanel threadId={search.thread} setThread={setThread} /></div>}

      <DispatchDialog open={dispatchOpen} onOpenChange={setDispatchOpen} agents={s.agents} def={sel ?? "forge"}
        go={(id, task) => { dispatch({ type: "dispatch", id, task }); setSel(id); setTab("Swarm"); toast(`Task dispatched to ${s.agents.find((g) => g.id === id)?.name}`); }} />
      <InputDialog agent={s.agents.find((g) => g.id === inputFor) ?? null} close={() => setInputFor(null)}
        send={(id, text) => { dispatch({ type: "input", id, text }); setInputFor(null); }} />
      <AlertDialog open={!!stopAgent} onOpenChange={(o) => !o && setStopId(null)}>
        <AlertDialogContent className="rounded-none border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Stop {stopAgent?.name}'s task?</AlertDialogTitle>
            <AlertDialogDescription>"{stopAgent?.task}" will be cancelled and {stopAgent?.name} goes idle. Progress so far stays in the log, but the task can't be resumed — you'd need to dispatch it again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-12 rounded-full border-border bg-card-2 px-6">Keep running</AlertDialogCancel>
            <AlertDialogAction className="h-12 rounded-full bg-destructive px-6 text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (stopAgent) { dispatch({ type: "stop", id: stopAgent.id, at: Date.now() }); toast(`${stopAgent.name} stopped`); } setStopId(null); }}>Stop task</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ContainerDialog c={container} close={() => setBox(null)} d={dispatch} tick={s.tick} />
    </ConsoleShell>
  );
}

function Shelf({ s, go, pick }: { s: State; go: (t: Tab) => void; pick: (id: string) => void }) {
  const online = s.containers.filter((c) => c.state === "running").length;
  const restarting = s.containers.filter((c) => c.state === "restarting").length;
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.15fr]">
      <div className="relative border border-border flex items-center gap-5 bg-card p-5">
        <Corner label="Open hardware" onClick={() => go("Hardware")}>↗</Corner>
        <Ring value={s.cpu} />
        <div>
          <div className="font-mono text-[11px] tracking-widest text-muted-foreground">CPU</div>
          <div className="mt-1 text-lg font-semibold">Ryzen 9 · 16c</div>
          <div className="font-mono text-sm text-muted-foreground">{s.cpuTemp}°C</div>
        </div>
      </div>
      <div className="relative border border-border bg-card p-5">
        <Corner label="Open hardware" onClick={() => go("Hardware")}>↗</Corner>
        <div className="font-mono text-[11px] tracking-widest text-muted-foreground">GPU</div>
        <div className="font-mono text-4xl font-medium">{s.gpu}<span className="text-base text-muted-foreground">%</span></div>
        <div className="mt-1 px-8"><Spark data={s.gpuHist.slice(-10)} h={50} /></div>
      </div>
      <div className="relative border border-border bg-card p-5 sm:col-span-2 lg:col-span-1">
        <Corner label="Open containers" onClick={() => go("Containers")}>↗</Corner>
        <div className="font-mono text-[11px] tracking-widest text-muted-foreground">DOCKER CLUSTER</div>
        <div className="mt-1 flex items-center gap-3">
          <span className="font-mono text-4xl font-medium">{online}</span>
          <span className="text-sm text-muted-foreground">online</span>
          {restarting > 0 && <span className="ml-auto rounded-full border border-primary px-3 py-1 font-mono text-xs text-primary">{restarting} restarting</span>}
        </div>
        <div className="mt-4"><PodGrid containers={s.containers} onPick={(c) => pick(c.id)} /></div>
      </div>
    </section>
  );
}

function AgentCard({ g, active, d, open, stop }: { g: Agent; active: boolean; d: D; open: () => void; stop: () => void }) {
  const sub = active ? "bg-primary-foreground/15" : "bg-card-2";
  return (
    <article onClick={open}
      className={cn("relative border border-border flex min-h-64 cursor-pointer flex-col p-5 transition", active ? "bg-primary text-primary-foreground" : "bg-card")}>
      <span className={cn("absolute right-1 top-0 grid h-9 min-w-11 place-items-center rounded-full px-3 font-mono text-[11px]", active ? "bg-primary-foreground text-primary" : "bg-card-2 text-muted-foreground")}>{g.code}</span>
      <img src={g.avatar} alt={g.name} width={48} height={48} className="h-12 w-12 rounded-full object-cover" />
      <h3 className="mt-5 text-xl font-semibold">{g.name}</h3>
      <p className={cn("text-sm", active ? "opacity-80" : "text-muted-foreground")}>{g.specialty}</p>
      <div className="mt-4"><StatusBadge g={g} inverted={active} /></div>
      <p className={cn("mt-3 line-clamp-2 text-xs", active ? "opacity-70" : "text-muted-foreground")}>{g.task}</p>
      <div className="mt-auto grid grid-cols-2 gap-2 pt-5" onClick={(e) => e.stopPropagation()}>
        {g.status === "IDLE"
          ? <button onClick={() => { d({ type: "restart", id: g.id, at: Date.now() }); open(); }} className={cn(pill, "col-span-2 h-12 px-2", sub)}>Re-run last task</button>
          : <>
            <button onClick={() => d({ type: "toggle", id: g.id, at: Date.now() })} className={cn(pill, "h-12 px-2", sub)}>{g.status === "PAUSED" ? "▶ Resume" : "❚❚ Pause"}</button>
            <button onClick={stop} className={cn(pill, "h-12 px-2", active ? "bg-primary-foreground/15" : "bg-card-2 text-destructive")}>■ Stop</button>
          </>}
        <button onClick={open} className={cn(pill, "col-span-2 h-12", active ? "bg-primary-foreground text-primary" : "bg-foreground text-background")}>Open task details</button>
      </div>
    </article>
  );
}

function Inspector({ g, s, close, ask, className }: { g: Agent; s: State; close: () => void; ask: () => void; className?: string }) {
  const live = isLive(g, s);
  const [view, setView] = useState<"Log" | "Activity">("Log");
  return (
    <aside className={cn("flex min-h-80 flex-col border border-border bg-background p-4", className)}>
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", live ? "bg-primary animate-pulse" : "bg-muted-foreground")} />
        <span className="font-semibold">{g.name} · {s.paused ? "paused" : g.status === "IDLE" ? "idle" : g.status === "PAUSED" ? "paused" : "live"}</span>
        <button aria-label="Close inspector" onClick={close} className="ml-auto grid h-11 w-11 place-items-center rounded-full bg-card-2">✕</button>
      </div>
      <div className="mt-2 truncate font-mono text-[11px] text-muted-foreground">TASK › {g.task}</div>
      <div className="mt-3 flex gap-1 rounded-full bg-card p-1">
        {(["Log", "Activity"] as const).map((v) => <button key={v} onClick={() => setView(v)} className={cn("h-11 flex-1 rounded-full text-sm", view === v ? "bg-foreground font-semibold text-background" : "text-muted-foreground")}>{v}{v === "Activity" && g.history.length ? ` · ${g.history.length}` : ""}</button>)}
      </div>
      {view === "Log" ? <Terminal logs={g.logs} live={live} className="mt-3 min-h-40 flex-1" /> : <ActivityList g={g} />}
      {g.prompt && <div className="mt-3 rounded-2xl border border-primary p-3 font-mono text-xs text-primary">? {g.prompt}</div>}
      <button onClick={ask} className={cn(pill, "mt-3 h-12 w-full border", g.prompt ? "border-primary bg-primary text-primary-foreground" : "border-border")}>Send input</button>
    </aside>
  );
}

function ActivityList({ g }: { g: Agent }) {
  if (!g.history.length) return <div className="mt-3 grid min-h-40 flex-1 place-items-center text-center text-sm text-muted-foreground">No pause, resume or stop actions yet.</div>;
  const icon = { pause: "❚❚", resume: "▶", stop: "■", restart: "↻" };
  return (
    <ol className="mt-3 min-h-40 flex-1 space-y-2 overflow-y-auto">
      {g.history.map((h, i) => (
        <li key={i} className="flex gap-3 rounded-2xl bg-card p-3">
          <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs", h.action === "stop" ? "bg-destructive/20 text-destructive" : "bg-card-2 text-primary")}>{icon[h.action]}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2"><span className="text-sm font-semibold capitalize">{h.action}</span>
              <span className={cn("font-mono text-[10px]", h.ok ? "text-success" : "text-muted-foreground")}>{h.ok ? "OK" : "SKIPPED"}</span>
              <time className="ml-auto font-mono text-[11px] text-muted-foreground">{new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{h.outcome}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

const STEPS = ["Stopping", "Starting", "Health check", "Healthy"];
function restartStep(c: Container) {
  if (c.state === "restarting") return 0;
  if (c.state === "running" && c.health === "starting") return c.uptime > 1 ? 2 : 1;
  return 3;
}

function Hardware({ s }: { s: State }) {
  const cores = Array.from({ length: 16 }, (_, i) => Math.max(3, Math.min(99, Math.round(s.cpu + Math.sin(s.tick * 0.7 + i * 1.9) * 25))));
  return (
    <section className="grid flex-1 auto-rows-min grid-cols-1 gap-4 overflow-y-auto md:grid-cols-2">
      <HistoryChart s={s} className="md:col-span-2" />
      <div className="border border-border bg-card p-6">
        <div className="font-mono text-[11px] tracking-widest text-muted-foreground">01 CPU · RYZEN 9 · 16C</div>
        <div className="mt-4 flex items-center gap-6"><Ring value={s.cpu} size={150} />
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-sm"><span className="text-muted-foreground">TEMP</span><span>{s.cpuTemp}°C</span><span className="text-muted-foreground">CLOCK</span><span>{(3.4 + s.cpu / 100 * 2.3).toFixed(2)}GHz</span><span className="text-muted-foreground">THREADS</span><span>32</span></div></div>
        <div className="mt-6 font-mono text-[11px] tracking-widest text-muted-foreground">PER CORE</div>
        <div className="mt-2 grid grid-cols-8 gap-2">{cores.map((c, i) => <div key={i} className="rounded-xl bg-card-2 p-2 text-center font-mono text-xs"><div className="text-muted-foreground">c{i}</div>{c}</div>)}</div>
        <div className="mt-6"><Spark data={s.cpuHist} h={60} /></div>
      </div>
      <div className="border border-border bg-card p-6">
        <div className="font-mono text-[11px] tracking-widest text-muted-foreground">02 GPU · RTX 4090</div>
        <div className="mt-2 font-mono text-6xl font-medium">{s.gpu}<span className="text-xl text-muted-foreground">%</span></div>
        <div className="mt-4"><DotBar value={s.gpu} /></div>
        <div className="mt-6 grid grid-cols-3 gap-3 font-mono">
          <div><div className="text-[11px] text-muted-foreground">VRAM</div><div className="text-xl">{s.vram}<span className="text-xs text-muted-foreground">/24G</span></div></div>
          <div><div className="text-[11px] text-muted-foreground">TEMP</div><div className="text-xl">{s.gpuTemp}°C</div></div>
          <div><div className="text-[11px] text-muted-foreground">POWER</div><div className="text-xl">{Math.round(120 + s.gpu * 3.2)}W</div></div>
        </div>
        <div className="mt-4"><DotBar value={(s.vram / 24) * 100} rows={2} /></div>
        <div className="mt-6"><Spark data={s.gpuHist} h={60} /></div>
      </div>
    </section>
  );
}

function Containers({ s, pick, d, dockerStatus }: { s: State; pick: (id: string) => void; d: D; dockerStatus: { docker_running: boolean; containers: any[]; error?: string } | null }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [watch, setWatch] = useState<Set<string>>(new Set());
  const target = s.containers.find((c) => c.id === confirm);
  
  // Docker containers from API
  const dockerContainers = dockerStatus?.containers || [];
  const dockerRunning = dockerStatus?.docker_running || false;
  
  return (
    <>
    <AlertDialog open={!!target} onOpenChange={(o) => !o && setConfirm(null)}>
      <AlertDialogContent className="rounded-none border-border bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle>Restart {target?.name}?</AlertDialogTitle>
          <AlertDialogDescription>The container gets SIGTERM and is unavailable until its health check passes. {target && s.containers.filter((c) => c.state !== "running" || c.health !== "healthy").length > 0 ? "Another container is already recovering." : "Everything else stays up."}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="h-12 rounded-full border-border bg-card-2 px-6">Cancel</AlertDialogCancel>
          <AlertDialogAction className="h-12 rounded-full bg-primary px-6 text-primary-foreground hover:bg-primary/90"
            onClick={() => { if (target) { d({ type: "containerRestart", id: target.id, at: Date.now() }); setWatch((w) => new Set(w).add(target.id)); } setConfirm(null); }}>Restart container</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <section className="grid flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
      {/* Docker containers */}
      {dockerContainers.map((c: any) => (
        <article key={c.id || c.name} onClick={() => pick(c.id || c.name)} className="relative border border-border cursor-pointer bg-card p-5 text-left">
          <div className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full", c.state === "running" ? "bg-success" : c.status === "running" ? "bg-success" : c.status === "paused" ? "bg-warning" : "bg-muted-foreground")} />
            <span className="font-semibold">{c.name || c.id || "unknown"}</span>
            <span className="ml-auto mr-12 font-mono text-[11px] text-muted-foreground">{c.status || "unknown"}</span>
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">{c.image || "unknown"}</div>
          <div className="mt-3 flex items-center gap-2"><HealthBadge c={c} /><span className="font-mono text-[11px] text-muted-foreground">↻ {c.restarts || 0} restart{c.restarts === 1 ? "" : "s"}</span>
            {c.restartLog?.[0] && <span className={cn("ml-auto font-mono text-[10px]", c.restartLog?.[0].ok ? "text-success" : "text-destructive")}>last {c.restartLog?.[0].ok ? "ok" : "failed"} · {new Date(c.restartLog?.[0]?.doneAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}</div>
          <div className="mt-4 grid grid-cols-[3rem_1fr_3rem] items-center gap-2 font-mono text-[11px]">
            <span className="text-muted-foreground">CPU</span><DotBar value={c.cpu || 0} cols={20} rows={1} /><span className="text-right">{c.cpu || 0}%</span>
            <span className="text-muted-foreground">MEM</span><DotBar value={((c.mem || 0) / ((c.memLimit || 1) || 1)) * 100} cols={20} rows={1} /><span className="text-right">{c.mem || 0}M</span>
          </div>
          {(c.state === "restarting" || watch.has(c.id) && restartStep(c) < 3 || c.health === "starting") && c.state !== "stopped" && (
            <div className="mt-4 grid grid-cols-4 gap-1" aria-label="Restart progress">
              {STEPS.map((st, i) => <div key={st}><div className={cn("h-1.5 rounded-full", i < restartStep(c) ? "bg-success" : i === restartStep(c) ? "bg-primary animate-pulse" : "bg-card-2")} />
                <div className={cn("mt-1 font-mono text-[9px]", i === restartStep(c) ? "text-primary" : "text-muted-foreground")}>{st}</div></div>)}
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => pick(c.id || c.name)} className={cn(pill, "h-12 bg-card-2")}>View logs</button>
            <button disabled={c.state !== "running" || c.health === "starting" || !dockerRunning} onClick={() => setConfirm(c.id || c.name)} className={cn(pill, "h-12 border border-primary text-primary")}>
              {c.state === "restarting" || c.health === "starting" ? "Restarting…" : c.state === "stopped" ? "Stopped" : "↻ Restart"}</button>
          </div>
        </article>
      ))}
      {/* Legacy hive containers */}
      {s.containers.map((c) => (
        <article key={c.id} onClick={() => pick(c.id)} className="relative border border-border cursor-pointer bg-card p-5 text-left">
          <div className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full", c.state === "running" ? "bg-success" : c.state === "restarting" ? "bg-primary animate-pulse" : "bg-muted-foreground")} />
            <span className="font-semibold">{c.name}</span>
            <span className="ml-auto mr-12 font-mono text-[11px] text-muted-foreground">{c.state.toUpperCase()}</span>
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">{c.image} · {c.ports[0]}</div>
          <div className="mt-3 flex items-center gap-2"><HealthBadge c={c} /><span className="font-mono text-[11px] text-muted-foreground">↻ {c.restarts} restart{c.restarts === 1 ? "" : "s"}</span>
            {c.restartLog[0] && <span className={cn("ml-auto font-mono text-[10px]", c.restartLog[0].ok ? "text-success" : "text-destructive")}>last {c.restartLog[0].ok ? "ok" : "failed"} · {new Date(c.restartLog[0].doneAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}</div>
          <div className="mt-4 grid grid-cols-[3rem_1fr_3rem] items-center gap-2 font-mono text-[11px]">
            <span className="text-muted-foreground">CPU</span><DotBar value={c.cpu} cols={20} rows={1} /><span className="text-right">{c.cpu}%</span>
            <span className="text-muted-foreground">MEM</span><DotBar value={(c.mem / c.memLimit) * 100} cols={20} rows={1} /><span className="text-right">{c.mem}M</span>
          </div>
          {(c.state === "restarting" || watch.has(c.id) && restartStep(c) < 3 || c.health === "starting") && c.state !== "stopped" && (
            <div className="mt-4 grid grid-cols-4 gap-1" aria-label="Restart progress">
              {STEPS.map((st, i) => <div key={st}><div className={cn("h-1.5 rounded-full", i < restartStep(c) ? "bg-success" : i === restartStep(c) ? "bg-primary animate-pulse" : "bg-card-2")} />
                <div className={cn("mt-1 font-mono text-[9px]", i === restartStep(c) ? "text-primary" : "text-muted-foreground")}>{st}</div></div>)}
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => pick(c.id)} className={cn(pill, "h-12 bg-card-2")}>View logs</button>
            <button disabled={c.state !== "running" || c.health === "starting"} onClick={() => setConfirm(c.id)} className={cn(pill, "h-12 border border-primary text-primary")}>
              {c.state === "restarting" || c.health === "starting" ? "Restarting…" : c.state === "stopped" ? "Stopped" : "↻ Restart"}</button>
          </div>
        </article>
      ))}
    </section>
    </>
  );
}

function Logs({ s, ask }: { s: State; ask: (id: string) => void }) {
  const [f, setF] = useState<string>("all");
  const lines = s.agents.filter((g) => f === "all" || g.id === f)
    .flatMap((g) => g.logs.map((l) => ({ ...l, text: `[${g.name.toLowerCase()}] ${l.kind === "cmd" ? "$ " : ""}${l.text}`, kind: l.kind === "cmd" ? ("info" as const) : l.kind })))
    .sort((a, b) => a.id - b.id);
  const waiting = s.agents.filter((g) => g.prompt);
  const [mode, setMode] = useState<"Output" | "Events">("Output");
  const [oc, setOc] = useState<"all" | "ok" | "skipped">("all");
  const events = s.agents.filter((g) => f === "all" || g.id === f)
    .flatMap((g) => g.history.filter((h) => h.action !== "restart").map((h) => ({ ...h, g })))
    .filter((e) => oc === "all" || (oc === "ok") === e.ok).sort((a, b) => b.at - a.at);
  return (
    <section className="flex min-h-0 flex-1 flex-col border border-border p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-full bg-card p-1">{(["Output", "Events"] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={cn("h-11 rounded-full px-5 text-sm", mode === m ? "bg-foreground font-semibold text-background" : "text-muted-foreground")}>{m}</button>)}</div>
        {mode === "Events" && <div className="flex gap-1 rounded-full bg-card p-1">{(["all", "ok", "skipped"] as const).map((o) => <button key={o} onClick={() => setOc(o)} className={cn("h-11 rounded-full px-4 font-mono text-xs uppercase", oc === o ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{o}</button>)}</div>}
      </div>
      <div className="flex flex-wrap gap-2">
        {["all", ...s.agents.map((g) => g.id)].map((id) => (
          <button key={id} onClick={() => setF(id)} className={cn(pill, "capitalize", f === id ? "bg-foreground text-background" : "bg-card-2")}>{id}</button>
        ))}
        {waiting.map((g) => <button key={g.id} onClick={() => ask(g.id)} className={cn(pill, "ml-auto border border-primary text-primary")}>{g.name} awaiting input →</button>)}
      </div>
      {mode === "Output" ? <Terminal logs={lines} live={!s.paused} className="mt-4 min-h-96 flex-1" /> : (
        <div className="mt-4 min-h-96 flex-1 overflow-y-auto">
          <div className="mb-2 font-mono text-[11px] text-muted-foreground">PAUSE · RESUME · STOP EVENTS — saved on this device · {events.length} shown</div>
          {events.length === 0 ? <div className="grid h-60 place-items-center text-sm text-muted-foreground">No events match these filters yet. Pause, resume or stop an agent to record one.</div> : (
            <table className="w-full font-mono text-xs">
              <tbody>{events.map((e, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="py-3 pr-3 text-muted-foreground">{new Date(e.at).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                  <td className="pr-3 font-sans text-sm font-semibold">{e.g.name}</td>
                  <td className="pr-3 uppercase text-primary">{e.action}</td>
                  <td className={cn("pr-3", e.ok ? "text-success" : "text-muted-foreground")}>{e.ok ? "OK" : "SKIPPED"}</td>
                  <td className="text-muted-foreground">{e.outcome}</td>
                </tr>))}</tbody>
            </table>)}
        </div>)}
    </section>
  );
}

function Constellation({ s, d, ask, stop }: { s: State; d: D; ask: (id: string) => void; stop: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const W = 1000, H = 520, cx = W / 2, cy = H / 2;
  const nodes = s.agents.map((g, i) => {
    const a = -Math.PI / 2 + (i / s.agents.length) * Math.PI * 2;
    return { g, x: cx + Math.cos(a) * 330, y: cy + Math.sin(a) * 190 };
  });
  const g = s.agents.find((x) => x.id === open);
  return (
    <section className="dotgrid relative min-h-[28rem] flex-1 overflow-hidden border border-border bg-card/40">
      <div className="absolute left-5 top-4 font-mono text-[11px] tracking-widest text-muted-foreground">CONSTELLATION · {s.agents.length} SUB-AGENTS · TAP A NODE</div>
      <div className="absolute right-5 top-4 flex gap-4 font-mono text-[11px] text-muted-foreground">
        <span><span className="text-cyan">━</span> dispatch</span><span><span className="text-primary">━</span> report</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
        {nodes.map(({ g, x, y }) => {
          const live = isLive(g, s);
          const path = `M${cx},${cy} L${x},${y}`;
          return (
            <g key={g.id}>
              <path d={path} stroke={live ? "var(--cyan)" : "var(--border)"} strokeWidth="2" strokeDasharray="2 6" fill="none" opacity={live ? 0.9 : 0.6} />
              {live && <>
                <circle r="5" fill="var(--cyan)"><animateMotion dur="2.4s" repeatCount="indefinite" path={path} /></circle>
                <circle r="4" fill="var(--primary)"><animateMotion dur="3.1s" repeatCount="indefinite" path={`M${x},${y} L${cx},${cy}`} /></circle>
              </>}
              {g.prompt && <circle cx={x} cy={y} r="52" fill="none" stroke="var(--primary)" strokeWidth="2"><animate attributeName="r" values="44;60;44" dur="1.6s" repeatCount="indefinite" /><animate attributeName="opacity" values="1;0;1" dur="1.6s" repeatCount="indefinite" /></circle>}
              <g onClick={() => setOpen(g.id)} className="cursor-pointer">
                <circle cx={x} cy={y} r="42" fill="var(--card)" stroke={open === g.id ? "var(--primary)" : "var(--border)"} strokeWidth="3" />
                <clipPath id={`cp-${g.id}`}><circle cx={x} cy={y} r="34" /></clipPath>
                <image href={g.avatar} x={x - 34} y={y - 34} width="68" height="68" clipPath={`url(#cp-${g.id})`} preserveAspectRatio="xMidYMid slice" />
                <text x={x} y={y + 64} textAnchor="middle" fill="var(--foreground)" fontSize="16" fontWeight="600">{g.name}</text>
                <text x={x} y={y + 82} textAnchor="middle" fill="var(--muted-foreground)" fontSize="11" fontFamily="JetBrains Mono">{g.status === "EXEC" ? `EXEC // ${g.tool}` : g.status}</text>
              </g>
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r="58" fill="none" stroke="var(--primary)" strokeDasharray="2 5" strokeWidth="2" />
        <circle cx={cx} cy={cy} r="44" fill="var(--primary)" />
        <text x={cx} y={cy + 6} textAnchor="middle" fill="var(--primary-foreground)" fontSize="18" fontWeight="700">◐ Hive</text>
        <text x={cx} y={cy + 82} textAnchor="middle" fill="var(--muted-foreground)" fontSize="11" fontFamily="JetBrains Mono">COORDINATOR</text>
      </svg>
      <Sheet open={!!g} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="flex w-full flex-col border-border bg-background sm:max-w-md">
          {g && <>
            <SheetHeader><SheetTitle className="flex items-center gap-3"><img src={g.avatar} alt="" className="h-10 w-10 rounded-full object-cover" />{g.name} <StatusBadge g={g} /></SheetTitle>
              <SheetDescription className="font-mono text-xs">hive → {g.id} · {g.task}</SheetDescription></SheetHeader>
            <Terminal logs={g.logs} live={isLive(g, s)} className="min-h-0 flex-1 rounded-2xl bg-card p-3" />
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => d({ type: "toggle", id: g.id, at: Date.now() })} disabled={g.status === "IDLE"} className={cn(pill, "h-12 bg-card-2 px-2")}>{g.status === "PAUSED" ? "Resume" : "Pause"}</button>
              <button onClick={() => stop(g.id)} disabled={g.status === "IDLE"} className={cn(pill, "h-12 bg-card-2 px-2 text-destructive")}>■ Stop</button>
              <button onClick={() => ask(g.id)} className={cn(pill, "h-12 px-2", g.prompt ? "bg-primary text-primary-foreground" : "border border-border")}>Send input</button>
            </div>
          </>}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function DispatchDialog({ open, onOpenChange, agents, def, go }: { open: boolean; onOpenChange: (o: boolean) => void; agents: Agent[]; def: string; go: (id: string, task: string) => void }) {
  const [id, setId] = useState(def);
  const [task, setTask] = useState("");
  useEffect(() => { if (open) { setId(def); setTask(""); } }, [open, def]);
  const busy = agents.find((g) => g.id === id)?.status !== "IDLE";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none border-border bg-card">
        <DialogHeader><DialogTitle>Dispatch task</DialogTitle><DialogDescription>Pick an agent and describe the job.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-3 gap-2">
          {agents.map((g) => (
            <button key={g.id} onClick={() => setId(g.id)} className={cn("flex flex-col items-center gap-1 rounded-2xl p-3", id === g.id ? "bg-primary text-primary-foreground" : "bg-card-2")}>
              <img src={g.avatar} alt="" className="h-10 w-10 rounded-full object-cover" /><span className="text-sm font-semibold">{g.name}</span>
              <span className="font-mono text-[10px] opacity-70">{g.status}</span>
            </button>
          ))}
        </div>
        <textarea autoFocus value={task} onChange={(e) => setTask(e.target.value)} placeholder="e.g. Rebuild the web container and run e2e tests"
          className="min-h-24 rounded-2xl border border-border bg-background p-3 font-mono text-sm outline-none focus:border-primary" />
        {busy && <p className="text-xs text-primary">This agent is busy — dispatching will replace its current task.</p>}
        <button disabled={!task.trim()} onClick={() => { go(id, task.trim()); onOpenChange(false); }} className={cn(pill, "h-12 bg-primary text-primary-foreground")}>Dispatch</button>
      </DialogContent>
    </Dialog>
  );
}

function InputDialog({ agent, close, send }: { agent: Agent | null; close: () => void; send: (id: string, t: string) => void }) {
  const [text, setText] = useState("");
  useEffect(() => setText(""), [agent?.id]);
  return (
    <Dialog open={!!agent} onOpenChange={(o) => !o && close()}>
      <DialogContent className="rounded-none border-border bg-card">
        <DialogHeader><DialogTitle>Send input to {agent?.name}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{agent?.prompt ?? "Agent isn't asking for anything — your message is added to its context."}</DialogDescription></DialogHeader>
        {agent?.prompt?.includes("yes / no") && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => send(agent.id, "yes")} className={cn(pill, "h-12 bg-primary text-primary-foreground")}>Yes</button>
            <button onClick={() => send(agent.id, "no")} className={cn(pill, "h-12 bg-card-2")}>No</button>
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); if (agent && text.trim()) send(agent.id, text.trim()); }} className="flex gap-2">
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a reply…" className="h-12 flex-1 rounded-full border border-border bg-background px-4 font-mono text-sm outline-none focus:border-primary" />
          <button disabled={!text.trim()} className={cn(pill, "h-12 bg-foreground text-background")}>Send</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RestartHistory({ c }: { c: Container }) {
  const pending = c.pendingSince !== null || c.state === "restarting" || c.health === "starting";
  return (
    <ol className="h-64 space-y-2 overflow-y-auto">
      {pending && <li className="flex items-center gap-3 rounded-2xl border border-primary p-3 font-mono text-xs text-primary"><span className="animate-pulse">●</span>In progress{c.pendingSince ? ` · since ${new Date(c.pendingSince).toLocaleTimeString()}` : ""}</li>}
      {c.restartLog.map((e, i) => (
        <li key={i} className="flex items-center gap-3 rounded-2xl bg-background p-3 font-mono text-xs">
          <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", e.ok ? "border-success text-success" : "border-destructive text-destructive")}>{e.ok ? "SUCCESS" : "FAILED"}</span>
          <span className="text-muted-foreground">{e.detail}</span>
          <time className="ml-auto text-muted-foreground">{new Date(e.at).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
        </li>
      ))}
      {!pending && c.restartLog.length === 0 && <li className="grid h-full place-items-center text-sm text-muted-foreground">No restarts since this session started.</li>}
    </ol>
  );
}

function ContainerDialog({ c, close, d, tick }: { c: Container | null; close: () => void; d: D; tick: number }) {
  const [armed, setArmed] = useState(false);
  const [view, setView] = useState<"Logs" | "Restarts">("Logs");
  useEffect(() => setArmed(false), [c?.id]);
  return (
    <Dialog open={!!c} onOpenChange={(o) => !o && close()}>
      <DialogContent className="rounded-none border-border bg-card">
        {c && <>
          <DialogHeader><DialogTitle className="flex items-center gap-2">{c.name}
            <span className={cn("rounded-full border px-2 py-0.5 font-mono text-[11px]", c.state === "running" ? "border-success text-success" : c.state === "restarting" ? "border-primary text-primary" : "border-border text-muted-foreground")}>{c.state}</span></DialogTitle>
            <div className="flex flex-wrap items-center gap-2"><HealthBadge c={c} />
              <span className="font-mono text-[11px] text-muted-foreground">↻ {c.restarts} restarts · {c.lastRestart === null ? "never restarted" : `last restart ${Math.max(0, Math.round((tick - c.lastRestart) * 1.3))}s ago`}</span></div>
            <DialogDescription className="font-mono text-xs">{c.image} · up {Math.floor(c.uptime / 3600)}h {Math.floor((c.uptime % 3600) / 60)}m</DialogDescription></DialogHeader>
          <div className="grid grid-cols-3 gap-2 font-mono text-sm">
            <div className="rounded-2xl bg-card-2 p-3"><div className="text-[11px] text-muted-foreground">CPU</div>{c.cpu}%</div>
            <div className="rounded-2xl bg-card-2 p-3"><div className="text-[11px] text-muted-foreground">MEM</div>{c.mem}M</div>
            <div className="rounded-2xl bg-card-2 p-3"><div className="text-[11px] text-muted-foreground">PORTS</div>{c.ports.join(", ")}</div>
          </div>
          <div className="flex gap-1 rounded-full bg-background p-1">{(["Logs", "Restarts"] as const).map((v) => <button key={v} onClick={() => setView(v)} className={cn("h-11 flex-1 rounded-full text-sm", view === v ? "bg-foreground font-semibold text-background" : "text-muted-foreground")}>{v}{v === "Restarts" ? ` · ${c.restartLog.length}` : ""}</button>)}</div>
          {view === "Logs" ? <ContainerLog lines={c.logs} /> : <RestartHistory c={c} />}
          <div className="grid grid-cols-2 gap-2">
            <button disabled={c.state !== "running" || c.health === "starting"} onClick={() => { if (!armed) return setArmed(true); setArmed(false); d({ type: "containerRestart", id: c.id, at: Date.now() }); toast(`Restarting ${c.name}…`); }} className={cn(pill, "h-12", armed ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground")}>{c.state === "restarting" || c.health === "starting" ? "Restarting…" : armed ? "Tap again to restart" : "Restart"}</button>
            <button disabled={c.state === "restarting"} onClick={() => d({ type: "containerToggle", id: c.id })} className={cn(pill, "h-12 bg-card-2")}>{c.state === "stopped" ? "Start" : "Stop"}</button>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  );
}
