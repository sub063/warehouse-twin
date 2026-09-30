import { useEffect } from "react";
import type { WorldState } from "../../../shared/src";
import { closeFile } from "../store";

export function FileViewer({ viewer, world }: { viewer: NonNullable<import("../store").UiState["viewer"]>; world: WorldState }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeFile();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const agent = world.agents[viewer.agentId];
  return (
    <div className="modal-backdrop" onClick={closeFile}>
      <div className="modal viewer" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-head">
          <div>
            <h2>{viewer.path}</h2>
            <p className="muted small">
              {agent ? `${agent.spec.name}${agent.spec.role ? ` · ${agent.spec.role}` : ""} · ` : ""}
              {viewer.agentId}
            </p>
          </div>
          <button className="btn" onClick={closeFile}>
            Close
          </button>
        </div>
        {viewer.error ? (
          <p className="placeholder">Couldn't open it: {viewer.error}</p>
        ) : viewer.content === undefined ? (
          <p className="placeholder">Loading…</p>
        ) : (
          <pre className="file-body">{viewer.content}</pre>
        )}
        {viewer.truncated && <p className="muted small">Showing the first 200 KB.</p>}
      </div>
    </div>
  );
}
