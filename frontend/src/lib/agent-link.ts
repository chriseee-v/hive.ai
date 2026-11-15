import type { TraceNode } from "@/components/ui/ai-thinking-and-tool-calls";

/** Contract for the user's local Command Centre. POST JSON, receive JSON. */
export interface AgentRequest { message: string; thread_id: string; history: { role: "user" | "assistant"; content: string }[] }
export interface AgentStep { label?: string; title?: string; detail?: string; status?: string; tool?: string; command?: string; output?: string; args?: unknown }
export interface AgentReply { completed?: boolean; summary?: string; message?: string; engine?: string; steps?: AgentStep[]; trace?: TraceNode[] }

export function toTrace(r: AgentReply): TraceNode[] {
  if (Array.isArray(r.trace)) return r.trace;
  return (r.steps ?? []).map((s): TraceNode => {
    const status = s.status === "failed" || s.status === "error" ? "failed" : "completed";
    if (s.command) return { type: "terminal", command: s.command, ...(s.output ? { output: s.output } : {}), status };
    if (s.tool) return { type: "tool", toolName: s.tool, primary: s.label ?? s.title ?? s.tool, ...(s.detail ? { secondary: s.detail } : {}), args: s.args, status };
    return { type: "step", primary: s.label ?? s.title ?? "Step", ...(s.detail ? { secondary: s.detail } : {}), status };
  });
}

/** The summary may arrive as a JSON string (as some local routers return). Unwrap it. */
export function normalizeReply(raw: unknown): AgentReply {
  if (typeof raw === "string") {
    try { return normalizeReply(JSON.parse(raw)); } catch { return { completed: true, summary: raw }; }
  }
  const r = (raw ?? {}) as AgentReply;
  if (typeof r.summary === "string" && r.summary.trim().startsWith("{")) {
    try { const inner = JSON.parse(r.summary) as AgentReply; const steps = r.steps ?? inner.steps; return { ...r, ...inner, ...(steps ? { steps } : {}) }; } catch { /* keep as-is */ }
  }
  return r;
}

export async function callAgent(endpoint: string, token: string | null, req: AgentRequest, signal?: AbortSignal): Promise<AgentReply> {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST", signal: signal ?? null,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(req),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    const insecure = endpoint.startsWith("http://") && typeof location !== "undefined" && location.protocol === "https:";
    throw new Error(insecure
      ? "Couldn't reach your Command Centre. This page is secure (https) so the browser blocks plain http:// addresses — use an https tunnel (Tailscale Funnel, Cloudflare Tunnel, ngrok)."
      : "Couldn't reach your Command Centre. Check it's running, reachable from this device, and allows requests from this site (CORS).");
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`Command Centre replied ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  return normalizeReply(text);
}
