<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

- Agent/container simulation is a pure reducer in src/lib/hive.ts (tested); UI ticks it client-side so a real backend can later replace the tick source.
- Deck UI is wrapped by ConsoleShell (src/components/deck/console-shell.tsx): full-bleed art per tab, tile shelf as navigation, title+stats; tab panels render as its children.
- Simulator state lives in HiveProvider (src/components/deck/hive-provider.tsx) mounted in __root so it survives route changes; deck tab is in the ?tab= search param.
- Agent pause/resume/stop history persists in localStorage (hd.agentEvents); Today notes/todos/links also use localStorage.
- Command Centre chat is a deck tab (?tab=Chat&thread=) rendered by src/components/chat/chat-panel.tsx with inline sign-in; browser calls the local agent endpoint directly (servers cannot reach a LAN); data in Cloud tables scoped by RLS.
- src/components/ui/ai-thinking-and-tool-calls.tsx is a vendored third-party component (ts-nocheck); render agent traces through it, do not fork its logic.
