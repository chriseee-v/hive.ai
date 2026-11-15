import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthForm } from "@/components/chat/auth-form";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in · Hivedeck" }, { name: "description", content: "Sign in to Hivedeck to keep your Command Centre chats." },
    { property: "og:title", content: "Sign in · Hivedeck" }, { property: "og:description", content: "Sign in to Hivedeck." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const go = () => void navigate({ to: "/", search: { tab: "Chat" } });
  useEffect(() => { void supabase.auth.getUser().then(({ data }) => { if (data.user) go(); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="flex min-h-screen bg-background"><AuthForm onSignedIn={go} /></div>;
}
