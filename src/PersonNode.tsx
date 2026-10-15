import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { Person } from '../shared/types';

// Record 交叉：满足 @xyflow/react 12 对节点 data 的索引签名约束
export type PersonNodeData = Person & { dim: boolean; hit: boolean } & Record<string, unknown>;
export type PersonFlowNode = Node<PersonNodeData, 'person'>;

// 头像直径：随亲密度 1-5 在 48-72px 之间变化
export const avatarSize = (closeness: number) => 48 + (Math.min(5, Math.max(1, closeness)) - 1) * 6;

// 领域调色板：按标签哈希取色，明暗主题下对白字都有足够对比度
const PALETTE = [
  '#d84f68', '#e07b35', '#a07d10', '#3d9a50', '#0e9f8a',
  '#2f8fd6', '#6c63d9', '#9b59c9', '#c94f9d', '#6b8e23',
];

export function tagColor(tag: string | undefined) {
  if (!tag) return 'var(--avatar-neutral)';
  let h = 0;
  for (const ch of tag) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// 头像里的首字：中文取第一个字，英文取首字母大写
function initial(name: string) {
  const ch = name.trim().charAt(0);
  return /[a-z]/.test(ch) ? ch.toUpperCase() : ch || '？';
}

// 图谱中的人物：圆形头像 + 姓名 + 一行小字 + 领域小点
export function PersonNode({ data, selected }: NodeProps<PersonFlowNode>) {
  const cls = ['person-node', selected && 'selected', data.dim && 'dim', data.hit && 'hit'].filter(Boolean).join(' ');
  const style = {
    '--avatar': `${avatarSize(data.closeness)}px`,
    '--avatar-color': tagColor(data.tags[0]),
  } as CSSProperties;
  return (
    <div className={cls} style={style}>
      <div className="node-main">
        {/* source handle 是真正的环形区域：容器不吃指针，只有 SVG 环带响应，其余位置穿透到头像 */}
        <Handle type="source" className="ring-handle" position={Position.Right}>
          <svg className="ring-svg" aria-hidden="true">
            <circle className="ring-hit" cx="50%" cy="50%" />
            <circle className="ring-vis" cx="50%" cy="50%" />
          </svg>
        </Handle>
        <div className="avatar">{initial(data.name)}</div>
        {/* 隐藏的 target handle 盖在整个节点上，松手落在节点任意位置都能连上 */}
        <Handle type="target" className="drop-handle" position={Position.Top} />
        {data.strengths && (
          <div className="node-tip" role="tooltip">
            {data.strengths.length > 40 ? data.strengths.slice(0, 40) + '…' : data.strengths}
          </div>
        )}
      </div>
      <div className="node-name">{data.name || '未命名'}</div>
      {(data.title || data.org) && <div className="node-sub">{[data.title, data.org].filter(Boolean).join(' · ')}</div>}
      {data.tags.length > 0 && (
        <div className="node-tags">
          {data.tags.slice(0, 2).map((t) => (
            <span key={t} className="node-tag"><i style={{ background: tagColor(t) }} />{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}
