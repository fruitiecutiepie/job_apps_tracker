import type { ReactNode } from "react";

import { STATE_IDS, stateLabel } from "../domain";
import type { StateId } from "../domain";
import { ChartKey } from "./ChartKey";
import type { ChartTone } from "./ChartKey";
import { stageMoveKind } from "./outcomes";
import type { StageMove, StageMoveKind } from "./outcomes";

/*
 * Vertical sizes are fixed pixels, so the plot's height is known without measuring
 * anything; only its width follows the column. One move is `UNIT` high, and a node is never
 * shorter than the line of text naming it, so a stage one application left still has
 * room for its label.
 */
const UNIT = 6;
const LABEL = 18;
const GAP = 6;

const STATE_ORDER = new Map<StateId, number>(STATE_IDS.map((id, index) => [id, index]));

const TONE: Record<StageMoveKind, ChartTone> = {
  further: "strong",
  other: "mid",
  rejected: "rest",
};

const KEY = [
  { label: "To a later stage", mark: "strong" },
  { label: "Anywhere else", mark: "mid" },
  { label: "To a rejection", mark: "rest" },
] as const;

interface Node {
  state: StateId;
  count: number;
  top: number;
  /** Where the next link attaches, walking down the node. */
  cursor: number;
}

/** One column of nodes, in the order the moves list them, and the height it takes. */
function column(moves: StageMove[], end: "from" | "to"): { nodes: Map<StateId, Node>; height: number } {
  const counts = new Map<StateId, number>();
  for (const move of moves) counts.set(move[end], (counts.get(move[end]) ?? 0) + move.count);

  const nodes = new Map<StateId, Node>();
  let top = 0;
  for (const [state, count] of counts) {
    nodes.set(state, { state, count, top, cursor: top });
    top += Math.max(count * UNIT, LABEL) + GAP;
  }
  return { nodes, height: Math.max(0, top - GAP) };
}

interface StageFlowProps {
  /** Ordered by where each move left, then where it landed, as `stageMoves` returns them. */
  moves: StageMove[];
  /** The table the diagram is drawn from, which is what a screen reader reads instead. */
  children: ReactNode;
}

/**
 * Where applications went from each stage: every stage something left on one side, every
 * state something arrived in on the other, and a band between them as wide as the moves.
 *
 * Two columns rather than one per stage, because any state may move to any other: a flow
 * laid out stage after stage has no place to draw a move backwards, and this one draws it
 * the same way as any other. The bands are paths in a stretched viewBox — horizontal
 * scaling bends them without changing how thick they are, which is the part that encodes.
 */
export function StageFlow({ moves, children }: StageFlowProps) {
  const left = column(moves, "from");
  // The arrivals in configured order too, and inside each one in the order of the stage
  // the band left, so bands meeting at one node do not cross on the way in.
  const arriving = [...moves].sort(
    (a, b) =>
      STATE_ORDER.get(a.to)! - STATE_ORDER.get(b.to)! ||
      STATE_ORDER.get(a.from)! - STATE_ORDER.get(b.from)!,
  );
  const right = column(arriving, "to");
  const height = Math.max(left.height, right.height);

  const bands = new Map<StageMove, { y0: number; y1: number }>();
  for (const move of moves) {
    const node = left.nodes.get(move.from)!;
    bands.set(move, { y0: node.cursor, y1: 0 });
    node.cursor += move.count * UNIT;
  }
  for (const move of arriving) {
    const node = right.nodes.get(move.to)!;
    bands.get(move)!.y1 = node.cursor;
    node.cursor += move.count * UNIT;
  }

  return (
    <div className="stage-flow">
      <div className="stage-flow__chart" aria-hidden="true">
        <ChartKey caption="Every recorded move · band width: how many" items={[...KEY]} />
        <div className="stage-flow__plot" style={{ height }}>
          <div className="stage-flow__side stage-flow__side--from">
            {[...left.nodes.values()].map((node) => (
              <NodeLabel key={node.state} node={node} />
            ))}
          </div>
          <svg
            className="stage-flow__links"
            preserveAspectRatio="none"
            viewBox={`0 0 100 ${Math.max(height, 1)}`}
          >
            {moves.map((move) => {
              const { y0, y1 } = bands.get(move)!;
              const h = move.count * UNIT;
              return (
                <path
                  className={`stage-flow__link stage-flow__link--${TONE[stageMoveKind(move)]}`}
                  d={`M0 ${y0} C50 ${y0} 50 ${y1} 100 ${y1} L100 ${y1 + h} C50 ${y1 + h} 50 ${y0 + h} 0 ${y0 + h} Z`}
                  data-move={`${move.from}>${move.to}`}
                  key={`${move.from}>${move.to}`}
                >
                  <title>{`${stateLabel(move.from)} → ${stateLabel(move.to)}: ${move.count}`}</title>
                </path>
              );
            })}
          </svg>
          <div className="stage-flow__side stage-flow__side--to">
            {[...right.nodes.values()].map((node) => (
              <NodeLabel key={node.state} node={node} />
            ))}
          </div>
        </div>
      </div>
      <div className="sr-only">{children}</div>
    </div>
  );
}

function NodeLabel({ node }: { node: Node }) {
  const label = stateLabel(node.state);
  return (
    <div className="stage-flow__node" style={{ top: node.top }}>
      <span className="stage-flow__bar" style={{ height: node.count * UNIT }} />
      <span className="stage-flow__name" title={label}>
        {label}
      </span>
      <span className="stage-flow__count">{node.count}</span>
    </div>
  );
}
