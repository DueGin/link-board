import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import electron from 'electron';

const url = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';
const deadline = Date.now() + 30_000;
while (true) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    if (response.ok) break;
  } catch {}
  if (Date.now() >= deadline) throw new Error(`等待 Vite 启动超时：${url}`);
  await setTimeout(250);
}

const env = { ...process.env, VITE_DEV_SERVER_URL: url };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env });
child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { child.kill(signal); });
}
