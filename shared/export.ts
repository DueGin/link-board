import type { Board, Person } from './types';

// Mermaid 节点 ID 只允许安全字符
const mid = (id: string) => 'p_' + id.replace(/[^a-zA-Z0-9_]/g, '_');
// Mermaid 标签里的引号需要转义
const esc = (s: string) => s.replace(/"/g, '#quot;').replace(/\n/g, ' ');
// Markdown 表格单元格转义
const cell = (s = '') => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');

export function toMermaid(board: Board): string {
  const lines = ['graph LR'];
  for (const p of board.people) {
    const sub = [p.title, p.org].filter(Boolean).join(' @ ');
    lines.push(`  ${mid(p.id)}["${esc(p.name)}${sub ? '<br/>' + esc(sub) : ''}"]`);
  }
  for (const r of board.relations) {
    const arrow = r.strength >= 4 ? '==' : '--';
    const edge = r.strength >= 4 ? '===' : '---';
    lines.push(
      r.label
        ? `  ${mid(r.source)} ${arrow} "${esc(r.label)}" ${edge} ${mid(r.target)}`
        : `  ${mid(r.source)} ${edge} ${mid(r.target)}`,
    );
  }
  return lines.join('\n');
}

export function toMarkdown(board: Board): string {
  const byId = new Map(board.people.map((p) => [p.id, p]));
  const name = (id: string) => byId.get(id)?.name ?? '(已删除)';
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

  const out: string[] = [
    '# 人脉关系板',
    '',
    `> 导出时间：${new Date().toISOString()}，共 ${board.people.length} 人、${board.relations.length} 条关系`,
    '',
    '## 关系图',
    '',
    '```mermaid',
    toMermaid(board),
    '```',
    '',
    '## 人物一览',
    '',
    '| 姓名 | 身份 | 领域 | 性格 | 优势 / 能帮什么 | 亲密度 |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const p of sortPeople(board.people)) {
    out.push(
      `| ${cell(p.name)} | ${cell([p.title, p.org].filter(Boolean).join(' @ '))} | ${cell(p.tags.join('、'))} | ${cell(p.traits.join('、'))} | ${cell(p.strengths)} | ${stars(p.closeness)} |`,
    );
  }
  out.push('', '## 人物详情', '');
  for (const p of sortPeople(board.people)) {
    out.push(`### ${p.name}`, '');
    if (p.title || p.org) out.push(`- 身份：${[p.title, p.org].filter(Boolean).join(' @ ')}`);
    if (p.tags.length) out.push(`- 领域：${p.tags.join('、')}`);
    if (p.traits.length) out.push(`- 性格：${p.traits.join('、')}`);
    if (p.strengths) out.push(`- 优势：${p.strengths}`);
    out.push(`- 亲密度：${stars(p.closeness)}`);
    if (p.contact) out.push(`- 联系方式：${p.contact}`);
    const rels = board.relations.filter((r) => r.source === p.id || r.target === p.id);
    if (rels.length) {
      out.push('- 关系：');
      for (const r of rels) {
        const other = r.source === p.id ? r.target : r.source;
        out.push(`  - ${name(other)}${r.label ? `（${r.label}）` : ''}`);
      }
    }
    if (p.notes) out.push('', p.notes);
    out.push('');
  }
  return out.join('\n');
}

const sortPeople = (ps: Person[]) => [...ps].sort((a, b) => b.closeness - a.closeness);
