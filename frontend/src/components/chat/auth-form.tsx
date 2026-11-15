import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import "@lovable.dev/cloud-auth-js/styles.css";
import { cn } from "@/lib/utils";

const G = <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"/></svg>;

export function AuthForm({ onSignedIn }: { onSignedIn?: () => void }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((e) => { if (e === "SIGNED_IN") onSignedIn?.(); });
    return () => sub.subscription.unsubscribe();
  }, [onSignedIn]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    const { data, error } = mode === "in"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/auth" } });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    if (mode === "up" && !data.session) setMsg({ ok: true, text: "Check your email to confirm your account, then sign in." });
  };
  const social = async (p: "google" | "lovable") => {
    setMsg(null);
    const r = await lovable.auth.signInWithOAuth(p, { redirect_uri: window.location.origin + "/?tab=Chat" });
    if (r.error) setMsg({ ok: false, text: r.error.message ?? "Sign-in failed" });
  };
  const field = "h-12 w-full border border-border bg-background px-5 text-sm outline-none focus:border-primary";
  return (
    <div className="flex min-h-full w-full flex-1 items-start justify-center p-4 text-foreground">
      <div className="my-auto border border-border w-full max-w-md bg-card p-8">
        <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center bg-primary font-bold text-primary-foreground">◐</span>
          <div><div className="font-semibold">Hivedeck</div><div className="text-xs text-muted-foreground">Command Centre chats are saved to your account</div></div></div>
        <div className="mt-6 flex gap-1 bg-background p-1">
          {(["in", "up"] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={cn("h-11 flex-1 text-sm", mode === m ? "bg-foreground font-semibold text-background" : "text-muted-foreground")}>{m === "in" ? "Sign in" : "Create account"}</button>)}
        </div>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <input type="email" required autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
          <input type="password" required minLength={6} autoComplete={mode === "in" ? "current-password" : "new-password"} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
          <button disabled={busy} className="h-12 w-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "…" : mode === "in" ? "Sign in" : "Create account"}</button>
        </form>
        {msg && <p className={cn("mt-3 text-sm", msg.ok ? "text-success" : "text-destructive")}>{msg.text}</p>}
        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
        <div className="space-y-2">
          <button type="button" onClick={() => social("google")} className="flex h-12 w-full items-center justify-center gap-2.5 border px-3 text-sm font-medium" style={{ background: "#131314", borderColor: "#8E918F", color: "#E3E3E3" }}>{G}Continue with Google</button>
          <button type="button" onClick={() => social("lovable")} className="lovable-auth-button w-full !h-12 !">Continue with Lovable</button>
        </div>
      </div>
    </div>
  );
}
