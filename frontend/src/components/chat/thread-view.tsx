import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { ThinkingState, Markdown, type TraceNode } from "@/components/ui/ai-thinking-and-tool-calls";
import { messagesQuery, profileQuery, threadsQuery, addMessage, touchThread, type Msg } from "@/lib/chat-data";
import { callAgent, toTrace } from "@/lib/agent-link";
import { cn } from "@/lib/utils";

const pendingTrace: TraceNode[] = [
  { type: "step", primary: "Request received", secondary: "Sent to your Command Centre", status: "completed" },
  { type: "step", primary: "Routing", secondary: "Waiting for the agent to pick it up…", status: "running" },
];

export function ThreadView({ threadId, openSettings, header }: { threadId: string; openSettings: () => void; header?: (info: { count: number; ok: number; failed: number; engine: string | null }) => React.ReactNode }) {
  const { data: msgs } = useSuspenseQuery(messagesQuery(threadId));
  const { data: me } = useSuspenseQuery(profileQuery);
  const { data: threads } = useSuspenseQuery(threadsQuery);
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const endpoint = me.profile.agent_endpoint;

  useEffect(() => { box.current?.focus(); }, [busy]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length, optimistic]);

  const send = async () => {
    const content = text.trim();
    if (!content || busy) return;
    if (!endpoint) return;
    setText(""); setOptimistic(content); setBusy(true);
    const isFirst = msgs.length === 0 && threads.find((t) => t.id === threadId)?.title === "New conversation";
    try {
      await addMessage({ thread_id: threadId, role: "user", content });
      await qc.invalidateQueries({ queryKey: ["messages", threadId] });
      setOptimistic(null);
      abort.current = new AbortController();
      let reply: Msg["content"], trace: TraceNode[], status = "completed", engine: string | null = null;
      try {
        const r = await callAgent(endpoint, me.profile.agent_token, { message: content, thread_id: threadId, history: [...msgs, { role: "user", content } as Msg].slice(-20).map((m) => ({ role: m.role, content: m.content })) }, abort.current.signal);
        reply = r.summary ?? r.message ?? "(no summary returned)";
        trace = [{ type: "step", primary: "Request received", secondary: "Command Centre accepted the request", status: "completed" }, ...toTrace(r)];
        engine = r.engine ?? null;
        if (r.completed === false) status = "incomplete";
      } catch (e) {
        if ((e as Error).name === "AbortError") { reply = "Stopped before the agent replied."; status = "cancelled"; }
        else { reply = (e as Error).message; status = "failed"; }
        trace = [{ type: "step", primary: "Request received", status: "completed" }, { type: "step", primary: status === "failed" ? "Delivery failed" : "Cancelled", secondary: reply, status: "failed" }];
      }
      await addMessage({ thread_id: threadId, role: "assistant", content: reply, trace, status, engine });
      await touchThread(threadId, isFirst ? content.slice(0, 60) : undefined);
    } catch (e) {
      setText(content);
      alert(`Couldn't save the message: ${(e as Error).message}`);
    } finally {
      setOptimistic(null); setBusy(false); abort.current = null;
      await Promise.all([qc.invalidateQueries({ queryKey: ["messages", threadId] }), qc.invalidateQueries({ queryKey: ["threads"] })]);
    }
  };

  return (
    <>
      <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        {header?.({ count: msgs.length, ok: msgs.filter((m) => m.role === "assistant" && m.status === "completed").length,
          failed: msgs.filter((m) => m.status === "failed").length, engine: [...msgs].reverse().find((m) => m.engine)?.engine ?? null })}
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {!endpoint && (
            <div className=" border border-primary p-5 text-sm">
              <div className="font-semibold text-primary">Link your local Command Centre first</div>
              <p className="mt-1 text-muted-foreground">Add the address your agents listen on so messages here reach them.</p>
              <button onClick={openSettings} className="mt-3 inline-grid h-11 place-items-center bg-primary px-5 font-semibold text-primary-foreground">Link agents</button>
            </div>
          )}
          {endpoint && msgs.length === 0 && !optimistic && <div className="py-16 text-center text-sm text-muted-foreground">Ask your agents to do something — e.g. “open the browser and type in google”.</div>}
          {msgs.map((m) => m.role === "user"
            ? <UserBubble key={m.id} text={m.content} />
            : (
              <div key={m.id} className="flex gap-3">
                <span className={cn("mt-1 grid h-8 w-8 shrink-0 place-items-center bg-card-2", m.status === "failed" ? "text-destructive" : "text-primary")}>◐</span>
                <div className="min-w-0 flex-1">
                  {m.trace.length > 0 && <ThinkingState nodes={m.trace} autoPlay={false} defaultExpanded={m.status === "failed"} />}
                  <div className={cn("mt-2 text-[15px] leading-relaxed", m.status === "failed" && "text-destructive")}><Markdown text={m.content} /></div>
                  <div className="mt-2 font-mono text-[10px] text-muted-foreground">{m.engine ? `${m.engine} · ` : ""}{m.status !== "completed" ? `${m.status.toUpperCase()} · ` : ""}{new Date(m.created_at).toLocaleTimeString()}</div>
                </div>
              </div>
            ))}
          {optimistic && <UserBubble text={optimistic} />}
          {busy && (
            <div className="flex gap-3">
              <span className="mt-1 grid h-8 w-8 shrink-0 animate-pulse place-items-center bg-card-2 text-primary">◐</span>
              <div className="min-w-0 flex-1"><ThinkingState nodes={pendingTrace} autoPlay={false} defaultExpanded workingLabel="Working…" /></div>
            </div>
          )}
          <div ref={end} />
        </div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="relative mx-auto mb-4 w-full max-w-3xl px-4">
        <div className=" border border-border bg-card/90 p-3">
          <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} disabled={!endpoint}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder={endpoint ? "Message Command Centre" : "Link your Command Centre in settings to start"} rows={2}
            className="w-full resize-none bg-transparent px-2 text-[15px] outline-none placeholder:text-muted-foreground" />
          <div className="flex items-center justify-between">
            <span className="px-2 font-mono text-[10px] text-muted-foreground">Local-first routing · system changes always ask for approval</span>
            {busy
              ? <button type="button" onClick={() => abort.current?.abort()} className="h-11 bg-card-2 px-5 text-sm">■ Stop</button>
              : <button disabled={!text.trim() || !endpoint} className="grid h-11 w-11 place-items-center bg-primary text-primary-foreground disabled:opacity-40" aria-label="Send">↑</button>}
          </div>
        </div>
      </form>
    </>
  );
}

function UserBubble({ text }: { text: string }) {
  return <div className="flex justify-end"><div className="max-w-[80%] whitespace-pre-wrap bg-foreground px-4 py-2.5 text-[15px] text-background">{text}</div></div>;
}
