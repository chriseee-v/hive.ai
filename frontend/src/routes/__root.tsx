import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext, HeadContent, Scripts, type ErrorComponentProps } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { HiveProvider } from "@/components/deck/hive-provider";
import appCss from "../styles.css?url";

function NotFoundComponent() {
  return <div className="flex min-h-screen items-center justify-center bg-background px-4"><div className="text-center"><h1 className="text-7xl font-bold">404</h1><p className="mt-3 text-muted-foreground">That Command Centre view does not exist.</p><Link className="mt-6 inline-flex bg-primary px-4 py-2 text-primary-foreground" to="/">Return home</Link></div></div>;
}

function ErrorComponent({ error }: ErrorComponentProps) {
  console.error(error);
  return <div className="flex min-h-screen items-center justify-center bg-background px-4"><div className="max-w-md text-center"><h1 className="text-xl font-semibold">This view could not load</h1><p className="mt-3 text-muted-foreground">{error instanceof Error ? error.message : "Please refresh the Command Centre."}</p></div></div>;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({ meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }, { title: "AI Command Centre" }, { name: "description", content: "Local-first agent command centre for Windows." }], links: [{ rel: "stylesheet", href: appCss }, { rel: "preconnect", href: "https://fonts.googleapis.com" }, { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" }, { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" }, { rel: "icon", href: "/favicon.ico", type: "image/x-icon" }] }),
  shellComponent: RootShell, component: RootComponent, notFoundComponent: NotFoundComponent, errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return <html lang="en" className="dark"><head><HeadContent /></head><body>{children}<Scripts /></body></html>;
}

function RootComponent() {
  const queryClient = new QueryClient();
  return <QueryClientProvider client={queryClient}><HiveProvider><Outlet /></HiveProvider><Toaster position="top-center" theme="dark" /></QueryClientProvider>;
}
