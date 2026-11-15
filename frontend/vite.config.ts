// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// Never set ssr.external or resolve.external: the Worker has no runtime module resolution, so
// the build fails. Never add compression (compressPublicAssets, vite-plugin-compression):
// hosting already compresses at the edge.
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    // Load the project-level .env and expose only the public Supabase key to browser code.
    // Never expose SUPABASE_SECRET_KEY here.
    envDir: "..",
    envPrefix: ["VITE_", "SUPABASE_PUBLISHABLE_KEY"],
    server: {
      // Advertise a LAN URL by default. Override with 127.0.0.1 for local-only mode.
      host: process.env.VITE_COMMAND_CENTRE_FRONTEND_HOST ?? "0.0.0.0",
      port: Number(process.env.VITE_COMMAND_CENTRE_FRONTEND_PORT ?? 3001),
      strictPort: true,
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
