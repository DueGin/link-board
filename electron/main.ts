import { app, BrowserWindow, dialog, Menu, nativeTheme, session, shell } from 'electron';
import type { MenuItemConstructorOptions, SaveDialogOptions } from 'electron';
import fs from 'node:fs/promises';
import type { Server } from 'node:http';
import path from 'node:path';

const SERVER_URL = 'http://127.0.0.1:3789';
const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';
const PRODUCT_NAME = '人脉图谱';
let mainWindow: BrowserWindow | null = null;
let server: Server | undefined;
let dataDir = '';

app.setName(PRODUCT_NAME);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function openExternal(url: string) {
  if (!['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)) return;
  void shell.openExternal(url).catch((error) => dialog.showErrorBox('无法打开链接', errorMessage(error)));
}

async function exportFile(extension: 'json' | 'md') {
  try {
    const options: SaveDialogOptions = {
      title: extension === 'json' ? '导出 JSON' : '导出 Markdown',
      defaultPath: path.join(app.getPath('downloads'), `link-board.${extension}`),
      filters: [{ name: extension === 'json' ? 'JSON' : 'Markdown', extensions: [extension] }],
    };
    const result = await (mainWindow ? dialog.showSaveDialog(mainWindow, options) : dialog.showSaveDialog(options));
    if (result.canceled || !result.filePath) return;
    const response = await fetch(`${SERVER_URL}/api/export.${extension}`);
    if (!response.ok) throw new Error(`导出失败：HTTP ${response.status}`);
    await fs.writeFile(result.filePath, Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    dialog.showErrorBox('导出失败', errorMessage(error));
  }
}

function installMenu() {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: '文件',
      submenu: [
        { label: '导出 JSON…', click: () => { void exportFile('json'); } },
        { label: '导出 Markdown…', click: () => { void exportFile('md'); } },
        { type: 'separator' },
        {
          label: '打开数据目录',
          click: () => {
            void shell.openPath(dataDir).then((error) => {
              if (error) dialog.showErrorBox('无法打开数据目录', error);
            });
          },
        },
      ],
    },
    { role: 'editMenu', label: '编辑' },
    { role: 'viewMenu', label: '视图' },
    { role: 'windowMenu', label: '窗口' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const url = app.isPackaged ? SERVER_URL : DEV_URL;
  const window = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141518' : '#f7f8fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    openExternal(target);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin !== new URL(url).origin) {
      event.preventDefault();
      openExternal(target);
    }
  });
  window.webContents.on('did-finish-load', () => {
    console.log(`桌面窗口已加载：${window.webContents.getURL()}`);
  });
  window.on('closed', () => { mainWindow = null; });
  void window.loadURL(url).catch((error) => dialog.showErrorBox('页面加载失败', errorMessage(error)));
}

async function start() {
  // 打包版使用应用包内的 ICNS；开发版从项目根目录读取同一套图标。
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(path.join(app.getAppPath(), 'build', 'icon.png'));
  }
  dataDir = path.join(app.getPath('userData'), 'data');
  process.env.DATA_DIR = dataDir;
  process.env.STATIC_DIR = path.join(app.getAppPath(), 'dist');
  await fs.mkdir(dataDir, { recursive: true });

  // 存储模块在加载时读取 DATA_DIR，必须在设置路径后再导入。
  const { createApp } = await import('../server/app');
  const { loadSettings } = await import('../server/store');
  const { startScheduler } = await import('../server/webdav');
  await new Promise<void>((resolve, reject) => {
    server = createApp().listen(3789, '127.0.0.1', (error) => error ? reject(error) : resolve());
    server.once('error', reject);
  });
  await loadSettings();
  startScheduler();

  session.defaultSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({
      title: '保存导出文件',
      defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
    });
  });
  installMenu();
  nativeTheme.on('updated', () => {
    mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#141518' : '#f7f8fa');
  });
  createWindow();
  app.on('activate', () => {
    if (mainWindow) mainWindow.show();
    else createWindow();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      if (server?.listening) createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', () => {
    server?.closeAllConnections();
    server?.close();
  });
  void app.whenReady().then(start).catch((error: NodeJS.ErrnoException) => {
    dialog.showErrorBox('无法启动人脉图谱', error.code === 'EADDRINUSE'
      ? '本地端口 3789 已被占用，另一份应用或服务可能已经在运行。请关闭占用该端口的程序后重试。'
      : errorMessage(error));
    app.quit();
  });
}
