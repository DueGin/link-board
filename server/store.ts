import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { emptyBoard, type Board, type Settings } from '../shared/types';

const DATA_DIR = process.env.DATA_DIR ?? path.resolve('data');
const BOARD_FILE = path.join(DATA_DIR, 'board.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// 先写临时文件再 rename，避免写一半崩溃导致数据损坏
async function writeAtomic(file: string, data: unknown) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (e: any) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function loadBoard(): Promise<Board> {
  return (await readJson<Board>(BOARD_FILE)) ?? emptyBoard();
}

export async function saveBoard(board: Board): Promise<Board> {
  const next = { ...board, version: 1 as const, updatedAt: new Date().toISOString() };
  await writeAtomic(BOARD_FILE, next);
  return next;
}

export async function loadSettings(): Promise<Settings> {
  const s = await readJson<Settings>(SETTINGS_FILE);
  if (s) return s;
  const init: Settings = {
    apiToken: crypto.randomBytes(24).toString('hex'),
    webdav: { enabled: false, url: '', username: '', password: '', intervalMinutes: 1440, keep: 30 },
  };
  await writeAtomic(SETTINGS_FILE, init);
  return init;
}

export async function saveSettings(s: Settings) {
  await writeAtomic(SETTINGS_FILE, s);
}
