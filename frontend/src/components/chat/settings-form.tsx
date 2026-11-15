import { useState } from "react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { profileQuery } from "@/lib/chat-data";
import { callAgent } from "@/lib/agent-link";

export function SettingsForm({ onSaved }: { onSaved?: () => void }) {
  const { data: me } = useSuspenseQuery(profileQuery);
  const qc = useQueryClient();
  const [f, setF] = useState({ display_name: me.profile.display_name ?? "", avatar_url: me.profile.avatar_url ?? "", agent_endpoint: me.profile.agent_endpoint ?? "", agent_token: me.profile.agent_token ?? "" });
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = !f.agent_endpoint || /^https?:\/\/\S+$/.test(f.agent_endpoint);
  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("profiles").upsert({ id: me.profile.id, display_name: f.display_name || null, avatar_url: f.avatar_url || null,
      agent_endpoint: f.agent_endpoint.trim() || null, agent_token: f.agent_token || null, updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    await qc.invalidateQueries({ queryKey: ["profile"] }); toast.success("Saved"); onSaved?.();
  };
  const ping = async () => {
    setTest(null);
    try { const r = await callAgent(f.agent_endpoint.trim(), f.agent_token || null, { message: "ping", thread_id: "connection-test", history: [] }); setTest({ ok: true, text: `Connected${r.engine ? ` · ${r.engine}` : ""}` }); }
    catch (e) { setTest({ ok: false, text: (e as Error).message }); }
  };
  const field = "h-12 w-full border border-border bg-background px-5 text-sm outline-none focus:border-primary";
  return (
    <div className="text-foreground">
      <div className="space-y-4">
        <section className=" bg-card-2 p-5 space-y-3">
          <h1 className="text-lg font-semibold">Profile</h1>
          <p className="text-xs text-muted-foreground">{me.email}</p>
          <input className={field} placeholder="Display name" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
          <input className={field} placeholder="Avatar image link (https://…)" value={f.avatar_url} onChange={(e) => setF({ ...f, avatar_url: e.target.value })} />
        </section>
        <section className=" bg-card-2 p-5 space-y-3">
          <h2 className="text-lg font-semibold">Command Centre link</h2>
          <p className="text-sm text-muted-foreground">The address your local agent router accepts chat requests on. This device calls it directly, so it must be reachable from here and use https (e.g. a Tailscale or Cloudflare tunnel).</p>
          <input className={field} placeholder="https://my-pc.tailnet.ts.net/chat" value={f.agent_endpoint} onChange={(e) => setF({ ...f, agent_endpoint: e.target.value })} />
          {!valid && <p className="text-xs text-destructive">Enter a full address starting with https://</p>}
          <input className={field} type="password" placeholder="Access key (optional, sent as Bearer)" value={f.agent_token} onChange={(e) => setF({ ...f, agent_token: e.target.value })} />
          <div className="flex flex-wrap gap-2">
            <button disabled={!f.agent_endpoint || !valid} onClick={ping} className="h-12 border border-border px-5 text-sm disabled:opacity-40">Test connection</button>
            {test && <span className={test.ok ? "self-center text-sm text-success" : "self-center text-sm text-destructive"}>{test.text}</span>}
          </div>
          <details className=" bg-background p-4 font-mono text-[11px] text-muted-foreground">
            <summary className="cursor-pointer">Request / reply format</summary>
            <pre className="mt-2 whitespace-pre-wrap">{`POST  { "message": "...", "thread_id": "...", "history": [{ "role": "user", "content": "..." }] }
Reply { "completed": true, "summary": "markdown", "engine": "windows-use",
        "steps": [{ "label": "Plan", "detail": "Inspect desktop", "status": "completed" },
                  { "tool": "windows_mcp", "label": "Desktop task", "args": {...} },
                  { "command": "start msedge", "output": "..." }] }
Allow CORS from this site's address.`}</pre>
          </details>
        </section>
        <button disabled={saving || !valid} onClick={save} className="h-12 w-full bg-primary font-semibold text-primary-foreground disabled:opacity-40">{saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}
