import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { WebdavConfig } from '../shared/types';
import { api, type SettingsView } from './api';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [webdav, setWebdav] = useState<WebdavConfig | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const next = await api.getSettings();
      setSettings(next);
      setWebdav({ ...next.webdav, password: '' });
    } catch (e) {
      setError('加载设置失败：' + (e as Error).message);
    }
  };

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    void load();
    return () => element?.close();
  }, []);

  const run = async (action: string, fn: () => Promise<void>) => {
    setBusy(action);
    setMessage('');
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!webdav) return;
    void run('保存', async () => {
      await api.saveWebdav({
        enabled: webdav.enabled,
        url: webdav.url.trim(),
        username: webdav.username,
        password: webdav.password,
        intervalMinutes: Math.max(5, webdav.intervalMinutes),
        keep: Math.max(0, webdav.keep),
      });
      const next = await api.getSettings();
      setSettings(next);
      setWebdav({ ...next.webdav, password: '' });
      setMessage('备份设置已保存。');
    });
  };

  const backup = () => void run('备份', async () => {
    try {
      const result = await api.backupNow();
      if (!result.ok) throw new Error(result.error || '备份失败');
      setMessage('备份成功' + (result.file ? '：' + result.file : '。'));
    } finally {
      const next = await api.getSettings();
      setSettings(next);
    }
  });

  const patch = (value: Partial<WebdavConfig>) => setWebdav((prev) => prev ? { ...prev, ...value } : prev);
  // 用当前页面地址生成示例，不写死端口
  const curl = settings ? `curl -H "Authorization: Bearer ${settings.apiToken}" "${window.location.origin}/api/agent/search?q=律师"` : '';

  return (
    <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onCancel={onClose}>
      <div className="dialog-header">
        <div><span className="eyebrow">图谱设置</span><h2 id="settings-title">连接与备份</h2></div>
        <button type="button" className="icon-button" aria-label="关闭设置" onClick={onClose}>×</button>
      </div>
      <div className="dialog-body">
        {error && <p className="error-message" role="alert">{error}</p>}
        <p className="feedback" role="status">{busy ? `正在${busy}…` : message}</p>
        {!settings || !webdav ? (
          <div className="loading-state">{error ? <button type="button" onClick={() => void load()}>重新加载设置</button> : '正在加载设置…'}</div>
        ) : <>
          <section className="settings-section" aria-labelledby="agent-title">
            <h3 id="agent-title">外部 Agent 接入</h3>
            <p className="muted">让外部 Agent 读取人脉资料、按关键词寻找合适的人。</p>
            <label htmlFor="api-token">API Token</label>
            <div className="token-row">
              <input id="api-token" readOnly value={settings.apiToken} spellCheck={false} />
              <button type="button" disabled={!!busy} onClick={() => void run('复制', async () => {
                await navigator.clipboard.writeText(settings.apiToken);
                setMessage('Token 已复制。');
              })}>复制</button>
            </div>
            <button type="button" className="text-button" disabled={!!busy} onClick={() => {
              if (!window.confirm('轮换 Token 后，旧 Token 将立即失效。确定继续？')) return;
              void run('轮换', async () => {
                const result = await api.rotateToken();
                setSettings((prev) => prev ? { ...prev, apiToken: result.apiToken } : prev);
                setMessage('Token 已轮换，请更新外部 Agent 的配置。');
              });
            }}>轮换 Token</button>
            <p className="field-help">调用示例</p>
            <pre className="curl-example"><code>{curl}</code></pre>
            <p className="muted">接口文档：<a href="/api/agent" target="_blank" rel="noreferrer">/api/agent ↗</a></p>
          </section>
          <section className="settings-section" aria-labelledby="webdav-title">
            <h3 id="webdav-title">WebDAV 定时备份</h3>
            <form onSubmit={save}>
              <fieldset className="form-stack" disabled={!!busy}>
                <legend className="sr-only">WebDAV 备份配置</legend>
                <label htmlFor="webdav-enabled" className="checkbox-label">
                  <input id="webdav-enabled" type="checkbox" checked={webdav.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
                  启用定时备份
                </label>
                <label htmlFor="webdav-url">WebDAV 目录地址
                  <input id="webdav-url" type="url" required={webdav.enabled} value={webdav.url} placeholder="https://dav.example.com/backup/"
                    onChange={(e) => patch({ url: e.target.value })} />
                </label>
                <div className="form-row">
                  <label htmlFor="webdav-username">用户名
                    <input id="webdav-username" autoComplete="username" value={webdav.username} onChange={(e) => patch({ username: e.target.value })} />
                  </label>
                  <label htmlFor="webdav-password">密码
                    <input id="webdav-password" type="password" autoComplete="new-password" value={webdav.password}
                      placeholder={settings.webdav.hasPassword ? '已设置，留空不修改' : '留空表示不修改'}
                      onChange={(e) => patch({ password: e.target.value })} />
                  </label>
                </div>
                <div className="form-row">
                  <label htmlFor="webdav-interval">备份间隔（分钟）
                    <input id="webdav-interval" type="number" min="5" step="1" required value={webdav.intervalMinutes}
                      onChange={(e) => patch({ intervalMinutes: Number(e.target.value) })} />
                  </label>
                  <label htmlFor="webdav-keep">保留份数
                    <input id="webdav-keep" type="number" min="0" step="1" required value={webdav.keep}
                      onChange={(e) => patch({ keep: Number(e.target.value) })} />
                  </label>
                </div>
                <p className="field-help">保留份数为 0 时不清理历史备份。立即备份使用已保存的配置。</p>
                <div className="button-row">
                  <button type="submit" className="primary">保存备份设置</button>
                  <button type="button" onClick={backup}>立即备份</button>
                </div>
              </fieldset>
            </form>
            <dl className="backup-status">
              <div><dt>上次备份</dt><dd>{settings.webdav.lastBackupAt ? new Date(settings.webdav.lastBackupAt).toLocaleString('zh-CN') : '暂无备份记录'}</dd></div>
              <div><dt>最近错误</dt><dd>{settings.webdav.lastError || '无'}</dd></div>
            </dl>
          </section>
        </>}
      </div>
    </dialog>
  );
}
