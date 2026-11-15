import { describe, it, expect } from "vitest";
import { initialState, reducer, liveCount } from "./hive";
const s0 = () => initialState({ forge: "", scout: "", ledger: "" });
describe("hive", () => {
  it("starts with 3 agents live and 10 online / 1 restarting", () => {
    const s = s0();
    expect(liveCount(s)).toBe(3);
    expect(s.containers.filter((c) => c.state === "running").length).toBe(10);
    expect(s.containers.filter((c) => c.state === "restarting").length).toBe(1);
  });
  it("sending input resumes an awaiting agent", () => {
    const s = reducer(s0(), { type: "input", id: "ledger", text: "yes" });
    expect(s.agents[2]!.status).toBe("EXEC");
  });
  it("emergency pause stops log streaming", () => {
    let s = reducer(s0(), { type: "pauseAll" });
    const n = s.agents[0]!.logs.length;
    s = reducer(s, { type: "tick", r: 0.1 });
    expect(s.agents[0]!.logs.length).toBe(n);
  });
  it("stopping a task makes the agent idle and ends its script", () => {
    const s = reducer(s0(), { type: "stop", id: "forge", at: 1000 });
    expect(s.agents[0]!.status).toBe("IDLE");
    expect(s.agents[0]!.cursor).toBe(s.agents[0]!.script.length);
  });
  it("restarting a container counts the restart and marks it starting", () => {
    const s = reducer(s0(), { type: "containerRestart", id: "c0" });
    expect(s.containers[0]!.restarts).toBe(1);
    expect(s.containers[0]!.health).toBe("starting");
  });
  it("records pause, resume and stop with time and outcome", () => {
    let s = reducer(s0(), { type: "toggle", id: "forge", at: 1 });
    s = reducer(s, { type: "toggle", id: "forge", at: 2 });
    s = reducer(s, { type: "stop", id: "forge", at: 3 });
    s = reducer(s, { type: "stop", id: "forge", at: 4 });
    expect(s.agents[0]!.history.map((h) => [h.action, h.at, h.ok])).toEqual([["stop", 4, false], ["stop", 3, true], ["resume", 2, true], ["pause", 1, true]]);
  });
  it("logs a restart outcome with start time once the health check finishes", () => {
    let s = reducer(s0(), { type: "containerRestart", id: "c1", at: 1000 });
    s = { ...s, containers: s.containers.map((c) => c.id === "c1" ? { ...c, state: "running", uptime: 3 } : c) };
    s = reducer(s, { type: "tick", r: 0.5, now: 5000 });
    const e = s.containers[1]!.restartLog[0]!;
    expect([e.at, e.doneAt, e.ok]).toEqual([1000, 5000, true]);
  });
});
