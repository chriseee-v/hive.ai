export type AgentStatus = "EXEC" | "THINKING" | "AWAITING_INPUT" | "IDLE" | "PAUSED" | "ERROR";
export type LogKind = "cmd" | "out" | "step" | "ok" | "err" | "info" | "input";
export interface Activity { at: number; action: "pause" | "resume" | "stop" | "restart"; outcome: string; ok: boolean }
export interface LogLine { id: number; kind: LogKind; text: string; t: number }
export interface Agent {
  id: string; code: string; name: string; specialty: string; avatar: string;
  status: AgentStatus; tool: string; task: string; script: [LogKind, string][];
  cursor: number; prompt?: string | undefined; logs: LogLine[]; history: Activity[]; prev?: AgentStatus | undefined; parent?: string;
}
export interface Container {
  id: string; name: string; image: string; state: "running" | "restarting" | "stopped";
  cpu: number; mem: number; memLimit: number; ports: string[]; uptime: number; logs: string[];
  health: "healthy" | "starting" | "unhealthy" | "none"; restarts: number; lastRestart: number | null;
  restartLog: RestartEntry[]; pendingSince: number | null;
}
export interface RestartEntry { at: number; doneAt: number; ok: boolean; detail: string }
export interface Alert { id: number; kind: "done" | "input" | "error" | "info"; text: string; at?: number; containerId?: string }
export interface State {
  tick: number; seq: number; agents: Agent[]; containers: Container[]; paused: boolean;
  cpu: number; cpuTemp: number; gpu: number; gpuTemp: number; vram: number; gpuHist: number[]; cpuHist: number[];
  alerts: Alert[];
}

const FORGE: [LogKind, string][] = [
  ["cmd", "docker compose build api"], ["step", "[+] Building 41.2s (14/18)"], ["step", "=> COPY ./src /app/src"],
  ["step", "=> RUN pnpm install --frozen"], ["out", "added 812 packages in 19s"], ["step", "=> RUN pnpm test --run"],
  ["ok", "✓ 146 passed"], ["cmd", "docker push hive/api:2.8.1"], ["out", "2.8.1: digest sha256:9f2c…e1 size 2417"],
  ["cmd", "kubectl rollout restart deploy/api"], ["out", "deployment.apps/api restarted"], ["ok", "✓ rollout complete · 3/3 ready"],
];
const SCOUT: [LogKind, string][] = [
  ["info", "› query: vector db benchmarks 2026"], ["out", "fetched 14 sources · ranking…"], ["step", "=> reading arxiv:2611.04122"],
  ["out", "extracted 38 claims"], ["step", "=> cross-checking with pgvector docs"], ["out", "2 conflicts flagged"],
  ["step", "=> drafting summary.md"], ["ok", "✓ report ready · 1,840 words"],
];
const LEDGER: [LogKind, string][] = [
  ["cmd", "pg_dump --schema-only billing > schema.sql"], ["out", "dumped 42 tables"], ["step", "=> diff schema v11 → v12"],
  ["out", "3 columns renamed, 1 dropped: invoices.legacy_ref"], ["step", "=> running migration 0012_invoices"],
  ["out", "migrated 182,044 rows"], ["ok", "✓ checksums match"],
];
export const SCRIPTS = { generic: (task: string): [LogKind, string][] => [
  ["info", `› task: ${task}`], ["step", "=> planning 4 steps"], ["cmd", "git checkout -b agent/task"], ["out", "Switched to a new branch"],
  ["step", "=> executing step 2/4"], ["out", "writing 3 files"], ["step", "=> executing step 3/4"], ["cmd", "pnpm test --run"],
  ["ok", "✓ 52 passed"], ["step", "=> step 4/4: opening PR"], ["ok", "✓ done"],
] };

let seqStart = 0;
const H0: Activity[] = [];
const mk = (lines: [LogKind, string][]): LogLine[] => lines.map(([kind, text]) => ({ id: ++seqStart, kind, text, t: 0 }));

