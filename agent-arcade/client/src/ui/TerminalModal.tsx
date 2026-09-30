import { useState } from "react";
import type { TerminalKind } from "../../../shared/src";
import { TERMINAL_KINDS } from "../../../shared/src";
import { sendCommand, setUniverse } from "../store";

export const KIND_LABELS: Record<TerminalKind, string> = {
  shell: "Shell / code",
  research: "Research",
  files: "Files",
  image: "Image generation",
  model3d: "3D models",
  store: "Storefront",
  marketing: "Marketing",
  data: "Data / analytics",
  chat: "Messaging / CRM",
  custom: "Custom",
};

const splitList = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

export function TerminalModal({
  universes,
  activeUniverse,
  onClose,
}: {
  universes: string[];
  activeUniverse: string | null;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [universe, setUniverseField] = useState(activeUniverse ?? universes[0] ?? "Personal");
  const [kind, setKind] = useState<TerminalKind>("custom");
  const [tools, setTools] = useState("");
  const [requires, setRequires] = useState("");

  const add = () => {
    const u = universe.trim() || "Personal";
    sendCommand({
      kind: "add_terminal",
      terminal: {
        universe: u,
        name: name.trim() || "New terminal",
        description: description.trim(),
        kind,
        tools: splitList(tools),
        requires: splitList(requires),
      },
    });
    if (activeUniverse !== null && activeUniverse !== u) setUniverse(u);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New terminal</h2>
        <p className="modal-hint">
          A terminal is a place in a universe where agents go to do one kind of work. Describe what it's for and
          which tools it provides; agents then route matching tool calls there.
        </p>

        <div className="field-row">
          <label className="field">
            <span>Name</span>
            <input value={name} autoFocus placeholder="e.g. Higgsfield Studio" onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Universe</span>
            <input value={universe} list="terminal-universe-options" onChange={(e) => setUniverseField(e.target.value)} />
            <datalist id="terminal-universe-options">
              {universes.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </label>
        </div>

        <label className="field">
          <span>What it's used for</span>
          <textarea
            value={description}
            rows={2}
            placeholder="e.g. Generate product images and marketing visuals"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className="field">
          <span>Kind</span>
          <div className="kind-grid">
            {TERMINAL_KINDS.map((k) => (
              <button key={k} type="button" className={kind === k ? "kind on" : "kind"} onClick={() => setKind(k)}>
                <span className={`kind-swatch kind-${k}`} />
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>Tools it provides (comma-separated)</span>
          <input
            value={tools}
            placeholder="e.g. higgsfield.generate_image, higgsfield.upscale"
            onChange={(e) => setTools(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Requires — skills, connectors or plugins (comma-separated)</span>
          <input value={requires} placeholder="e.g. Higgsfield API key" onChange={(e) => setRequires(e.target.value)} />
        </label>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={add} disabled={!name.trim()}>
            Add terminal
          </button>
        </div>
      </div>
    </div>
  );
}
