import { createApp } from './app';
import { loadSettings } from './store';
import { startScheduler } from './webdav';

// 默认只监听本机：网页端接口没有登录，暴露到局域网/公网前请先加反向代理鉴权
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3789);

const { apiToken } = await loadSettings();
createApp().listen(PORT, HOST, () => {
  console.log(`Link Board 运行于 http://${HOST}:${PORT}`);
  console.log(`Agent API 文档：http://${HOST}:${PORT}/api/agent  (token: ${apiToken.slice(0, 6)}…，完整值见网页设置)`);
});
startScheduler();
