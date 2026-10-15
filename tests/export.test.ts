import { describe, expect, it } from 'vitest';
import { toMarkdown, toMermaid } from '../shared/export';
import { board, person } from './helpers';

describe('Mermaid 导出', () => {
  it('将特殊人物 ID 转为安全标识，并转义姓名、身份、组织及关系标签中的引号和换行', () => {
    const data = board([
      person('人"物-1[]', { name: '张"三\n律师', title: '资深"顾问', org: '甲"公司' }),
      person('other/id:2'),
    ]);
    data.relations = [
      { id: 'r1', source: data.people[0].id, target: data.people[1].id, label: '一起"合作\n过', strength: 3 },
    ];

    const result = toMermaid(data);
    const lines = result.split('\n');
    const ids = lines.slice(1, 3).map((line) => line.trim().split('[')[0]);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(id).toMatch(/^p_[a-zA-Z0-9_]+$/);
    expect(result).toContain('["张#quot;三 律师<br/>资深#quot;顾问 @ 甲#quot;公司"]');
    expect(lines[3]).toBe(`  ${ids[0]} -- "一起#quot;合作 过" --- ${ids[1]}`);
    expect(result).not.toContain(data.people[0].id);
  });

  it.each([3, 4, 5])('强度 %i 使用合法的普通或加粗无向连线，兼容空标签', (strength) => {
    const data = board([person('a'), person('b')]);
    data.relations = [
      { id: 'named', source: 'a', target: 'b', label: '同事', strength },
      { id: 'empty', source: 'b', target: 'a', label: '', strength },
    ];

    const connector = strength >= 4 ? '==' : '--';
    const edge = strength >= 4 ? '===' : '---';
    expect(toMermaid(data).split('\n').slice(-2)).toEqual([
      `  p_a ${connector} "同事" ${edge} p_b`,
      `  p_b ${edge} p_a`,
    ]);
  });
});

describe('Markdown 导出', () => {
  it('包含 Mermaid 代码块和人物表，并按亲密度降序排列人物表及详情', () => {
    const data = board([
      person('low', { name: '普通朋友', closeness: 1 }),
      person('high', { name: '亲密朋友', closeness: 5 }),
      person('middle', { name: '熟悉朋友', closeness: 3 }),
    ]);
    const originalIds = data.people.map((p) => p.id);
    const result = toMarkdown(data);

    expect(result).toContain('```mermaid\n' + toMermaid(data) + '\n```');
    expect(result).toContain('| 姓名 | 身份 | 领域 | 性格 | 优势 / 能帮什么 | 亲密度 |');
    expect(result.match(/^\| (?:亲密朋友|熟悉朋友|普通朋友).*$/gm)?.map((row) => row.split(' | ')[0])).toEqual([
      '| 亲密朋友', '| 熟悉朋友', '| 普通朋友',
    ]);
    expect(result.match(/^### .+$/gm)).toEqual(['### 亲密朋友', '### 熟悉朋友', '### 普通朋友']);
    expect(result).toContain('★★★★★');
    expect(result).toContain('★☆☆☆☆');
    expect(data.people.map((p) => p.id)).toEqual(originalIds);
  });

  it('转义所有表格文本列里的竖线，并把换行转换成 br', () => {
    const data = board([person('a', {
      name: '张|三', title: '律师|顾问', org: '甲|乙', tags: ['法|律'],
      traits: ['可|靠'], strengths: '诉讼|咨询\n合同',
    })]);
    expect(toMarkdown(data)).toContain(
      '| 张\\|三 | 律师\\|顾问 @ 甲\\|乙 | 法\\|律 | 可\\|靠 | 诉讼\\|咨询<br>合同 | ★★★☆☆ |',
    );
  });
});
