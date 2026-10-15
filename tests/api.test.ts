import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../shared/types';
import { board, closeServer, person, serverUrl } from './helpers';

describe('HTTP API', () => {
  let dataDir: string;
  let server: Server | undefined;
  let base: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'link-board-api-'));
    // 存储目录在模块加载时确定，必须先设置环境变量再动态导入。
    vi.stubEnv('DATA_DIR', dataDir);
    vi.resetModules();
    const { createApp } = await import('../server/app');
    server = createApp().listen(0, '127.0.0.1');
    base = await serverUrl(server);
  });

  afterEach(async () => {
    await closeServer(server);
    await rm(dataDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  const request = (route: string, method = 'GET', body?: unknown, token?: string) => fetch(base + route, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  async function settings(): Promise<Settings & { webdav: { hasPassword: boolean } }> {
    const response = await request('/api/settings');
    expect(response.status).toBe(200);
    return response.json();
  }

  it('PUT/GET 完整往返并写入当前测试的存储目录', async () => {
    expect(await (await request('/api/board')).json()).toMatchObject({ version: 1, people: [], relations: [] });
    const data = board([person('a', { name: '张律师', tags: ['法律'] }), person('b')]);
    data.relations = [{ id: 'r', source: 'a', target: 'b', label: '同事', strength: 4 }];
    const response = await request('/api/board', 'PUT', data);
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved).toMatchObject({ version: 1, people: data.people, relations: data.relations });
    expect(Number.isNaN(Date.parse(saved.updatedAt))).toBe(false);
    expect(await (await request('/api/board')).json()).toEqual(saved);
    expect(JSON.parse(await readFile(path.join(dataDir, 'board.json'), 'utf8'))).toEqual(saved);
  });

  it.each([
    ['空值', null],
    ['缺少人物列表', { relations: [] }],
    ['关系列表类型错误', { people: [], relations: {} }],
    ['人物 ID 类型错误', { people: [{ id: 1, name: '张三' }], relations: [] }],
    ['人物缺少姓名', { people: [{ id: 'a' }], relations: [] }],
    ['关系缺少端点', { people: [], relations: [{ id: 'r', source: 'a' }] }],
    ['领域类型错误', board([person('a', { tags: '律师' as unknown as string[] })])],
    ['领域元素类型错误', board([person('a', { tags: [1] as unknown as string[] })])],
    ['性格为空值', board([person('a', { traits: null as unknown as string[] })])],
    ['优势类型错误', board([person('a', { strengths: 1 as unknown as string })])],
    ['亲密度越界', board([person('a', { closeness: 6 })])],
    ['亲密度不是整数', board([person('a', { closeness: 2.5 })])],
    ['坐标类型错误', board([person('a', { x: '0' as unknown as number })])],
    ['备注类型错误', board([person('a', { notes: [] as unknown as string })])],
    ['关系强度越界', { ...board(), relations: [{ id: 'r', source: 'a', target: 'b', strength: 0 }] }],
    ['关系标签类型错误', { ...board(), relations: [{ id: 'r', source: 'a', target: 'b', label: 3 }] }],
  ])('拒绝非法数据：%s，且不覆盖原数据', async (_name, invalid) => {
    const data = board([person('original')]);
    const saved = await (await request('/api/board', 'PUT', data)).json();
    const response = await request('/api/board', 'PUT', invalid);
    expect(response.status).toBe(400);
    expect(await (await request('/api/board')).json()).toEqual(saved);
  });

  it('补齐人物和关系的缺省字段', async () => {
    const response = await request('/api/board', 'PUT', {
      people: [{ id: 'a', name: '张三' }, { id: 'b', name: '李四' }],
      relations: [{ id: 'r', source: 'a', target: 'b' }],
    });
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved).toEqual({
      version: 1, updatedAt: expect.any(String),
      people: ['a', 'b'].map((id, index) => ({
        id, name: ['张三', '李四'][index], tags: [], traits: [], strengths: '',
        closeness: 3, x: 0, y: 0, updatedAt: expect.any(String),
      })),
      relations: [{ id: 'r', source: 'a', target: 'b', label: '', strength: 3 }],
    });
    expect(await (await request('/api/board')).json()).toEqual(saved);
  });

  it.each([
    ['未提供', undefined, 401], ['错误', 'wrong-token', 401], ['等长错误', '0'.repeat(48), 401], ['正确', 'valid', 200],
  ])('Bearer token：%s', async (_name, token, status) => {
    const { apiToken } = await settings();
    const response = await request('/api/agent/board', 'GET', undefined, token === 'valid' ? apiToken : token);
    expect(response.status).toBe(status);
    if (status === 200) expect(await response.json()).toMatchObject({ people: [], relations: [] });
    else expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('接受 token 查询参数', async () => {
    const { apiToken } = await settings();
    expect((await request(`/api/agent/board?token=${apiToken}`)).status).toBe(200);
    expect((await request('/api/agent/board?token=wrong')).status).toBe(401);
  });

  it('搜索优先排列领域和优势命中，并以亲密度排序同权重人物', async () => {
    const data = board([
      person('notes', { notes: '认识律师', closeness: 3 }),
      person('tags', { tags: ['律师'], closeness: 3 }),
      person('strengths', { strengths: '律师服务', closeness: 3 }),
      person('close-tags', { tags: ['律师'], closeness: 5 }),
      person('unmatched', { closeness: 5 }),
    ]);
    expect((await request('/api/board', 'PUT', data)).status).toBe(200);
    const { apiToken } = await settings();
    const response = await request('/api/agent/search?q=' + encodeURIComponent('律师'), 'GET', undefined, apiToken);
    expect(response.status).toBe(200);
    const results = await response.json();
    expect(results.map((r: { person: { id: string } }) => r.person.id)).toEqual(['close-tags', 'tags', 'strengths', 'notes']);
    expect(results.map((r: { score: number }) => r.score)).toEqual([5.5, 4.5, 4.5, 2.5]);
  });

  it('人物详情返回所有双向关系及对端姓名，不混入无关关系', async () => {
    const data = board([person('a', { name: '张三' }), person('b', { name: '李四' }), person('c', { name: '王五' })]);
    data.relations = [
      { id: 'out', source: 'a', target: 'b', label: '同事', strength: 4 },
      { id: 'in', source: 'c', target: 'a', label: '同学', strength: 3 },
      { id: 'unrelated', source: 'b', target: 'c', label: '', strength: 1 },
    ];
    expect((await request('/api/board', 'PUT', data)).status).toBe(200);
    const { apiToken } = await settings();
    const response = await request('/api/agent/people/a', 'GET', undefined, apiToken);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...data.people[0], relations: [
      { ...data.relations[0], other: '李四' }, { ...data.relations[1], other: '王五' },
    ] });
    expect((await request('/api/agent/people/missing', 'GET', undefined, apiToken)).status).toBe(404);
  });

  it('设置接口隐藏密码，留空更新时保留原密码', async () => {
    const config = { enabled: true, url: 'https://dav.example.com/backup/', username: '张三', password: '秘密密码', keep: 2, intervalMinutes: 10 };
    expect((await request('/api/settings/webdav', 'PUT', config)).status).toBe(200);
    expect((await settings()).webdav).toMatchObject({ ...config, password: '', hasPassword: true });
    expect((await request('/api/settings/webdav', 'PUT', { ...config, username: '李四', password: '' })).status).toBe(200);
    const stored: Settings = JSON.parse(await readFile(path.join(dataDir, 'settings.json'), 'utf8'));
    expect(stored.webdav.password).toBe(config.password);
    expect(stored.webdav.username).toBe('李四');
    const response = await request('/api/settings');
    expect(await response.text()).not.toContain(config.password);
  });

  it.each(['ftp://example.com', 'file:///tmp/backup', 'javascript:alert(1)', '//example.com'])('拒绝非 HTTP(S) 地址：%s', async (url) => {
    const original = await settings();
    const response = await request('/api/settings/webdav', 'PUT', { url, password: '不能保存' });
    expect(response.status).toBe(400);
    expect(await settings()).toEqual(original);
  });

  it.each(['http://example.com/backup', 'https://example.com/backup'])('接受 HTTP(S) 地址：%s', async (url) => {
    expect((await request('/api/settings/webdav', 'PUT', { url })).status).toBe(200);
    expect((await settings()).webdav.url).toBe(url);
  });

  it('轮换 token 后旧 token 失效，新 token 持久化并可使用', async () => {
    const oldToken = (await settings()).apiToken;
    expect((await request('/api/agent/board', 'GET', undefined, oldToken)).status).toBe(200);
    const response = await request('/api/settings/token/rotate', 'POST');
    expect(response.status).toBe(200);
    const { apiToken } = await response.json();
    expect(apiToken).toMatch(/^[a-f0-9]{48}$/);
    expect(apiToken).not.toBe(oldToken);
    expect((await settings()).apiToken).toBe(apiToken);
    expect((await request('/api/agent/board', 'GET', undefined, oldToken)).status).toBe(401);
    expect((await request('/api/agent/board', 'GET', undefined, apiToken)).status).toBe(200);
    expect((await request(`/api/agent/board?token=${oldToken}`)).status).toBe(401);
  });
});
