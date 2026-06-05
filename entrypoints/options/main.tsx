import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_USER_PROMPT_TEMPLATE, LOCKED_OUTPUT_TEMPLATE } from '../../src/prompt/defaultTemplate';
import { clearApiKey, getSettings, resetUserPromptTemplate, setApiKey, setModel, setUserPromptTemplate } from '../../src/settings/storage';
import type { DeepSeekModel } from '../../src/shared/types';
import './style.css';

function OptionsApp() {
  const [apiKey, setApiKeyState] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModelState] = useState<DeepSeekModel>('deepseek-v4-pro');
  const [template, setTemplate] = useState(DEFAULT_USER_PROMPT_TEMPLATE);
  const [status, setStatus] = useState('');
  const [testing, setTesting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    void getSettings().then((settings) => {
      setApiKeyState(settings.deepSeekApiKey);
      setModelState(settings.deepSeekModel);
      setTemplate(settings.userPromptTemplate);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void Promise.all([setApiKey(apiKey), setModel(model), setUserPromptTemplate(template)]).then(() => flash('已自动保存'));
    }, 450);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [apiKey, model, template, loaded]);

  const resetTemplate = async () => {
    await resetUserPromptTemplate();
    setTemplate(DEFAULT_USER_PROMPT_TEMPLATE);
    flash('已恢复默认模板');
  };

  const clearKey = async () => {
    await clearApiKey();
    setApiKeyState('');
    flash('已清空 API Key');
  };

  const test = async () => {
    setTesting(true);
    setStatus('测试中...');
    await Promise.all([setApiKey(apiKey), setModel(model), setUserPromptTemplate(template)]);
    const response = await browser.runtime.sendMessage({ type: 'testDeepSeek', apiKey, model });
    setTesting(false);
    setStatus(response?.ok ? '连接成功' : response?.error || '测试失败');
  };

  const flash = (message: string) => {
    setStatus(message);
    setTimeout(() => setStatus((current) => current === message ? '' : current), 1800);
  };

  return <main className="options-shell">
    <header className="options-header">
      <h1>跟我的 AI 说去吧！</h1>
      <p>配置 DeepSeek 和 Prompt 模板。修改会自动保存，输出格式已锁定以保证稳定提取推荐回复。</p>
    </header>

    {status && <div className={status.includes('失败') || status.startsWith('{') ? 'toast error' : 'toast'}>{status}</div>}

    <section className="card">
      <h2>DeepSeek</h2>
      <label className="field">
        <span>API Key</span>
        <div className="key-row">
          <input type={showKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKeyState(event.target.value)} placeholder="sk-..." />
          <button type="button" className="secondary" onClick={() => setShowKey(!showKey)}>{showKey ? '隐藏' : '显示'}</button>
          <button type="button" className="secondary" onClick={clearKey}>清空</button>
        </div>
      </label>
      <label className="field">
        <span>模型</span>
        <select value={model} onChange={(event) => setModelState(event.target.value as DeepSeekModel)}>
          <option value="deepseek-v4-pro">deepseek-v4-pro</option>
          <option value="deepseek-v4-flash">deepseek-v4-flash</option>
        </select>
      </label>
      <div className="actions">
        <button type="button" className="secondary" disabled={!apiKey || testing} onClick={test}>{testing ? '测试中...' : '测试连接'}</button>
      </div>
    </section>

    <section className="card">
      <h2>Prompt 模板</h2>
      <p className="hint">可编辑前置分析要求。上下文变量和输出格式由系统固定拼接。</p>
      <textarea value={template} onChange={(event) => setTemplate(event.target.value)} />
      <details>
        <summary>锁定输出格式</summary>
        <pre>{LOCKED_OUTPUT_TEMPLATE}</pre>
      </details>
      <div className="actions">
        <button type="button" className="secondary" onClick={resetTemplate}>恢复默认模板</button>
      </div>
    </section>
  </main>;
}

createRoot(document.querySelector('#root')!).render(<OptionsApp />);
