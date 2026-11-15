import { describe, it, expect } from "vitest";
import { normalizeReply, toTrace } from "./agent-link";
describe("agent link", () => {
  it("unwraps a JSON reply sent as a string, like the screenshot", () => {
    const r = normalizeReply('{"completed": true, "summary": "## Task Completed", "engine": "windows-use"}');
    expect(r.summary).toBe("## Task Completed");
    expect(r.engine).toBe("windows-use");
  });
  it("turns steps into trace rows, marking failures", () => {
    const t = toTrace({ steps: [{ label: "Plan", detail: "Inspect desktop" }, { label: "Run", status: "error" }] });
    expect(t.map((n) => n.status)).toEqual(["completed", "failed"]);
  });
});
