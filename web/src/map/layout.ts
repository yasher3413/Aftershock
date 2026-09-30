import { forceCollide, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";

export interface NodeInput {
  id: string;
  x: number;
  y: number;
}

export interface NodeOut {
  id: string;
  /** Displayed position after de-overlap. */
  x: number;
  y: number;
  /** True arena position. */
  x0: number;
  y0: number;
  displaced: boolean;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  x0: number;
  y0: number;
}

/**
 * Spread nodes that would overlap (the New York trio, Los Angeles and
 * Anaheim, the Florida pair) while pulling each back toward its arena.
 * Deterministic: same input, same output.
 */
export function layoutNodes(inputs: NodeInput[], radius: number, iterations = 300): NodeOut[] {
  const nodes: SimNode[] = inputs.map((n) => ({ id: n.id, x: n.x, y: n.y, x0: n.x, y0: n.y }));
  const sim = forceSimulation(nodes)
    .alphaDecay(0.02)
    .force("x", forceX<SimNode>((d) => d.x0).strength(0.08))
    .force("y", forceY<SimNode>((d) => d.y0).strength(0.08))
    .force("collide", forceCollide<SimNode>(radius).strength(1).iterations(3))
    .stop();
  for (let i = 0; i < iterations; i++) sim.tick();
  return nodes.map((n) => {
    const dx = (n.x ?? n.x0) - n.x0;
    const dy = (n.y ?? n.y0) - n.y0;
    return {
      id: n.id,
      x: n.x ?? n.x0,
      y: n.y ?? n.y0,
      x0: n.x0,
      y0: n.y0,
      displaced: Math.hypot(dx, dy) > radius * 0.35,
    };
  });
}
