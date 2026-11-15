# Hive Orbit Command Deck

This is the Command Centre frontend supplied in `hive-orbit-command-deck.zip`, adapted for the local FastAPI backend. Its Chat view uses the local `/api/orchestrate` and `/ws/tasks/{id}` endpoints; Supabase authentication is not required.

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

The repository launcher sets `VITE_COMMAND_CENTRE_API` automatically and serves the dashboard at `http://127.0.0.1:3001`.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
