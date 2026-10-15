import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import type { Board, Person, Relation } from '../shared/types';
import { toMarkdown, toMermaid } from '../shared/export';
import { loadBoard, saveBoard, loadSettings, saveSettings } from './store';
import { backupAndRecord } from './webdav';

// 外部导入只要求标识和姓名，其余字段校验后再补齐。
type BoardInput = {
  people: (Pick<Person, 'id' | 'name'> & Partial<Person>)[];
  relations: (Pick<Relation, 'id' | 'source' | 'target'> & Partial<Relation>)[];
  updatedAt?: string;
};

// 简单的结构校验，防止前端或导入写入脏数据
function validateBoard(b: any): b is BoardInput {
  const optionalString = (value: unknown) => value === undefined || typeof value === 'string';
  const optionalStrings = (value: unknown) =>
    value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
  const optionalNumber = (value: unknown) => value === undefined || (typeof value === 'number' && Number.isFinite(value));
  const optionalRating = (value: unknown) =>
    value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5);
  return (
    b &&
    Array.isArray(b.people) &&
    Array.isArray(b.relations) &&
    optionalString(b.updatedAt) &&
    b.people.every((p: any) =>
      typeof p?.id === 'string' && typeof p?.name === 'string' &&
      optionalStrings(p.tags) && optionalStrings(p.traits) &&
      ['title', 'org', 'strengths', 'contact', 'notes', 'updatedAt'].every((key) => optionalString(p[key])) &&
      optionalRating(p.closeness) && optionalNumber(p.x) && optionalNumber(p.y),
    ) &&
    b.relations.every(
      (r: any) => typeof r?.id === 'string' && typeof r?.source === 'string' && typeof r?.target === 'string' &&
        optionalString(r.label) && optionalString(r.notes) && optionalRating(r.strength),
    )
  );
}

// 补齐缺省字段，兼容外部导入的不完整 JSON
function normalize(b: BoardInput): Board {
  return {
    version: 1,
    updatedAt: b.updatedAt ?? new Date().toISOString(),
    people: b.people.map((p) => ({
      tags: [],
      traits: [],
      strengths: '',
      closeness: 3,
      x: 0,
      y: 0,
      updatedAt: new Date().toISOString(),
      ...p,
    })),
    relations: b.relations.map((r) => ({ label: '', strength: 3, ...r })),
  };
}

