# Remote Command Centre access

The dashboard and API now bind to `0.0.0.0` by default. This lets an iPad or another device on the same Wi-Fi use the Windows laptop as the execution host.

## Start the system

On the Windows laptop, use two terminals:

```powershell
cd C:\projects\chill.ai
.\run-backend.ps1
```

```powershell
cd C:\projects\chill.ai\frontend
npm run dev
```

Vite prints a `Network:` URL. Open that URL on the iPad. The browser automatically sends API requests to the same laptop hostname on port `8001`.

## Persisted chat history

The frontend already uses Supabase `chat_threads` and `chat_messages`. Sign in at `/auth` before sending messages. The Command Centre chat then loads the latest conversation and saves user prompts and completed assistant results.

Apply `frontend/drizzle/migrations/0000_chat_profiles_threads.sql` to the connected Supabase project if those tables do not exist yet. Row-level security keeps each signed-in user's history separate.

## Find the laptop address

```powershell
ipconfig
```

Use the laptop's private IPv4 address if Vite does not show the Network URL, for example `http://192.168.1.20:3002`.

Only use this on a trusted network. For access outside the home network, use a private VPN such as Tailscale rather than forwarding port `8001` directly to the internet.

## Web questions

LangSearch is used for current/web questions such as weather, news, prices, and explicit searches. Add the free key to the project `.env` without exposing it to the browser:

```env
LANGSEARCH_API_KEY=your_langsearch_key
```

Requests that ask to open an app, type, click, or control Windows continue through Windows-Use instead of LangSearch. The integration uses LangSearch's direct web-search endpoint and preserves source URLs.
