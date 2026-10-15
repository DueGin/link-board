import {
  forceCenter, forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation,
  type SimulationNodeDatum,
} from 'd3-force';
import type { Board } from '../shared/types';

// 节点的近似占据尺寸（头像 48-72 + 姓名 + 标签），用于不重叠间距
export const NODE_W = 140;
export const NODE_H = 120;

export type LayoutItem = { id: string; cx: number; cy: number; closeness: number; tag?: string };
type Centers = { id: string; x: number; y: number }; // 目标中心坐标

// d3 模拟节点：带坐标 + 是否被关系连着
type SimNode = SimulationNodeDatum & { id: string; closeness: number; linked: boolean };
type SimLink = { source: string | SimNode; target: string | SimNode; d: number };

// 力导向：有关系的人靠近（strength 越大越近），亲密度高者更靠中心，孤立者甩到外围
export function forceLayout(items: LayoutItem[], board: Board): Centers[] {
  const ids = new Set(items.map((p) => p.id));
  // 集合内实际存在的关系
  const links: SimLink[] = board.relations
    .filter((r) => ids.has(r.source) && ids.has(r.target))
    .map((r) => ({ source: r.source, target: r.target, d: Math.max(190, 370 - r.strength * 32) }));
  const linkedIds = new Set<string>();
  for (const l of links) {
    linkedIds.add(l.source as string);
    linkedIds.add(l.target as string);
  }
  const nodes: SimNode[] = items.map((p) => ({ id: p.id, closeness: p.closeness, linked: linkedIds.has(p.id), x: p.cx, y: p.cy }));
  const n = nodes.length;
  // 围绕当前中心摆放
  const cx = items.reduce((s, p) => s + p.cx, 0) / n;
  const cy = items.reduce((s, p) => s + p.cy, 0) / n;
  // 外围圈半径随人数增大
  const outerR = Math.max(340, Math.sqrt(n) * 130);
  const sim = forceSimulation<SimNode>(nodes)
    .force('link', forceLink<SimNode, SimLink>(links).id((p) => p.id).distance((l) => l.d).strength(1))
    .force('charge', forceManyBody().strength(-420))
    .force('collide', forceCollide(Math.hypot(NODE_W, NODE_H) / 2 + 8).iterations(2))
    .force('center', forceCenter(cx, cy).strength(0.12));
  // 孤立者挂在外围圈上；连着的人中亲密度高者向内聚拢
  if (nodes.some((p) => !p.linked)) {
    sim.force('radial-lonely', forceRadial<SimNode>(outerR, cx, cy).strength((p) => (p.linked ? 0 : 0.35)));
  }
  sim.force('radial-core', forceRadial<SimNode>(outerR * 0.55, cx, cy)
    .strength((p) => (p.linked ? (6 - p.closeness) * 0.05 : 0)));
  // 几百人规模下 300 次迭代通常 200ms 以内
  sim.stop();
  for (let i = 0; i < 300; i++) sim.tick();
  return nodes.map((p) => ({ id: p.id, x: p.x ?? 0, y: p.y ?? 0 }));
}

// 按第一个领域标签分组：每组围成一圈，组与组之间留出明显间距
export function groupLayout(items: LayoutItem[]): Centers[] {
  const groups = new Map<string, LayoutItem[]>();
  for (const p of items) {
    const key = p.tag ?? '未分类';
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  const entries = [...groups.entries()];
  const n = entries.length;
  const g = 170; // 组内成员网格间距（>= 节点宽 140，保证不重叠）
  const m = Math.max(...entries.map(([, list]) => list.length));
  const groupSpan = Math.ceil(Math.sqrt(m)) * g; // 组自身占位边长
  const ringR = n > 1 ? Math.max(400, (n * groupSpan) / Math.PI / 1.6) : 0; // 各组中心围成的大圈半径
  // 围绕当前中心摆开各组
  const cx = items.reduce((s, p) => s + p.cx, 0) / items.length;
  const cy = items.reduce((s, p) => s + p.cy, 0) / items.length;
  const out: Centers[] = [];
  entries.forEach(([, list], i) => {
    const ga = (i / n) * Math.PI * 2 - Math.PI / 2;
    const gx = cx + (n > 1 ? Math.cos(ga) * ringR : 0);
    const gy = cy + (n > 1 ? Math.sin(ga) * ringR : 0);
    // 组内成员按网格排开，保证不重叠
    const cols = Math.ceil(Math.sqrt(list.length));
    const rows = Math.ceil(list.length / cols);
    list.forEach((p, j) => {
      const row = Math.floor(j / cols);
      const col = j % cols;
      out.push({
        id: p.id,
        x: gx + (col - (cols - 1) / 2) * g,
        y: gy + (row - (rows - 1) / 2) * g,
      });
    });
  });
  return out;
}