// 外部 agent 接口的 Bearer Token 校验（常量时间比较）
async function requireToken(req: Request, res: Response, next: NextFunction) {
  const { apiToken } = await loadSettings();
  const got = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || String(req.query.token ?? '');
  const a = Buffer.from(got);
  const b = Buffer.from(apiToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

// 按关键词给人物打分：命中领域/优势/性格/身份越多越靠前，亲密度作为加权
export function searchPeople(board: Board, q: string) {
  const words = q.toLowerCase().split(/[\s,，、]+/).filter(Boolean);
  const score = (p: Person) => {
    const fields: [string, number][] = [
      [p.tags.join(' '), 3],
      [p.strengths, 3],
      [p.traits.join(' '), 2],
      [`${p.title ?? ''} ${p.org ?? ''}`, 2],
      [`${p.name} ${p.notes ?? ''}`, 1],
    ];
    let s = 0;
    for (const w of words) for (const [text, wt] of fields) if (text.toLowerCase().includes(w)) s += wt;
    return s === 0 ? 0 : s + p.closeness * 0.5;
  };
  return board.people
    .map((p) => ({ person: p, score: score(p) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

const AGENT_DOC = `# Link Board Agent API

所有接口需要 Header: Authorization: Bearer <token>（在网页「设置」里查看）。只读。

- GET /api/agent/board            完整数据 JSON（people, relations）
- GET /api/agent/people           人物列表
- GET /api/agent/people/:id       单个人物 + 其所有关系
- GET /api/agent/search?q=法律 投资  按需求关键词找人，返回 score 排序
- GET /api/agent/export.md        Markdown（含 Mermaid 关系图）
- GET /api/agent/export.mmd       纯 Mermaid

Person 字段：id, name, title, org, tags(领域), traits(性格), strengths(优势/能帮什么), closeness(1-5 亲密度), contact, notes
Relation 字段：id, source, target, label, strength(1-5), notes
`;

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // ---------- 网页端（仅本机访问，见 index.ts 的监听地址） ----------
  app.get('/api/board', async (_req, res) => {
    res.json(await loadBoard());
  });

  app.put('/api/board', async (req, res) => {
    if (!validateBoard(req.body)) {
      res.status(400).json({ error: '数据格式不正确' });
      return;
    }
    res.json(await saveBoard(normalize(req.body)));
  });

  app.get('/api/export.json', async (_req, res) => {
    res.attachment('link-board.json').json(await loadBoard());
  });
  app.get('/api/export.md', async (_req, res) => {
    res.attachment('link-board.md').type('text/markdown').send(toMarkdown(await loadBoard()));
  });

  // 设置：密码不回传给前端，只告诉是否已设置
  app.get('/api/settings', async (_req, res) => {
    const s = await loadSettings();
    res.json({ ...s, webdav: { ...s.webdav, password: '', hasPassword: !!s.webdav.password } });
  });

  app.put('/api/settings/webdav', async (req, res) => {
    const s = await loadSettings();
    const w = req.body ?? {};
    s.webdav = {
      ...s.webdav,
      enabled: !!w.enabled,
      url: String(w.url ?? ''),
      username: String(w.username ?? ''),
      // 留空表示保持原密码
      password: w.password ? String(w.password) : s.webdav.password,
      intervalMinutes: Math.max(5, Number(w.intervalMinutes) || 1440),
      keep: Math.max(0, Number(w.keep) || 0),
    };
    if (s.webdav.url && !/^https?:\/\//i.test(s.webdav.url)) {
      res.status(400).json({ error: 'WebDAV 地址需以 http(s):// 开头' });
      return;
    }
    await saveSettings(s);
    res.json({ ok: true });
  });

  app.post('/api/settings/token/rotate', async (_req, res) => {
    const s = await loadSettings();
    s.apiToken = crypto.randomBytes(24).toString('hex');
    await saveSettings(s);
    res.json({ apiToken: s.apiToken });
  });

  app.post('/api/backup', async (_req, res) => {
    const r = await backupAndRecord();
    res.status(r.ok ? 200 : 502).json(r);
  });

  // ---------- 外部 agent 只读接口 ----------
  app.get('/api/agent', (_req, res) => {
    res.type('text/markdown').send(AGENT_DOC);
  });
  const agent = express.Router();
  agent.use(requireToken);
  agent.get('/board', async (_req, res) => {
    res.json(await loadBoard());
  });
  agent.get('/people', async (_req, res) => {
    res.json((await loadBoard()).people);
  });
  agent.get('/people/:id', async (req, res) => {
    const b = await loadBoard();
    const p = b.people.find((x) => x.id === req.params.id);
    if (!p) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const relations = b.relations
      .filter((r) => r.source === p.id || r.target === p.id)
      .map((r) => {
        const otherId = r.source === p.id ? r.target : r.source;
        return { ...r, other: b.people.find((x) => x.id === otherId)?.name };
      });
    res.json({ ...p, relations });
  });
  agent.get('/search', async (req, res) => {
    res.json(searchPeople(await loadBoard(), String(req.query.q ?? '')));
  });
  agent.get('/export.md', async (_req, res) => {
    res.type('text/markdown').send(toMarkdown(await loadBoard()));
  });
  agent.get('/export.mmd', async (_req, res) => {
    res.type('text/plain').send(toMermaid(await loadBoard()));
  });
  app.use('/api/agent', agent);

  // 生产模式下托管前端
  const dist = process.env.STATIC_DIR ?? path.resolve('dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  return app;
}
