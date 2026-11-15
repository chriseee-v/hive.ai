import { createFileRoute, redirect } from "@tanstack/react-router";

// Chat now lives inside the deck; keep the old address working.
export const Route = createFileRoute("/chat")({
  beforeLoad: () => { throw redirect({ to: "/", search: { tab: "Chat" }, replace: true }); },
});
