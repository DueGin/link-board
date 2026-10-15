export {};

declare global {
  interface Window {
    // Electron preload 注入的桌面端信息，浏览器里不存在
    desktop?: { platform: string };
  }
}
