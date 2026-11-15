import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, LoaderCircle, Mic, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { addMessage, createThread, touchThread, type Msg } from "@/lib/chat-data";
import { cn } from "@/lib/utils";
import { AgentWorkflow, type AgentPhase } from "@/components/ui/ai-thinking-and-tool-calls";

const API = typeof window !== "undefined"
  ? `${window.location.protocol}//${window.location.hostname}:${import.meta.env.VITE_COMMAND_CENTRE_API_PORT ?? "8001"}`
  : (import.meta.env.VITE_COMMAND_CENTRE_API ?? "http://127.0.0.1:8001");

type Task = { id: string; prompt: string; status: string; agent_id?: string; mode?: string; result?: string; error?: string; approval_required?: boolean; tool_proposal?: { tool: string; arguments: Record<string, unknown> } | null; plan?: string[]; reason?: string };
type EventRow = { id: string; title: string; text: string; state: "running" | "completed" | "failed" };

async function body(response: Response) { const text = await response.text(); try { return JSON.parse(text); } catch { return { detail: text || `Request failed (${response.status})` }; } }

function parsedResult(value?: string) {
  if (!value) return null;
  const raw = String(value).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { const parsed = JSON.parse(raw); return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null; } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) { try { const parsed = JSON.parse(raw.slice(start, end + 1)); return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null; } catch {} }
    return null;
  }
}

function cleanText(value: unknown) {
  return String(value ?? "").replaceAll("\\n", "\n").replaceAll('\\"', '"').trim();
}

function ResultSummary({ task }: { task: Task }) {
  const result = parsedResult(task.result);
  const title = cleanText(result?.["title"]);
  const answer = result?.["content"] ?? result?.["answer"] ?? result?.["response"] ?? result?.["summary"] ?? result?.["message"];
  const summary = cleanText(answer ?? task.result ?? task.reason ?? "Working through your request…");
  const lines = summary.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return <div className="max-w-2xl text-[13px] leading-5">
    <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-success"><Check size={12} />{task.status === "completed" ? "Completed" : "Result"}</div>
    {title && <h3 className="mb-2 text-base font-medium text-foreground">{title}</h3>}
    {lines.length > 1 ? <ul className="space-y-1.5">{lines.map((line, index) => <li key={index} className="flex gap-2"><span className="text-primary">·</span><span>{line.replace(/^[-*]\s*/, "")}</span></li>)}</ul> : <p>{summary}</p>}
    {Array.isArray(result?.["key_facts"]) && result["key_facts"].length > 0 && <div className="mt-3"><div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Key facts</div><ul className="space-y-1">{result["key_facts"].map((fact, index) => <li key={index} className="flex gap-2"><span className="text-primary">·</span><span>{String(fact)}</span></li>)}</ul></div>}
  </div>;
}

function HistoryMessage({ message }: { message: Msg }) {
  const result = parsedResult(message.content);
  const content = result?.["content"] ?? result?.["answer"] ?? result?.["response"] ?? result?.["summary"] ?? result?.["message"];
  return <div className="max-w-2xl text-[13px] leading-5 text-muted-foreground">{content ? cleanText(content) : message.content}</div>;
}

