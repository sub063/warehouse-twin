import { useState } from "react";
import type { AgentSpec, WorldState } from "../../../shared/src";
import { terminalsIn } from "../../../shared/src";
import { sendCommand, setUniverse } from "../store";

// What every universe's default terminals provide (used before the
// universe has any terminals of its own).
const BASE_TOOLS = ["web.search", "web.read", "file.read", "file.write", "file.edit", "file.delete", "shell.run"];

const DEFAULT_TOOLS = ["web.search", "file.read", "file.edit", "shell.run"];

export function SpawnModal({
  world,
  universes,
  activeUniverse,
  mode,
  liveModels,
  onClose,
}: {
  world: WorldState;
  universes: string[];
  activeUniverse: string;
  mode: "mock" | "live";
  liveModels: string[];
  onClose: () => void;
}) {
  const models = mode === "live" && liveModels.length ? liveModels : ["mock-std", "mock-fast"];
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [universe, setUniverseField] = useState(activeUniverse);
  const [model, setModel] = useState<string>(models[0]!);
  const [tools, setTools] = useState<string[]>(DEFAULT_TOOLS);

  // Tools come from the universe's terminals, grouped by terminal, so it's
  // obvious where each capability lives. New universes get the base set.
  const terminals = terminalsIn(world, universe.trim() || null);
  const groups = terminals.length
    ? terminals.map((t) => ({ label: t.name, tools: t.tools }))
    : [{ label: "Default terminals", tools: BASE_TOOLS }];
  const [budgetKind, setBudgetKind] = useState<"tokens" | "usd">("tokens");
  const [budgetValue, setBudgetValue] = useState("25000");
  const [approvalRequired, setApprovalRequired] = useState(true);

  const toggleTool = (t: string) =>
    setTools((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const deploy = () => {
    const value = Number(budgetValue);
    const spec: AgentSpec = {
      name: name.trim() || "Agent",
      goal: goal.trim() || "do something useful",
      model,
      allowedTools: tools,
      budget:
        Number.isFinite(value) && value > 0
          ? budgetKind === "tokens"
            ? { maxTokens: value }
            : { maxUsd: value }
          : {},
      approvalRequired,
      universe: universe.trim() || "Personal",
    };
    sendCommand({ kind: "spawn", spec });
    // If a different universe is filtered in, follow the new agent.
    if (activeUniverse !== spec.universe) setUniverse(spec.universe === "Personal" ? "Personal" : "Business");
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New agent</h2>

        <label className="field">
          <span>Name</span>
          <input value={name} autoFocus placeholder="e.g. Sweep" onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="field">
          <span>Goal</span>
          <textarea
            value={goal}
            rows={2}
            placeholder="What should this agent do?"
            onChange={(e) => setGoal(e.target.value)}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Universe</span>
            <div className="segmented">
              {universes.map((u) => (
                <button key={u} type="button" className={universe === u ? "seg on" : "seg"} onClick={() => setUniverseField(u)}>
                  {u}
                </button>
              ))}
            </div>
          </label>
          <label className="field">
            <span>Model</span>
            <div className="segmented">
              {models.map((m) => (
                <button key={m} type="button" className={model === m ? "seg on" : "seg"} onClick={() => setModel(m)}>
                  {m.replace(/^claude-/, "")}
                </button>
              ))}
            </div>
            {mode === "live" && (
              <span className="field-note">Live: runs on the Anthropic API and spends real money. Shell and delete need your approval unless you turn that off below.</span>
            )}
          </label>
        </div>

        <div className="field">
          <span>Allowed tools (by terminal)</span>
          {groups.map((g) => (
            <div key={g.label} className="tool-group">
              <span className="tool-group-name">{g.label}</span>
              <div className="tool-grid">
                {g.tools.map((t) => (
                  <label key={t} className="check">
                    <input type="checkbox" checked={tools.includes(t)} onChange={() => toggleTool(t)} />
                    <code>{t}</code>
                  </label>
                ))}
                {g.tools.length === 0 && <span className="placeholder">no tools listed</span>}
              </div>
            </div>
          ))}
        </div>

        <div className="field-row">
          <label className="field">
            <span>Max budget</span>
            <div className="budget-row">
              <input
                value={budgetValue}
                inputMode="numeric"
                onChange={(e) => setBudgetValue(e.target.value.replace(/[^\d.]/g, ""))}
              />
              <div className="segmented">
                {(["tokens", "usd"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={budgetKind === k ? "seg on" : "seg"}
                    onClick={() => setBudgetKind(k)}
                  >
                    {k === "usd" ? "$" : "tokens"}
                  </button>
                ))}
              </div>
            </div>
          </label>
          <label className="check approval-default">
            <input
              type="checkbox"
              checked={approvalRequired}
              onChange={(e) => setApprovalRequired(e.target.checked)}
            />
            <span>Require approval for shell commands &amp; deletions</span>
          </label>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={deploy}>
            Deploy agent
          </button>
        </div>
      </div>
    </div>
  );
}