export function initialState(avatars: { forge: string; scout: string; ledger: string }): State {
  seqStart = 0;
  const agents: Agent[] = [
    { id: "forge", code: "#A1", name: "Forge", specialty: "Build & deploy", avatar: avatars.forge, status: "EXEC", tool: "bash_exec",
      task: "Ship api v2.8.1 to production", script: FORGE, cursor: 8, logs: mk(FORGE.slice(0, 8)), history: H0, parent: "hive" },
    { id: "scout", code: "#A2", name: "Scout", specialty: "Research", avatar: avatars.scout, status: "THINKING", tool: "web_search",
      task: "Benchmark vector databases", script: SCOUT, cursor: 3, logs: mk(SCOUT.slice(0, 3)), history: H0, parent: "hive" },
    { id: "ledger", code: "#A3", name: "Ledger", specialty: "Data migration", avatar: avatars.ledger, status: "AWAITING_INPUT", tool: "sql",
      task: "Migrate billing schema to v12", script: LEDGER, cursor: 4, logs: mk(LEDGER.slice(0, 4)), history: H0, parent: "hive",
      prompt: "Drop column invoices.legacy_ref? (yes / no)" },
  ];
  const names = ["api", "web", "worker", "postgres", "redis", "qdrant", "ollama", "nginx", "grafana", "prometheus", "minio"];
  const containers: Container[] = names.map((n, i) => ({
    id: `c${i}`, name: n, image: `hive/${n}:latest`, state: n === "ollama" ? "restarting" : "running",
    cpu: 4 + ((i * 7) % 30), mem: 120 + i * 90, memLimit: 2048, ports: [`${8000 + i}:${80 + i}/tcp`], uptime: 3600 * (i + 2),
    logs: [`${n} | listening`, `${n} | healthcheck ok`], health: n === "ollama" ? "starting" : "healthy", restarts: n === "ollama" ? 3 : 0, lastRestart: n === "ollama" ? 0 : null, restartLog: [], pendingSince: null,
  }));
  return { tick: 0, seq: seqStart, agents, containers, paused: false, cpu: 62, cpuTemp: 68, gpu: 84, gpuTemp: 71, vram: 18.4,
    gpuHist: [58, 63, 60, 70, 68, 76, 74, 80, 79, 84], cpuHist: [50, 55, 58, 60, 61, 62], alerts: [] };
}

export type Action =
  | { type: "tick"; r: number; now?: number }
  | { type: "toggle"; id: string; at: number }
  | { type: "restart"; id: string; at?: number }
  | { type: "input"; id: string; text: string }
  | { type: "dispatch"; id: string; task: string }
  | { type: "stop"; id: string; at: number }
  | { type: "pauseAll" }
  | { type: "containerRestart"; id: string; at?: number }
  | { type: "loadHistory"; history: Record<string, Activity[]> }
  | { type: "containerToggle"; id: string }
  | { type: "dismiss"; id: number };

