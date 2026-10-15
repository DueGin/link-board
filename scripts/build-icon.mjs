import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import electron from 'electron';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const buildDir = path.join(root, 'build');

if (process.platform !== 'darwin') throw new Error('生成 ICNS 需要 macOS 的 sips 和 iconutil。');

// 在隔离的 Electron 进程中渲染，复用项目依赖，不安装额外的 SVG 转换工具。
function renderIcon() {
  const { app, BrowserWindow } = require('electron');
  const fs = require('node:fs/promises');
  const [source, destination] = process.argv.slice(2);
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.whenReady().then(async () => {
    app.dock?.hide();
    const window = new BrowserWindow({
      width: 1024,
      height: 1024,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    const svg = (await fs.readFile(source)).toString('base64');
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
      `<html><body style="margin:0;background:transparent"><img width="1024" height="1024" src="data:image/svg+xml;base64,${svg}"></body></html>`,
    )}`);
    await window.webContents.executeJavaScript(`(async () => {
      await document.querySelector('img').decode();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
    const size = image.getSize();
    if (image.isEmpty() || size.width !== 1024 || size.height !== 1024) {
      throw new Error('图标渲染尺寸错误，应为 1024×1024。');
    }
    await fs.writeFile(destination, image.toPNG());
    window.destroy();
    app.quit();
  }).catch(error => {
    console.error(error);
    app.exit(1);
  });
}

await mkdir(buildDir, { recursive: true });
const temporary = await mkdtemp(path.join(os.tmpdir(), 'link-board-icon-'));
try {
  const renderer = path.join(temporary, 'render.cjs');
  const png = path.join(temporary, 'icon.png');
  const iconset = path.join(temporary, 'icon.iconset');
  const icns = path.join(temporary, 'icon.icns');
  await writeFile(renderer, `(${renderIcon.toString()})();\n`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  await run(electron, [renderer, path.join(buildDir, 'icon.svg'), png], { env, timeout: 45_000 });
  await mkdir(iconset);
  await Promise.all([16, 32, 128, 256, 512].flatMap(size => [1, 2].map(async scale => {
    const filename = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
    await run('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), png, '--out', path.join(iconset, filename)]);
  })));
  await run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', icns]);
  await copyFile(png, path.join(buildDir, 'icon.png'));
  await copyFile(icns, path.join(buildDir, 'icon.icns'));
  console.log('已生成 build/icon.png（1024×1024）及 build/icon.icns（10 个标准尺寸）。');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
