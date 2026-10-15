import { useEffect, useState } from 'react';
import type { Person, Relation } from '../shared/types';

const splitTags = (text: string) => [...new Set(text.split(/[,，、]+/).map((tag) => tag.trim()).filter(Boolean))];

type PersonPanelProps = {
  person: Person;
  people: Person[];
  relations: Relation[];
  onChange: (patch: Partial<Person>) => void;
  onSelectRelation: (id: string) => void;
  onDelete: () => void;
};

export function PersonPanel({ person, people, relations, onChange, onSelectRelation, onDelete }: PersonPanelProps) {
  const [tags, setTags] = useState(person.tags.join('、'));
  const [traits, setTraits] = useState(person.traits.join('、'));

  useEffect(() => {
    setTags(person.tags.join('、'));
    setTraits(person.traits.join('、'));
  }, [person.id]);

  const linked = relations.filter((r) => r.source === person.id || r.target === person.id);

  return (
    <div className="panel-content">
      <div className="panel-heading">
        <span className="eyebrow">人物档案</span>
        <h2>{person.name || '未命名人物'}</h2>
        <p>随手记录，让每一条线索都有来处。</p>
      </div>
      <div className="form-stack">
        <label htmlFor="person-name">姓名
          <input id="person-name" value={person.name} onChange={(e) => onChange({ name: e.target.value })} />
        </label>
        <div className="form-row">
          <label htmlFor="person-title">职位 / 身份
            <input id="person-title" value={person.title ?? ''} onChange={(e) => onChange({ title: e.target.value })} />
          </label>
          <label htmlFor="person-org">组织
            <input id="person-org" value={person.org ?? ''} onChange={(e) => onChange({ org: e.target.value })} />
          </label>
        </div>
        <label htmlFor="person-tags">领域标签
          <input id="person-tags" value={tags} placeholder="法律、投资、医疗" aria-describedby="tags-help"
            onChange={(e) => setTags(e.target.value)} onBlur={() => onChange({ tags: splitTags(tags) })} />
        </label>
        <p id="tags-help" className="field-help">用逗号或顿号分隔，离开输入框后保存。</p>
        <label htmlFor="person-traits">性格特点
          <input id="person-traits" value={traits} placeholder="靠谱、外向、细致" aria-describedby="tags-help"
            onChange={(e) => setTraits(e.target.value)} onBlur={() => onChange({ traits: splitTags(traits) })} />
        </label>
        <label htmlFor="person-strengths">优势 / 能帮什么
          <textarea id="person-strengths" rows={3} value={person.strengths} placeholder="擅长的事、能提供的资源…"
            onChange={(e) => onChange({ strengths: e.target.value })} />
        </label>
        <label htmlFor="person-closeness">亲密度 <output>{person.closeness} / 5</output>
          <input id="person-closeness" type="range" min="1" max="5" step="1" value={person.closeness}
            onChange={(e) => onChange({ closeness: Number(e.target.value) })} />
        </label>
        <div className="range-labels"><span>初识</span><span>熟悉</span><span>亲近</span></div>
        <label htmlFor="person-contact">联系方式
          <input id="person-contact" value={person.contact ?? ''} placeholder="电话、微信或邮箱"
            onChange={(e) => onChange({ contact: e.target.value })} />
        </label>
        <label htmlFor="person-notes">备注
          <textarea id="person-notes" rows={3} value={person.notes ?? ''} placeholder="认识的契机、最近一次联系…"
            onChange={(e) => onChange({ notes: e.target.value })} />
        </label>
      </div>
      <section className="panel-section" aria-labelledby="person-relations-title">
        <h3 id="person-relations-title">相关关系 <span className="count">{linked.length}</span></h3>
        {linked.length ? (
          <ul className="relation-list">
            {linked.map((relation) => {
              const other = people.find((p) => p.id === (relation.source === person.id ? relation.target : relation.source));
              return (
                <li key={relation.id}>
                  <button type="button" onClick={() => onSelectRelation(relation.id)}>
                    <span>{other?.name || '未命名人物'}</span><small>{relation.label || '未标注关系'} →</small>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : <p className="muted">悬停任意头像出现圆环，从环上拖向另一个人，即可建立关系。</p>}
      </section>
      <button type="button" className="danger delete-button" onClick={() => {
        if (window.confirm(`删除「${person.name || '未命名人物'}」及其所有关系？`)) onDelete();
      }}>删除人物及相关关系</button>
    </div>
  );
}

type RelationPanelProps = {
  relation: Relation;
  people: Person[];
  onChange: (patch: Partial<Relation>) => void;
  onDelete: () => void;
};

export function RelationPanel({ relation, people, onChange, onDelete }: RelationPanelProps) {
  const name = (id: string) => people.find((p) => p.id === id)?.name || '未命名人物';
  const presets = ['同事', '同学', '朋友', '亲戚', '合作过', '介绍人', '上下级'];

  return (
    <div className="panel-content">
      <div className="panel-heading">
        <span className="eyebrow">关系线索</span>
        <h2>他们如何相识</h2>
        <p>为这条关系补上一点背景。</p>
      </div>
      <div className="relation-endpoints">
        <strong>{name(relation.source)}</strong><span aria-label="关联至">↓</span><strong>{name(relation.target)}</strong>
      </div>
      <div className="form-stack">
        <label htmlFor="relation-label">关系名称
          <input id="relation-label" value={relation.label} placeholder="例如：大学同学"
            onChange={(e) => onChange({ label: e.target.value })} />
        </label>
        <div className="preset-list" role="group" aria-label="常用关系">
          {presets.map((label) => (
            <button key={label} type="button" className={relation.label === label ? 'active' : ''}
              aria-pressed={relation.label === label} onClick={() => onChange({ label })}>{label}</button>
          ))}
        </div>
        <label htmlFor="relation-strength">关系强度 <output>{relation.strength} / 5</output>
          <input id="relation-strength" type="range" min="1" max="5" step="1" value={relation.strength}
            onChange={(e) => onChange({ strength: Number(e.target.value) })} />
        </label>
        <div className="range-labels"><span>弱联系</span><span>强联系</span></div>
        <label htmlFor="relation-notes">备注
          <textarea id="relation-notes" rows={6} value={relation.notes ?? ''} placeholder="共同经历、合作项目或介绍经过…"
            onChange={(e) => onChange({ notes: e.target.value })} />
        </label>
      </div>
      <button type="button" className="danger delete-button" onClick={() => {
        if (window.confirm(`删除「${name(relation.source)}」与「${name(relation.target)}」之间的关系？`)) onDelete();
      }}>删除这条关系</button>
    </div>
  );
}
