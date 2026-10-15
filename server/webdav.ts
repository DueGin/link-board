import type { WebdavConfig } from '../shared/types';
import { loadBoard, loadSettings, saveSettings } from './store';

const dirUrl = (url: string) => (url.endsWith('/') ? url : url + '/');

function authHeader(cfg: WebdavConfig) {
  return 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
}

async function dav(cfg: WebdavConfig, method: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    method,
    headers: { Authorization: authHeader(cfg), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  return res;
}

// 列出备份目录下的 link-board-*.json 文件（PROPFIND Depth:1）
async function listBackups(cfg: WebdavConfig): Promise<string[]> {
  const res = await dav(cfg, 'PROPFIND', dirUrl(cfg.url), {
    headers: { Depth: '1', 'Content-Type': 'application/xml' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>',
  });
  if (!res.ok) return [];
  const xml = await res.text();
  const names = [...xml.matchAll(/<[^>]*href>([^<]+)<\/[^>]*href>/gi)]
    .map((m) => decodeURIComponent(m[1]).split('/').filter(Boolean).pop() ?? '')
    .filter((n) => /^link-board-.*\.json$/.test(n));
  return [...new Set(names)].sort();
}

export async function runBackup(cfg: WebdavConfig): Promise<string> {
  if (!cfg.url) throw new Error('未配置 WebDAV 地址');
  const base = dirUrl(cfg.url);

  // 目录不存在时尝试创建；已存在会返回 405，忽略即可
  await dav(cfg, 'MKCOL', base).catch(() => undefined);

  const board = await loadBoard();
  const name = `link-board-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const res = await dav(cfg, 'PUT', base + name, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(board, null, 2),
  });
  if (!res.ok) throw new Error(`上传失败：HTTP ${res.status} ${res.statusText}`);

  // 清理超出保留份数的旧备份
  if (cfg.keep > 0) {
    const all = await listBackups(cfg);
    for (const old of all.slice(0, Math.max(0, all.length - cfg.keep))) {
      await dav(cfg, 'DELETE', base + encodeURIComponent(old)).catch(() => undefined);
    }
  }
  return name;
}

// 执行一次备份并把结果写回设置
export async function backupAndRecord(): Promise<{ ok: boolean; file?: string; error?: string }> {
  const s = await loadSettings();
  try {
    const file = await runBackup(s.webdav);
    s.webdav.lastBackupAt = new Date().toISOString();
    s.webdav.lastError = undefined;
    await saveSettings(s);
    return { ok: true, file };
  } catch (e: any) {
    s.webdav.lastError = String(e?.message ?? e);
    await saveSettings(s);
    return { ok: false, error: s.webdav.lastError };
  }
}

let timer: NodeJS.Timeout | undefined;

// 每分钟检查一次是否到期，比固定 setInterval 更能适应设置变更和进程重启
export function startScheduler() {
  if (timer) return;
  timer = setInterval(async () => {
    const { webdav } = await loadSettings();
    if (!webdav.enabled || !webdav.url) return;
    const last = webdav.lastBackupAt ? Date.parse(webdav.lastBackupAt) : 0;
    if (Date.now() - last >= webdav.intervalMinutes * 60_000) {
      const r = await backupAndRecord();
      console.log(r.ok ? `[webdav] 已备份 ${r.file}` : `[webdav] 备份失败：${r.error}`);
    }
  }, 60_000);
}
