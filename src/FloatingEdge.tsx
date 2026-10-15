import {
  BaseEdge, EdgeLabelRenderer, useInternalNode,
  type ConnectionLineComponentProps, type EdgeProps, type InternalNode,
} from '@xyflow/react';
import { avatarSize, type PersonNodeData } from './PersonNode';

type EdgeData = { label?: string; strength?: number; dim?: boolean };

// 头像（圆）在画布上的圆心与半径
function circle(node: InternalNode) {
  const size = avatarSize((node.data as PersonNodeData).closeness);
  return {
    x: node.internals.positionAbsolute.x + (node.measured.width ?? 140) / 2,
    y: node.internals.positionAbsolute.y + size / 2,
    r: size / 2,
  };
}

// 略带弧度的二次贝塞尔：返回路径和曲线中点（标签位置）
function curve(sx: number, sy: number, tx: number, ty: number, bendSign: number) {
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const bend = Math.min(36, dist * 0.1) * bendSign;
  const cx = (sx + tx) / 2 - uy * bend;
  const cy = (sy + ty) / 2 + ux * bend;
  return {
    path: `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`,
    lx: (sx + 2 * cx + tx) / 4,
    ly: (sy + 2 * cy + ty) / 4,
  };
}

// floating edge：沿两圆心连线，从各自圆的边缘出发，节点移到哪个方向线就跟到哪个方向
export function FloatingEdge({ id, source, target, data: raw }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;
  const data = (raw ?? {}) as EdgeData;
  const s = circle(sourceNode);
  const t = circle(targetNode);
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const gap = 6; // 与圆边留一点空隙
  const { path, lx, ly } = curve(
    s.x + ux * (s.r + gap), s.y + uy * (s.r + gap),
    t.x - ux * (t.r + gap), t.y - uy * (t.r + gap),
    id.charCodeAt(0) % 2 ? 1 : -1,
  );
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={data.dim ? 'dim' : undefined}
        style={{ strokeWidth: 1 + (data.strength ?? 3) * 0.7 }}
      />
      {data.label && (
        <EdgeLabelRenderer>
          {/* 胶囊本身不接收点击，点击穿透到下方的线选中关系 */}
          <div
            className={`edge-label nodrag nopan${data.dim ? ' dim' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

// 连线预览：同样从圆边出发的曲线
export function FloatingConnectionLine({ fromX, fromY, toX, toY, fromNode }: ConnectionLineComponentProps) {
  let sx = fromX;
  let sy = fromY;
  if (fromNode) {
    const c = circle(fromNode);
    const dx = toX - c.x;
    const dy = toY - c.y;
    const dist = Math.hypot(dx, dy) || 1;
    sx = c.x + (dx / dist) * (c.r + 6);
    sy = c.y + (dy / dist) * (c.r + 6);
  }
  const { path } = curve(sx, sy, toX, toY, 1);
  return (
    <g>
      <path className="react-flow__connection-path floating-preview" d={path} fill="none" />
      <circle className="floating-preview-dot" cx={toX} cy={toY} r={4} />
    </g>
  );
}
