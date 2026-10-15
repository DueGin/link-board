import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebdavConfig } from '../shared/types';
import { board, closeServer, person, serverUrl } from './helpers';

describe('WebDAV 备份', () => {
  let dataDir: string;
  let server: Server | undefined;
  let config: WebdavConfig;
  let files: Map<string, string>;
  let requests: { method: string; url: string; authorization?: string; depth?: string | string[]; status: number }[];
  let store: typeof import('../server/store');
  let webdav: typeof import('../server/webdav');
  const authorization = 'Basic ' + Buffer.from('backup-user:正确密码').toString('base64');

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'link-board-webdav-'));
    vi.stubEnv('DATA_DIR', dataDir);
    vi.resetModules();
    store = await import('../server/store');
    webdav = await import('../server/webdav');
    files = new Map();
    requests = [];
    let directoryExists = false;

    // 用真实 HTTP 服务验证方法、认证和 XML 目录解析，避免用 fetch 桩掩盖协议错误。
    server = createServer(async (req, res) => {
      const method = req.method ?? '';
      const url = req.url ?? '';
      const record = { method, url, authorization: req.headers.authorization, depth: req.headers.depth, status: 0 };
      requests.push(record);
      const finish = (status: number, body = '') => {
        record.status = status;
        res.writeHead(status);
        res.end(body);
      };
      if (req.headers.authorization !== authorization) {
        res.setHeader('WWW-Authenticate', 'Basic realm="backup"');
        finish(401);
        return;
      }
      const name = decodeURIComponent(url.slice('/backup/'.length));
      if (method === 'MKCOL') {
        finish(directoryExists ? 405 : 201);
        directoryExists = true;
      } else if (method === 'PUT') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        files.set(name, Buffer.concat(chunks).toString('utf8'));
        finish(201);
      } else if (method === 'PROPFIND') {
        res.setHeader('Content-Type', 'application/xml');
        const hrefs = ['/backup/', ...[...files.keys()].map((file) => '/backup/' + encodeURIComponent(file))];
        finish(207, '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">' + hrefs.map((href) =>
          `<d:response><d:href>${href}</d:href><d:propstat><d:prop/><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
        ).join('') + '</d:multistatus>');
      } else if (method === 'DELETE') {
        files.delete(name);
        finish(204);
      } else {
        finish(405);
      }
    }).listen(0, '127.0.0.1');
    config = {
      enabled: true, url: await serverUrl(server) + '/backup', username: 'backup-user',
      password: '正确密码', intervalMinutes: 5, keep: 2,
    };
  });

  afterEach(async () => {
    vi.useRealTimers();
    await closeServer(server);
    await rm(dataDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('上传带时间戳的 JSON，内容等于已持久化的 board，所有请求均携带 Basic Auth', async () => {
    const data = board([person('a', { name: '张律师', tags: ['法律'] }), person('b')]);
    data.relations = [{ id: 'r', source: 'a', target: 'b', label: '同事', strength: 4 }];
    const saved = await store.saveBoard(data);
    const name = await webdav.runBackup(config);

    expect(name).toMatch(/^link-board-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/);
    expect([...files.keys()]).toEqual([name]);
    expect(JSON.parse(files.get(name)!)).toEqual(saved);
    expect(requests.map((r) => [r.method, r.status])).toEqual([['MKCOL', 201], ['PUT', 201], ['PROPFIND', 207]]);
    expect(requests.every((r) => r.authorization === authorization)).toBe(true);
    expect(requests[1].url).toBe('/backup/' + name);
    expect(requests[2].depth).toBe('1');
  });

  it('keep=2 时仅保留最新两份备份，目录已存在返回 405 不影响上传，其他文件不被清理', async () => {
    // 只替换 Date，保留网络和定时器正常运行，并确保每份备份的时间戳不同。
    vi.useFakeTimers({ toFake: ['Date'] });
    files.set('readme.txt', '保留这个文件');
    files.set('other.json', '{}');
    const names: string[] = [];
    for (let index = 0; index < 4; index++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 15, 0, 0, 0, index)));
      await store.saveBoard(board([person(String(index))]));
      names.push(await webdav.runBackup(config));
    }

    expect([...files.keys()].filter((name) => name.startsWith('link-board-')).sort()).toEqual(names.slice(-2));
    expect(files.get('readme.txt')).toBe('保留这个文件');
    expect(files.get('other.json')).toBe('{}');
    expect(JSON.parse(files.get(names[3])!).people[0].id).toBe('3');
    expect(requests.filter((r) => r.method === 'MKCOL').map((r) => r.status)).toEqual([201, 405, 405, 405]);
    expect(requests.filter((r) => r.method === 'DELETE').map((r) => [r.url, r.status])).toEqual(
      names.slice(0, 2).map((name) => ['/backup/' + name, 204]),
    );
  });

  it('凭据错误时返回 ok:false，并持久化 lastError', async () => {
    const settings = await store.loadSettings();
    settings.webdav = { ...config, password: '错误密码' };
    await store.saveSettings(settings);

    const result = await webdav.backupAndRecord();
    expect(result).toEqual({ ok: false, error: expect.stringContaining('HTTP 401') });
    const recorded = await store.loadSettings();
    expect(recorded.webdav.lastError).toBe(result.error);
    expect(recorded.webdav.lastBackupAt).toBeUndefined();
    expect(files.size).toBe(0);
    expect(requests.map((r) => [r.method, r.status])).toEqual([['MKCOL', 401], ['PUT', 401]]);
  });

  it('备份成功时记录时间和文件名，并清除之前的错误', async () => {
    const settings = await store.loadSettings();
    settings.webdav = { ...config, lastError: '之前上传失败' };
    await store.saveSettings(settings);
    const saved = await store.saveBoard(board([person('a')]));

    const result = await webdav.backupAndRecord();
    expect(result).toEqual({ ok: true, file: expect.stringMatching(/^link-board-.*\.json$/) });
    expect(JSON.parse(files.get(result.file!)!)).toEqual(saved);
    const recorded = await store.loadSettings();
    expect(Number.isNaN(Date.parse(recorded.webdav.lastBackupAt!))).toBe(false);
    expect(recorded.webdav.lastError).toBeUndefined();
  });
});