function WorkflowSteps({ events, task, approvalBusy, onApprove }: { events: EventRow[]; task: Task; approvalBusy: boolean; onApprove: (approved: boolean) => void }) {
  const trace: AgentPhase["trace"] = events.map((event) => ({ id: event.id, type: event.state === "failed" ? "tool" : "step", primary: event.title, secondary: event.text, status: event.state === "running" ? "running" : event.state === "failed" ? "failed" : "completed" }));
  if (task.tool_proposal) trace.push({ id: `${task.id}-proposal`, type: "tool", toolName: task.tool_proposal.tool, args: task.tool_proposal.arguments, primary: task.tool_proposal.tool, secondary: task.approval_required ? "Waiting for approval" : task.status });
  return <div className="mt-4 max-w-2xl px-1 text-[13px]"><AgentWorkflow phases={[{ trace }]} workingLabel="Working through your request" className="gap-1" />{task.tool_proposal?.arguments && <div className="mt-3 border-t border-border/60 pt-2"><div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Action details</div><pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap bg-card/60 p-2 text-[11px] text-muted-foreground">{JSON.stringify(task.tool_proposal.arguments, null, 2)}</pre>{task.approval_required && <div className="mt-3 flex gap-2"><button className="h-8 border border-border px-3 text-xs" disabled={approvalBusy} onClick={() => onApprove(false)}>Reject</button><button className="h-8 bg-primary px-3 text-xs text-primary-foreground" disabled={approvalBusy} onClick={() => onApprove(true)}>{approvalBusy ? "Working…" : "Approve action"}</button></div>}</div>}</div>;
}

export function ChatPanel({ threadId, setThread }: { threadId: string | undefined; setThread: (id: string | undefined) => void }) {
  const [prompt, setPrompt] = useState("");
  const [task, setTask] = useState<Task | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [history, setHistory] = useState<Msg[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyUser, setHistoryUser] = useState(false);
  const persistedThread = useRef<string | undefined>(threadId);
  const persistedAssistant = useRef<string | undefined>(undefined);
  const transcript = useRef<HTMLDivElement>(null);

  useEffect(() => { fetch(`${API}/api/agents`).then((r) => { setConnected(r.ok); return r.json(); }).catch(() => setConnected(false)); }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
      let { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) {
        const anonymous = await supabase.auth.signInAnonymously();
        if (anonymous.error) throw anonymous.error;
        sessionData = anonymous.data;
      }
      if (cancelled) return;
      const session = sessionData.session;
      setHistoryUser(Boolean(session?.user));
      if (!session?.user) { setHistoryReady(true); return; }
      if (!threadId) {
        const { data: threads, error: threadsError } = await supabase.from("chat_threads").select("id").order("updated_at", { ascending: false }).limit(1);
        if (threadsError) throw threadsError;
        const latest = threads?.[0]?.id;
        if (latest && !cancelled) { setThread(latest); return; }
      }
      if (threadId) {
        const { data, error } = await supabase.from("chat_messages").select("*").eq("thread_id", threadId).order("created_at");
        if (error) throw error;
        if (!cancelled) setHistory((data ?? []) as unknown as Msg[]);
      }
      if (!cancelled) setHistoryReady(true);
      } catch (reason) {
        if (!cancelled) { setHistoryReady(true); setError(`Supabase history is unavailable: ${String((reason as Error)?.message ?? reason)}`); }
      }
    })();
    return () => { cancelled = true; };
  }, [threadId, setThread]);
  useEffect(() => { persistedThread.current = threadId; }, [threadId]);
  useEffect(() => {
    if (!task || ["completed", "failed", "rejected", "cancelled"].includes(task.status)) return;
    const socket = new WebSocket(API.replace(/^http/, "ws") + `/ws/tasks/${task.id}`);
    let disposed = false;
    socket.onmessage = (message) => {
      const event = JSON.parse(message.data) as { type: string; payload?: Record<string, unknown> };
      const p = event.payload ?? {};
      if (event.type === "task.snapshot") { setTask((t) => t?.id === task.id ? { ...t, ...(p as Partial<Task>) } : t); return; }
      const snapshot = p.snapshot as Task | undefined;
      if (snapshot) setTask((t) => t?.id === task.id ? { ...t, ...snapshot } : t);
      const failed = event.type === "task.failed";
      setEvents((rows) => [...rows, { id: `${task.id}-${rows.length}`, title: event.type.replace("task.", "").replaceAll(".", " "), text: String(p.text ?? p.result ?? p.error ?? ""), state: failed || event.type === "task.cancelled" ? "failed" : event.type === "task.completed" ? "completed" : "running" }]);
      if (failed || event.type === "task.completed" || event.type === "task.cancelled") {
        setTask((t) => {
          if (!t || t.id !== task.id) return t;
          const next = { ...t, status: event.type === "task.cancelled" ? "cancelled" : failed ? "failed" : "completed" } as Task;
          if (p.result) next.result = String(p.result);
          if (p.error) next.error = String(p.error);
          return next;
        });
        if (event.type === "task.completed" && historyUser && persistedThread.current && persistedAssistant.current !== task.id) {
          persistedAssistant.current = task.id;
          const content = p.result ? String(p.result) : "Task completed.";
          void addMessage({ thread_id: persistedThread.current, role: "assistant", content, status: "completed", engine: "command-centre" })
            .then((saved) => { setHistory((rows) => [...rows, saved]); return touchThread(persistedThread.current!, task.prompt.slice(0, 60)); })
            .catch((reason) => setError(`Task completed, but history could not be saved: ${String(reason?.message ?? reason)}`));
        }
        window.setTimeout(() => socket.close(1000, "task finished"), 0);
      }
    };
    socket.onerror = () => { /* onclose provides the useful diagnostic; transient errors are not shown as task failures */ };
    socket.onclose = (event) => { if (!disposed && ![1000, 1001].includes(event.code)) setError("Live updates disconnected. The backend may still finish the task; retrying is safe."); };
    return () => { disposed = true; if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(1000, "task state changed"); };
  }, [task?.id]);
  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: "smooth" }); }, [task, events, error]);

  async function submit(event?: FormEvent) {
    event?.preventDefault(); const clean = prompt.trim(); if (!clean || busy) return;
    setBusy(true); setError(""); setEvents([]);
    try {
      if (historyUser) {
        try {
        let activeThread = persistedThread.current;
        if (activeThread) {
          const { data: ownedThread, error: ownershipError } = await supabase.from("chat_threads").select("id").eq("id", activeThread).maybeSingle();
          if (ownershipError) throw ownershipError;
          if (!ownedThread) activeThread = undefined;
        }
        if (!activeThread) {
          const created = await createThread(clean.slice(0, 60) || "New conversation");
          activeThread = created.id;
          persistedThread.current = activeThread;
          setThread(created.id);
        }
        const saved = await addMessage({ thread_id: activeThread, role: "user", content: clean, status: "completed" });
        setHistory((rows) => [...rows, saved]);
        } catch (reason) {
          setError(`Prompt will run, but Supabase could not save it: ${String((reason as Error)?.message ?? reason)}`);
        }
      }
      const needsContext = /\b(continue|again|same|that|it|this|earlier|previous|before|remember|context|what did i|what was)\b/i.test(clean);
      const context = needsContext
        ? history.slice(-12).map((message) => `${message.role}: ${message.content}`).join("\n\n")
        : "";
      const response = await fetch(`${API}/api/orchestrate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: clean, context, agent_id: "auto" }) }); const value = await body(response); if (!response.ok) throw new Error(value.detail ?? `Request failed (${response.status})`); setTask(value); setPrompt(""); setConnected(true);
      if (value.status === "completed") {
        setEvents([{ id: "local-reply", title: "Answered locally", text: value.reason ?? "No agent task was needed.", state: "completed" }]);
        if (historyUser && persistedThread.current && value.result) {
          const saved = await addMessage({ thread_id: persistedThread.current, role: "assistant", content: String(value.result), status: "completed", engine: "local" });
          setHistory((rows) => [...rows, saved]);
          await touchThread(persistedThread.current, clean.slice(0, 60));
        }
      } else {
        setEvents([{ id: "request", title: "Request received", text: "Local Router is reading the request.", state: "completed" }, { id: "routing", title: "Routing", text: "Selecting the best local agent and execution path…", state: "running" }]);
      }
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not reach the local backend."); } finally { setBusy(false); }
  }
  async function approve(approved: boolean) {
    if (!task) return; setApprovalBusy(true); setError("");
    try { const response = await fetch(`${API}/api/tasks/${task.id}/approval`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved }) }); const value = await body(response); if (!response.ok) throw new Error(value.detail ?? "Approval failed"); setTask(value); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send the approval decision."); } finally { setApprovalBusy(false); }
  }
  async function stopTask() {
    if (!task || stopping || ["completed", "failed", "rejected", "cancelled"].includes(task.status)) return;
    setStopping(true); setError("");
    try {
      const response = await fetch(`${API}/api/tasks/${task.id}/cancel`, { method: "POST" });
      const value = await body(response);
      if (!response.ok) throw new Error(value.detail ?? "Stop failed");
      setTask(value);
      setEvents((rows) => [...rows, { id: `${task.id}-cancelled`, title: "Stopped", text: "The task was cancelled by you.", state: "failed" }]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not stop the task."); }
    finally { setStopping(false); }
  }
  function talk() { const Speech = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; if (!Speech) return setError("Voice input is unavailable in this browser."); const recognition = new Speech(); recognition.onstart = () => setRecording(true); recognition.onend = () => setRecording(false); recognition.onresult = (e: any) => setPrompt((v) => `${v}${v ? " " : ""}${e.results[0][0].transcript}`); recognition.start(); }

  const showWorkflow = Boolean(task?.tool_proposal || task?.approval_required || task?.agent_id === "hybrid" || task?.mode === "windows_desktop" || task?.mode === "local_tool");
  const status = busy ? "Planning" : task?.status?.replaceAll("_", " ") ?? (connected ? "Ready" : "Backend offline");
  return <section className="relative flex min-h-[70vh] flex-1 flex-col overflow-hidden text-[14px]">
    <div className="flex items-center justify-between border-b border-border px-5 py-3"><div><div className="font-mono text-[10px] tracking-[0.22em] text-muted-foreground">LOCAL AGENTS · WINDOWS</div><h2 className="mt-1 text-lg font-semibold">Command Centre</h2></div><div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground"><span className={cn("h-2 w-2 rounded-full", connected ? "bg-success" : "bg-destructive")} />{status}</div></div>
    <div ref={transcript} className="flex-1 overflow-y-auto px-5 py-6 sm:px-12"><div className="mx-auto max-w-3xl">
      {history.length > 0 && <div className="mb-8 space-y-4 border-b border-border pb-6">{history.filter((message) => !(task && ((message.role === "user" && message.content === task.prompt) || (message.role === "assistant" && task.result && message.content === task.result)))).map((message) => message.role === "user" ? <div key={message.id} className="flex justify-end"><div className="max-w-[80%] bg-card-2 px-4 py-2.5 text-[13px] leading-5">{message.content}</div></div> : <HistoryMessage key={message.id} message={message} />)}</div>}
      {!task && !busy && history.length === 0 && <div className="grid min-h-[34vh] place-items-center text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-primary text-primary">◍</div><h1 className="mt-4 font-mono text-2xl uppercase tracking-tight sm:text-3xl">What should the swarm do?</h1><p className="mt-2 text-sm text-muted-foreground">Use the local agents, Windows-Use desktop control, and persistent memory.</p>{historyReady && !historyUser && <p className="mt-3 text-xs text-primary">Enable anonymous sign-ins in Supabase Auth to persist history.</p>}</div></div>}
      {task && <div><div className="ml-auto max-w-lg rounded-xl bg-card-2 px-4 py-2 text-[13px] leading-5">{task.prompt}</div><div className="mt-6 flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-primary text-primary">●</span><div className="min-w-0 flex-1"><div className={cn("text-sm leading-5", task.status === "failed" && "text-destructive")}>{task.error ? <p>{task.error}</p> : task.result && task.status === "completed" ? <ResultSummary task={task} /> : <p>{showWorkflow ? (task.reason || (task.status === "awaiting_approval" ? "Review the prepared action below." : "Working through your request…")) : "Thinking…"}</p>}</div>{showWorkflow && <WorkflowSteps events={events} task={task} approvalBusy={approvalBusy} onApprove={(approved) => void approve(approved)} />}<details className="mt-5 hidden" open={task.status === "awaiting_approval" || task.status === "running"}><summary><ChevronDown size={13} />{task.status}</summary></details></div></div></div>}
      {error && <div className="mt-6 flex items-center gap-3 border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}<button className="ml-auto" onClick={() => setError("")}><X size={15} /></button></div>}
    </div></div>
    <div className="border-t border-border p-5 sm:px-12"><form onSubmit={(e) => void submit(e)} className="mx-auto max-w-3xl border border-border bg-card p-3"><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }} placeholder="Plan, build, automate…" rows={2} className="w-full resize-none bg-transparent p-2 outline-none" /><div className="flex items-center justify-between"><div className="flex gap-2"><button type="button" className="grid h-10 w-10 place-items-center bg-card-2" title="Add context"><Plus size={16} /></button><span className="flex items-center px-3 font-mono text-xs text-muted-foreground">Auto</span></div><div className="flex gap-2"><button type="button" className={cn("grid h-10 w-10 place-items-center bg-card-2", recording && "text-primary")} title="Push to talk" onClick={talk}><Mic size={16} /></button>{task && !["completed", "failed", "rejected", "cancelled"].includes(task.status) ? <button type="button" onClick={() => void stopTask()} disabled={stopping} className="h-10 border border-destructive px-4 text-xs text-destructive">{stopping ? "Stopping…" : "Stop"}</button> : <button type="submit" disabled={!prompt.trim() || busy} className="grid h-10 w-10 place-items-center bg-primary text-primary-foreground disabled:opacity-50">{busy ? <LoaderCircle size={16} className="spin" /> : <ArrowUp size={16} />}</button>}</div></div></form><p className="mx-auto mt-2 max-w-3xl text-center font-mono text-[10px] text-muted-foreground">Local-first routing · Windows actions run through the configured desktop agent</p></div>
  </section>;
}
