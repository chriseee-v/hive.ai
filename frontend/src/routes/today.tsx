import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useHive, type Tab } from "@/components/deck/hive-provider";
import { liveCount } from "@/lib/hive";

export const Route = createFileRoute("/today")({
  head: () => ({
    meta: [
      { title: "Today · Hivedeck" },
      { name: "description", content: "Daily launch screen for the Hivedeck agent command center: date, notes, todos and quick links." },
      { property: "og:title", content: "Today · Hivedeck" },
      { property: "og:description", content: "Daily launch screen for the Hivedeck agent command center." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Today,
});

// 5x7 dot-matrix glyphs
const G: Record<string, string[]> = {
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  "0": ["01110", "10011", "10101", "10101", "10101", "11001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};
const COLS = 8;
/** Dot-matrix board that keeps cycling: HIVEDECK → clock → agents live → GPU load. */
function DotBoard({ live, gpu }: { live: number; gpu: number }) {
  const [i, setI] = useState(0);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const t = setInterval(() => { setI((x) => x + 1); setNow(new Date()); }, 3500); return () => clearInterval(t); }, []);
  const hm = now ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` : "--:--";
  const words = ["HIVEDECK", ` ${hm} `, `${live} LIVE`, `GPU ${Math.min(99, Math.round(gpu))}`];
  const word = words[i % words.length]!.slice(0, COLS).padEnd(COLS, " ").replace(/[^A-Z0-9: ]/g, " ");
  const label = words[i % words.length]!.trim();
  return (
    <div className="flex justify-center gap-[1.6vw]" aria-label={label} role="img">
      {word.split("").map((ch, k) => (
        <div key={k} className="grid grid-cols-5 gap-[0.35vw]">
          {(G[ch] ?? G[" "]!).join("").split("").map((b, j) => (
            <span key={j} style={{ transitionDelay: `${(k * 35 + (j % 5) * 25 + Math.floor(j / 5) * 15)}ms` }}
              className={cn("h-[1.3vw] w-[1.3vw] rounded-[2px] transition-colors duration-300", b === "1" ? (i % words.length === 0 ? "bg-foreground" : "bg-primary") : "bg-card")} />
          ))}
        </div>
      ))}
    </div>
  );
}

type Todo = { id: number; text: string; done: boolean };
type QL = { label: string; href: string };
const DEFAULT_TODOS: Todo[] = [{ id: 1, text: "Review Ledger migration", done: false }, { id: 2, text: "Check GPU temps after training run", done: false }];
const DECK: { label: string; tab: "Swarm" | "Hardware" | "Containers" | "Logs" | "Map" | "Chat" }[] = [
  { label: "Swarm", tab: "Swarm" }, { label: "Hardware", tab: "Hardware" }, { label: "Containers", tab: "Containers" }, { label: "Logs", tab: "Logs" }, { label: "Map", tab: "Map" }, { label: "Chat", tab: "Chat" },
];
const DEFAULT_LINKS: QL[] = [
  { label: "GitHub", href: "https://github.com" }, { label: "Docker Hub", href: "https://hub.docker.com" }, { label: "Grafana", href: "http://localhost:3000" },
  { label: "Ollama", href: "http://localhost:11434" }, { label: "Hugging Face", href: "https://huggingface.co" }, { label: "Portainer", href: "http://localhost:9000" },
];

function useStored<T>(key: string, init: T) {
  const [v, setV] = useState<T>(init);
  const [ready, setReady] = useState(false);
  useEffect(() => { try { const r = localStorage.getItem(key); if (r) setV(JSON.parse(r)); } catch { /* ignore */ } setReady(true); }, [key]);
  useEffect(() => { if (ready) localStorage.setItem(key, JSON.stringify(v)); }, [key, v, ready]);
  return [v, setV] as const;
}

const pct = (a: number, b: number) => Math.round((a / b) * 100);
function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[11px]">
      <div className="h-2.5 w-40 bg-card"><div className="h-full bg-foreground" style={{ width: `${value}%` }} /></div>
      <span className="text-muted-foreground">{label} {value}%</span>
    </div>
  );
}
const btn = "h-11 min-w-11 border border-border px-4 font-mono text-[11px] uppercase tracking-wider text-foreground active:bg-foreground active:text-background";

function Today() {
  const navigate = useNavigate();
  const { s, lastTab } = useHive();
  const live = liveCount(s);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const [note, setNote] = useStored("hd.note", "Hivedeck is the command center for my agent swarm.");
  const [todos, setTodos] = useStored<Todo[]>("hd.todos", DEFAULT_TODOS);
  const [links, setLinks] = useStored<QL[]>("hd.links", DEFAULT_LINKS);
  const [todo, setTodo] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(false);
  const [nl, setNl] = useState({ label: "", href: "" });

  const d = now;
  const dayPct = d ? pct(d.getHours() * 60 + d.getMinutes(), 1440) : 0;
  const monthPct = d ? pct(d.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()) : 0;
  const yearPct = d ? pct((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 864e5, 365) : 0;
  const online = s.containers.filter((c) => c.state === "running").length;
  const cards: { tab: Tab; title: string; sub: string; hint: string; glyph: string }[] = [
    { tab: "Swarm", title: "Swarm", sub: `${live} live`, hint: "agent cards & task logs", glyph: "◍" },
    { tab: "Hardware", title: "Hardware", sub: `CPU ${Math.round(s.cpu)}% · GPU ${Math.round(s.gpu)}%`, hint: "load history", glyph: "▦" },
    { tab: "Containers", title: "Containers", sub: `${online}/${s.containers.length} up`, hint: "health, logs, restart", glyph: "▣" },
    { tab: "Logs", title: "Logs", sub: `${s.agents.reduce((n, g) => n + g.logs.length, 0)} lines`, hint: "live terminal", glyph: "≡" },
    { tab: "Map", title: "Constellation", sub: `${s.agents.length + 1} nodes`, hint: "agent topology", glyph: "✳" },
    { tab: "Chat", title: "Command Centre", sub: "chat", hint: "talk to local agents", glyph: "✉" },
  ];
  const ql = q.trim().toLowerCase();
  const deckHits = DECK.filter((x) => !ql || x.label.toLowerCase().includes(ql));
  const linkHits = links.filter((x) => !ql || x.label.toLowerCase().includes(ql));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ql) return;
    if (deckHits[0]) { void navigate({ to: "/", search: { tab: deckHits[0].tab } }); return; }
    if (linkHits[0]) { window.open(linkHits[0].href, "_blank", "noopener"); return; }
    window.open(`https://duckduckgo.com/?q=${encodeURIComponent(q)}`, "_blank", "noopener");
  };

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-8">
      <nav aria-label="Status" className="mx-auto mb-8 flex max-w-6xl items-center gap-2">
        <span className={cn(btn, "grid place-items-center bg-foreground text-background")}>Today</span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">{live} agents live · {s.containers.filter((c) => c.state === "running").length} containers up</span>
      </nav>
      <DotBoard live={live} gpu={s.gpu} />
      <section aria-label="Open a section" className="mx-auto mt-8 max-w-6xl">
        <div className="mb-3 flex items-center font-mono text-[11px] text-muted-foreground">OPEN A SECTION<span className="ml-auto">swipe →</span></div>
        <div className="-mx-4 no-scrollbar flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          {cards.map((c) => (
            <Link key={c.tab} to="/" search={{ tab: c.tab }} className="dotgrid group flex h-44 w-48 shrink-0 snap-start flex-col justify-between border border-border bg-background p-4 active:border-primary sm:w-56">
              <span className="text-3xl text-primary">{c.glyph}</span>
              <span>
                <span className="block font-mono text-sm uppercase tracking-wider">{c.title}</span>
                <span className="mt-1 block font-mono text-[11px] text-primary">{c.sub}</span>
                <span className="mt-1 block font-mono text-[10px] text-muted-foreground">{c.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
      <main className="mx-auto mt-8 grid max-w-6xl gap-x-10 gap-y-8 border border-border bg-background p-6 sm:p-8 lg:grid-cols-2">
        <section>
          <div className="font-mono text-5xl tracking-tight">{d ? `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getFullYear()).slice(2)}` : "--.--.--"}</div>
          <div className="mt-4 space-y-1.5"><Bar label="DAY" value={dayPct} /><Bar label="MONTH" value={monthPct} /><Bar label="YEAR" value={yearPct} /></div>
        </section>
        <section>
          <div className="font-mono text-5xl uppercase tracking-tight">{d ? d.toLocaleDateString("en", { weekday: "long" }) : "—"}</div>
          <div className="mt-4 flex items-center gap-3 font-mono text-[11px] uppercase text-muted-foreground">
            <span className="grid h-11 w-11 place-items-center border border-border text-primary">◐</span>
            <div>Local time: {d ? d.toLocaleTimeString() : "--:--:--"}<br />Timezone: {d ? Intl.DateTimeFormat().resolvedOptions().timeZone : "—"}<br />Deck: <Link to="/" search={{ tab: lastTab }} className="text-primary underline">resume {lastTab}</Link></div>
          </div>
        </section>

        <form onSubmit={submit} className="lg:col-span-1">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="TYPE TO SEARCH AND PRESS ENTER…"
            className="h-12 w-full border border-border bg-background px-4 font-mono text-xs uppercase tracking-wider outline-none placeholder:text-muted-foreground focus:border-primary" />
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">Jumps to a deck view or link — otherwise searches the web.</p>
        </form>
        <section className="flex flex-wrap items-center gap-2">
          <span className="w-10 font-mono text-[11px] text-muted-foreground">DECK</span>
          {deckHits.map((x) => <Link key={x.tab} to="/" search={{ tab: x.tab }} className={cn(btn, "grid place-items-center")}>{x.label}</Link>)}
          {!deckHits.length && <span className="font-mono text-[11px] text-muted-foreground">No deck views match.</span>}
        </section>

        <section className="grid gap-8 border-t border-border pt-6 sm:grid-cols-2">
          <div>
            <div className="mb-3 font-mono text-[11px] text-muted-foreground">NOTE</div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-40 w-full resize-none bg-transparent font-mono text-xs leading-relaxed outline-none" />
          </div>
          <div>
            <div className="mb-3 font-mono text-[11px] text-muted-foreground">TODO</div>
            <form onSubmit={(e) => { e.preventDefault(); if (todo.trim()) { setTodos([...todos, { id: Date.now(), text: todo.trim(), done: false }]); setTodo(""); } }} className="flex gap-2">
              <input value={todo} onChange={(e) => setTodo(e.target.value)} placeholder="Enter a new todo" className="h-11 min-w-0 flex-1 border-b border-border bg-transparent font-mono text-xs outline-none focus:border-primary" />
              <button className={btn}>Add</button>
            </form>
            <ul className="mt-3 space-y-1">
              {todos.map((t) => (
                <li key={t.id} className="flex items-center gap-2 font-mono text-xs">
                  <button onClick={() => setTodos(todos.map((x) => x.id === t.id ? { ...x, done: !x.done } : x))} className={cn("min-h-11 flex-1 text-left", t.done && "text-muted-foreground line-through")}>{t.text}</button>
                  <button onClick={() => setTodos(todos.filter((x) => x.id !== t.id))} className={btn}>Delete</button>
                </li>
              ))}
              {!todos.length && <li className="font-mono text-xs text-muted-foreground">Nothing to do. Nice.</li>}
            </ul>
          </div>
        </section>

        <section className="border-t border-border pt-6">
          <div className="mb-3 flex items-center font-mono text-[11px] text-muted-foreground">LINKS
            <button onClick={() => setEditing(!editing)} className={cn(btn, "ml-auto")}>{editing ? "Done" : "Edit links"}</button></div>
          <div className="grid grid-cols-2 gap-x-6 font-mono text-xs sm:grid-cols-3">
            {linkHits.map((l) => (
              <div key={l.label + l.href} className="flex items-center">
                <a href={l.href} target="_blank" rel="noopener noreferrer" className="flex min-h-11 flex-1 items-center hover:text-primary">{l.label}</a>
                {editing && <button aria-label={`Remove ${l.label}`} onClick={() => setLinks(links.filter((x) => x !== l))} className="h-11 w-11 text-destructive">✕</button>}
              </div>
            ))}
          </div>
          {!linkHits.length && <p className="font-mono text-xs text-muted-foreground">No links match “{q}”.</p>}
          {editing && (
            <form onSubmit={(e) => { e.preventDefault(); if (nl.label.trim() && /^https?:\/\//.test(nl.href)) { setLinks([...links, { label: nl.label.trim(), href: nl.href.trim() }]); setNl({ label: "", href: "" }); } }} className="mt-3 flex flex-wrap gap-2">
              <input value={nl.label} onChange={(e) => setNl({ ...nl, label: e.target.value })} placeholder="Name" className="h-11 w-28 border border-border bg-transparent px-3 font-mono text-xs outline-none" />
              <input value={nl.href} onChange={(e) => setNl({ ...nl, href: e.target.value })} placeholder="https://…" className="h-11 min-w-0 flex-1 border border-border bg-transparent px-3 font-mono text-xs outline-none" />
              <button className={btn}>Add link</button>
            </form>
          )}
        </section>
        <footer className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground lg:col-span-2">
          <Link to="/" search={{ tab: lastTab }} className={cn(btn, "grid place-items-center")}>Resume deck</Link> Hivedeck // Today · saved on this device
        </footer>
      </main>
    </div>
  );
}
