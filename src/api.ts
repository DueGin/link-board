import type { Board, WebdavConfig } from '../shared/types';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export type SettingsView = {
  apiToken: string;
  webdav: WebdavConfig & { hasPassword: boolean };
};

export const api = {
  getBoard: () => req<Board>('/api/board'),
  saveBoard: (b: Board) => req<Board>('/api/board', { method: 'PUT', body: JSON.stringify(b) }),
  getSettings: () => req<SettingsView>('/api/settings'),
  saveWebdav: (w: Partial<WebdavConfig>) =>
    req<{ ok: true }>('/api/settings/webdav', { method: 'PUT', body: JSON.stringify(w) }),
  rotateToken: () => req<{ apiToken: string }>('/api/settings/token/rotate', { method: 'POST' }),
  backupNow: () => req<{ ok: boolean; file?: string; error?: string }>('/api/backup', { method: 'POST' }),
};

export const uid = () => crypto.randomUUID().slice(0, 8);
