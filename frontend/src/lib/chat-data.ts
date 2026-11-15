import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TraceNode } from "@/components/ui/ai-thinking-and-tool-calls";

export interface Thread { id: string; title: string; updated_at: string }
export interface Msg { id: string; thread_id: string; role: "user" | "assistant"; content: string; trace: TraceNode[]; status: string; engine: string | null; created_at: string }
export interface Profile { id: string; display_name: string | null; avatar_url: string | null; agent_endpoint: string | null; agent_token: string | null }

const must = <T,>(r: { data: T | null; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data as T; };

export const threadsQuery = queryOptions({
  queryKey: ["threads"],
  queryFn: async () => must(await supabase.from("chat_threads").select("id,title,updated_at").order("updated_at", { ascending: false })) as Thread[],
});
export const messagesQuery = (threadId: string) => queryOptions({
  queryKey: ["messages", threadId],
  queryFn: async () => must(await supabase.from("chat_messages").select("*").eq("thread_id", threadId).order("created_at")) as unknown as Msg[],
});
export const profileQuery = queryOptions({
  queryKey: ["profile"],
  queryFn: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("Not signed in");
    const p = must(await supabase.from("profiles").select("*").eq("id", u.user.id).maybeSingle()) as Profile | null;
    return { profile: p ?? { id: u.user.id, display_name: u.user.email ?? null, avatar_url: null, agent_endpoint: null, agent_token: null }, email: u.user.email ?? "" };
  },
});

export async function createThread(title = "New conversation") {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("Supabase anonymous session is not available");
  return must(await supabase.from("chat_threads").insert({ title, user_id: userData.user.id }).select("id").single()) as { id: string };
}
export async function addMessage(m: { thread_id: string; role: "user" | "assistant"; content: string; trace?: TraceNode[]; status?: string; engine?: string | null }) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("Supabase anonymous session is not available");
  return must(await supabase.from("chat_messages").insert({ ...m, user_id: userData.user.id, trace: (m.trace ?? []) as never }).select("*").single()) as unknown as Msg;
}
export async function touchThread(id: string, title?: string) {
  must(await supabase.from("chat_threads").update({ updated_at: new Date().toISOString(), ...(title ? { title } : {}) }).eq("id", id).select("id"));
}
export async function deleteThread(id: string) { must(await supabase.from("chat_threads").delete().eq("id", id).select("id")); }
