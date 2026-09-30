import type { AgentView } from "../../../shared/src";
import { exitReplay, setReplay } from "../store";
import { fmtElapsed } from "./format";

const SPEEDS = [1, 4, 16];

export function ReplayBar({
  agent,
  replay,
}: {
  agent: AgentView | undefined;
  replay: { startTs: number; endTs: number; cursorTs: number; playing: boolean; speed: number };
}) {
  const total = Math.max(1, replay.endTs - replay.startTs);
  const at = replay.cursorTs - replay.startTs;
  return (
    <div className="replay-bar" role="region" aria-label="Replay">
      <span className="replay-tag">REPLAY</span>
      <span className="replay-name">{agent?.spec.name ?? "run"}</span>
      <button
        className="btn"
        onClick={() =>
          setReplay(
            replay.cursorTs >= replay.endTs ? { cursorTs: replay.startTs, playing: true } : { playing: !replay.playing },
          )
        }
      >
        {replay.playing ? "Pause" : replay.cursorTs >= replay.endTs ? "Restart" : "Play"}
      </button>
      <input
        className="replay-scrub"
        type="range"
        min={0}
        max={total}
        step={50}
        value={at}
        onChange={(e) => {
          // The slider snaps to 50 ms steps; the last step means "the end".
          const v = Number(e.target.value);
          setReplay({ cursorTs: v >= total - 50 ? replay.endTs : replay.startTs + v, playing: false });
        }}
        aria-label="Replay position"
      />
      <span className="replay-time">
        {fmtElapsed(at)} / {fmtElapsed(total)}
      </span>
      <div className="segmented">
        {SPEEDS.map((s) => (
          <button key={s} className={replay.speed === s ? "seg on" : "seg"} onClick={() => setReplay({ speed: s })}>
            {s}×
          </button>
        ))}
      </div>
      <button className="btn" onClick={exitReplay}>
        Exit replay
      </button>
    </div>
  );
}
