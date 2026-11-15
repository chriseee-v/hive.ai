import { createContext, useContext, useEffect, useReducer, useRef, useState } from "react";
import { initialState, reducer, settleRestarts, type Action, type Activity, type State } from "@/lib/hive";
import forge from "@/assets/avatar-forge.jpg";
import scout from "@/assets/avatar-scout.jpg";
import ledger from "@/assets/avatar-ledger.jpg";

export type Tab = "Swarm" | "Hardware" | "Containers" | "Logs" | "Map" | "Chat";
export const TABS: Tab[] = ["Swarm", "Hardware", "Containers", "Logs", "Map", "Chat"];
const KEY = "hd.agentEvents";

function hiveReducer(s: State, a: Action) {
  const n = reducer(s, a);
  return a.type === "tick" && n.tick % 4 === 0 ? settleRestarts(n) : n;
}

interface Ctx { s: State; dispatch: React.Dispatch<Action>; sel: string | null; setSel: (id: string | null) => void; lastTab: Tab; setLastTab: (t: Tab) => void; seen: React.MutableRefObject<Set<number>> }
const HiveCtx = createContext<Ctx | null>(null);

// Lives in the root layout so the simulation, selection and last tab survive moving between Today and the deck.
export function HiveProvider({ children }: { children: React.ReactNode }) {
  const [s, dispatch] = useReducer(hiveReducer, undefined, () => initialState({ forge, scout, ledger }));
  const [sel, setSel] = useState<string | null>("forge");
  const [lastTab, setLastTab] = useState<Tab>("Swarm");
  const seen = useRef(new Set<number>());
  const loaded = useRef(false);

  useEffect(() => {
    try { const raw = localStorage.getItem(KEY); if (raw) dispatch({ type: "loadHistory", history: JSON.parse(raw) as Record<string, Activity[]> }); } catch { /* corrupt store: start fresh */ }
    loaded.current = true;
    const t = setInterval(() => dispatch({ type: "tick", r: Math.random(), now: Date.now() }), 1300);
    return () => clearInterval(t);
  }, []);

  const histKey = s.agents.map((g) => g.history.length + ":" + (g.history[0]?.at ?? 0)).join("|");
  useEffect(() => {
    if (!loaded.current) return;
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(s.agents.map((g) => [g.id, g.history]))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [histKey]);

  return <HiveCtx.Provider value={{ s, dispatch, sel, setSel, lastTab, setLastTab, seen }}>{children}</HiveCtx.Provider>;
}

export function useHive() {
  const c = useContext(HiveCtx);
  if (!c) throw new Error("useHive outside HiveProvider");
  return c;
}