const rec = (g: Agent, h: Activity): Agent => ({ ...g, history: [h, ...g.history].slice(0, 50) });
export const HIST = 120;
const CLOG = ["GET /health 200 2ms", "worker heartbeat", "GET /v1/status 200 14ms", "flushed 12 entries", "gc pause 3ms"];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function reducer(s: State, a: Action): State {
  let seq = s.seq;
  const alerts: Alert[] = [];
  const push = (ag: Agent, kind: LogKind, text: string): Agent => ({ ...ag, logs: [...ag.logs, { id: ++seq, kind, text, t: s.tick }].slice(-200) });
  const upd = (id: string, f: (g: Agent) => Agent) => s.agents.map((g) => (g.id === id ? f(g) : g));
  switch (a.type) {
    case "tick": {
      const j = (a.r - 0.5);
      const agents = s.agents.map((g): Agent => {
        if (s.paused || !(g.status === "EXEC" || g.status === "THINKING")) return g;
        if (a.r > 0.75 && g.status === "THINKING") return g;
        if (g.cursor >= g.script.length) {
          alerts.push({ id: ++seq, kind: "done", text: `${g.name} finished: ${g.task}` });
          return { ...push(g, "info", "● task complete · agent idle"), status: "IDLE" as AgentStatus, cursor: g.cursor };
        }
        const [kind, text] = g.script[g.cursor]!;
        let n: Agent = push(g, kind, text);
        n = { ...n, cursor: g.cursor + 1, status: kind === "cmd" ? "EXEC" : kind === "step" || kind === "info" ? "THINKING" : n.status };
        if (g.id === "ledger" && g.cursor === 3) {
          alerts.push({ id: ++seq, kind: "input", text: `${g.name} needs your input` });
          return { ...n, status: "AWAITING_INPUT" as AgentStatus, prompt: "Drop column invoices.legacy_ref? (yes / no)" };
        }
        return n;
      });
      const containers = s.containers.map((c, i) => {
        if (c.state !== "running") return c;
        const cpu = clamp(Math.round(c.cpu + j * 6), 1, 95);
        const chatty = (s.tick + i) % 5 === 0;
        const line = chatty ? `${c.name} | ${CLOG[(s.tick + i) % CLOG.length]} cpu=${cpu}%` : null;
        return { ...c, cpu, uptime: c.uptime + 1, mem: clamp(Math.round(c.mem + j * 20), 50, c.memLimit),
          logs: line ? [...c.logs, line].slice(-150) : c.logs };
      }).map((c, i) => {
        if (!(c.state === "running" && c.health === "starting" && c.uptime > 2)) return c;
        const now = a.now ?? 0, at = c.pendingSince ?? now, fail = ((a.r * 97 + i) % 1) < 0.2;
        const secs = Math.max(1, Math.round((now - at) / 1000));
        if (fail) alerts.push({ id: ++seq, kind: "error", text: `Restart failed: ${c.name}`, at: now, containerId: c.id });
        return { ...c, health: fail ? "unhealthy" as const : "healthy" as const, pendingSince: null,
          logs: [...c.logs, fail ? `${c.name} | healthcheck FAILED (exit 1)` : `${c.name} | healthy`],
          restartLog: [{ at, doneAt: now, ok: !fail, detail: fail ? `Health check failed after ${secs}s` : `Healthy in ${secs}s` }, ...c.restartLog].slice(0, 30) };
      });
      const load = s.paused ? -6 : 0;
      const gpu = clamp(Math.round(s.gpu + j * 10 + load), 12, 99);
      const cpu = clamp(Math.round(s.cpu + j * 8 + load), 8, 98);
      return { ...s, seq, tick: s.tick + 1, agents, containers, gpu, cpu,
        cpuTemp: clamp(Math.round(40 + cpu * 0.45), 35, 95), gpuTemp: clamp(Math.round(38 + gpu * 0.4), 35, 92),
        vram: Math.round(clamp(s.vram + j, 6, 23.5) * 10) / 10,
        gpuHist: [...s.gpuHist, gpu].slice(-HIST), cpuHist: [...s.cpuHist, cpu].slice(-HIST), alerts: [...s.alerts, ...alerts] };
    }
    case "toggle":
      return { ...s, agents: upd(a.id, (g) => {
        if (g.status === "IDLE") return rec(g, { at: a.at, action: "pause", ok: false, outcome: "Ignored — agent is idle" });
        if (g.status === "PAUSED") {
          const to = g.prev ?? "THINKING";
          return rec(push({ ...g, status: to }, "info", "▶ resumed by operator"), { at: a.at, action: "resume", ok: true, outcome: `Resumed → ${to}${s.paused ? " (swarm still paused)" : ""}` });
        }
        return rec(push({ ...g, status: "PAUSED", prev: g.status }, "info", "❚❚ paused by operator"), { at: a.at, action: "pause", ok: true, outcome: `Paused during ${g.status} · step ${g.cursor}/${g.script.length}` });
      }), seq: seq + 1 };
    case "restart":
      return { ...s, agents: upd(a.id, (g) => ({ ...(a.at ? rec(g, { at: a.at, action: "restart", ok: true, outcome: `Re-ran "${g.task}"` }) : g), cursor: 0, prompt: undefined, status: "THINKING",
        logs: [{ id: ++seq, kind: "info", text: `↻ ${g.name} restarted · re-running task`, t: s.tick }] })), seq };
    case "input":
      return { ...s, agents: upd(a.id, (g) => ({ ...push(g, "input", `> ${a.text}`), status: "EXEC", prompt: undefined })), seq: seq + 1 };
    case "dispatch":
      return { ...s, agents: upd(a.id, (g) => ({ ...g, task: a.task, script: SCRIPTS.generic(a.task), cursor: 0, status: "THINKING", prompt: undefined,
        logs: [...g.logs, { id: ++seq, kind: "info" as LogKind, text: `━━ new task dispatched ━━`, t: s.tick }] })), seq };
    case "stop":
      return { ...s, agents: upd(a.id, (g) => g.status === "IDLE"
        ? rec(g, { at: a.at, action: "stop", ok: false, outcome: "Ignored — nothing running" })
        : rec({ ...push(g, "err", "■ task stopped by operator"), status: "IDLE", prompt: undefined, cursor: g.script.length, prev: undefined },
          { at: a.at, action: "stop", ok: true, outcome: `Stopped "${g.task}" at step ${g.cursor}/${g.script.length}` })), seq: seq + 1 };
    case "pauseAll": {
      const paused = !s.paused;
      return { ...s, paused, alerts: [...s.alerts, { id: ++seq, kind: "info", text: paused ? "Emergency pause: all agents halted" : "Swarm resumed" }], seq };
    }
    case "containerRestart":
      return { ...s, containers: s.containers.map((c) => c.id === a.id ? { ...c, state: "restarting", health: "starting", uptime: 0, pendingSince: a.at ?? null, restarts: c.restarts + 1, lastRestart: s.tick, logs: [...c.logs, `${c.name} | restart requested`, `${c.name} | SIGTERM sent`] } : c) };
    case "containerToggle":
      return { ...s, containers: s.containers.map((c) => c.id === a.id ? { ...c, state: c.state === "stopped" ? "running" : "stopped", cpu: 0, health: c.state === "stopped" ? "starting" : "none",
        logs: [...c.logs, `${c.name} | ${c.state === "stopped" ? "started" : "stopped"}`] } : c) };
    case "loadHistory":
      return { ...s, agents: s.agents.map((g) => ({ ...g, history: a.history[g.id] ?? g.history })) };
    case "dismiss":
      return { ...s, alerts: s.alerts.filter((x) => x.id !== a.id) };
  }
}

export function settleRestarts(s: State): State {
  return { ...s, containers: s.containers.map((c) => c.state === "restarting" && c.uptime === 0 ? { ...c, state: "running" as const, uptime: 1, logs: [...c.logs, `${c.name} | started · healthcheck pending`] } : c) };
}
export const liveCount = (s: State) => s.agents.filter((g) => g.status !== "IDLE" && g.status !== "PAUSED").length;
