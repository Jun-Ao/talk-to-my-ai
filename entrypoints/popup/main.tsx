import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getSettings } from '../../src/settings/storage';
import type { DeepSeekModel } from '../../src/shared/types';
import './style.css';

function PopupApp() {
  const [configured, setConfigured] = useState(false);
  const [model, setModel] = useState<DeepSeekModel>('deepseek-v4-pro');

  useEffect(() => {
    void getSettings().then((settings) => {
      setConfigured(Boolean(settings.deepSeekApiKey));
      setModel(settings.deepSeekModel);
    });
  }, []);

  return <main className="popup-shell">
    <h1>跟我的 AI 说去吧！</h1>
    <div className="status-row">
      <span>API 状态</span>
      <strong className={configured ? 'ok' : 'warn'}>{configured ? '已配置' : '未配置'}</strong>
    </div>
    <div className="status-row">
      <span>当前模型</span>
      <strong>{model}</strong>
    </div>
    <button type="button" onClick={() => browser.runtime.openOptionsPage()}>打开设置</button>
  </main>;
}

createRoot(document.querySelector('#root')!).render(<PopupApp />);
