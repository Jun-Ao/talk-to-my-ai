import React, { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getSettings } from '../src/settings/storage';
import { getCommentContext, getPageContext, shouldShowEntry } from '../src/bitbucket/adapter';
import { fetchPatchContext } from '../src/bitbucket/patch';
import { renderPrompt } from '../src/prompt/renderPrompt';
import { extractRecommendedReply } from '../src/prompt/extractReply';
import { hashText } from '../src/shared/hash';
import type { AnalyzeResult, DeepSeekUsage, PromptContext } from '../src/shared/types';
import tokensCss from '../src/ui/tokens.css?inline';
import panelCss from '../src/ui/panel.css?inline';
import '../src/ui/content-entry.css';

const ENTRY_MARK = 'data-ttmai-entry';
const cache = new Map<string, AnalyzeResult>();

export default defineContentScript({
  matches: ['*://*/projects/*/repos/*/pull-requests/*', '*://*/users/*/repos/*/pull-requests/*'],
  runAt: 'document_idle',
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'talk-to-my-ai-panel',
      position: 'inline',
      anchor: 'body',
      onMount(container) {
        const root = createRoot(container);
        root.render(<Panel />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
    injectEntries();
    const observer = new MutationObserver(() => injectEntries());
    observer.observe(document.body, { childList: true, subtree: true });
  },
});

type PanelState =
  | { kind: 'idle' }
  | { kind: 'no-key'; prompt: string; target: string }
  | { kind: 'loading'; prompt: string; target: string }
  | { kind: 'success'; prompt: string; target: string; result: AnalyzeResult; reply: string; cached: boolean }
  | { kind: 'error'; prompt: string; target: string; error: string; previous?: AnalyzeResult };

let openPanel: ((comment: Element) => void) | null = null;

function Panel() {
  const [state, setState] = useState<PanelState>({ kind: 'idle' });
  const [open, setOpen] = useState(false);
  const requestIdRef = useRef('');

  const analyzeComment = useCallback(async (comment: Element, force = false) => {
    setOpen(true);
    const requestId = crypto.randomUUID();
    const previousRequestId = requestIdRef.current;
    if (previousRequestId) browser.runtime.sendMessage({ type: 'abortAnalyze', requestId: previousRequestId });
    requestIdRef.current = requestId;

    const settings = await getSettings();
    const page = getPageContext(document, location);
    const commentContext = getCommentContext(comment);
    const patch = await fetchPatchContext(page.pullRequest, commentContext.file, location.origin);
    const promptContext: PromptContext = { currentUser: page.currentUser, pullRequest: page.pullRequest, comment: commentContext, patch };
    const prompt = renderPrompt(settings.userPromptTemplate, promptContext);
    const target = `${commentContext.targetComment.author}: ${commentContext.targetComment.body.slice(0, 80)}`;
    const promptHash = await hashText(prompt);
    const cacheKey = `${commentContext.targetCommentId}:${promptHash}`;

    if (!settings.deepSeekApiKey) {
      if (requestIdRef.current === requestId) setState({ kind: 'no-key', prompt, target });
      return;
    }

    const cached = cache.get(cacheKey);
    if (cached && !force) {
      if (requestIdRef.current === requestId) {
        setState({ kind: 'success', prompt, target, result: cached, reply: extractRecommendedReply(cached.content), cached: true });
      }
      return;
    }

    const previous = state.kind === 'success' ? state.result : undefined;
    if (requestIdRef.current === requestId) setState({ kind: 'loading', prompt, target });

    const response = await browser.runtime.sendMessage({ type: 'analyze', requestId, prompt });
    if (requestIdRef.current !== requestId) return;

    if (response?.ok) {
      cache.set(cacheKey, response.result);
      setState({ kind: 'success', prompt, target, result: response.result, reply: extractRecommendedReply(response.result.content), cached: false });
    } else {
      setState({ kind: 'error', prompt, target, error: response?.error || 'Unknown error', previous });
    }
  }, [state]);

  openPanel = analyzeComment;

  const copy = async (text: string) => navigator.clipboard.writeText(text);
  const openOptions = () => browser.runtime.sendMessage({ type: 'openOptions' });
  const regenerate = () => {
    const activeId = document.querySelector(`[${ENTRY_MARK}="active"]`)?.closest('.comment[data-comment-id]');
    if (activeId) void analyzeComment(activeId, true);
  };

  return (
    <>
      <style>{tokensCss + panelCss}</style>
      {open && (
        <aside className="ttmai-panel" role="dialog" aria-label="跟我的 AI 说去吧">
          <header className="ttmai-panel-header">
            <div>
              <h2>跟我的 AI 说去吧！</h2>
              {'target' in state && <p>{state.target}</p>}
            </div>
            <button className="ttmai-close" onClick={() => setOpen(false)}>×</button>
          </header>
          <main className="ttmai-panel-body">
            {state.kind === 'idle' && <EmptyState />}
            {state.kind === 'no-key' && <PromptOnly state={state} copy={copy} openOptions={openOptions} />}
            {state.kind === 'loading' && <LoadingState prompt={state.prompt} copy={copy} />}
            {state.kind === 'success' && <SuccessState state={state} copy={copy} regenerate={regenerate} />}
            {state.kind === 'error' && <ErrorState state={state} copy={copy} regenerate={regenerate} openOptions={openOptions} />}
          </main>
        </aside>
      )}
    </>
  );
}

function EmptyState() {
  return <div className="ttmai-empty">选择一条评论开始分析。</div>;
}

function PromptOnly({ state, copy, openOptions }: { state: Extract<PanelState, { kind: 'no-key' }>; copy: (text: string) => Promise<void>; openOptions: () => void }) {
  return <>
    <div className="ttmai-banner">未配置 DeepSeek API Key。你可以先复制 Prompt，或前往设置配置后直接分析。</div>
    <Actions><button className="ttmai-button" onClick={() => copy(state.prompt)}>复制 Prompt</button><button className="ttmai-button secondary" onClick={openOptions}>去设置</button></Actions>
    <PromptPreview prompt={state.prompt} />
  </>;
}

function LoadingState({ prompt, copy }: { prompt: string; copy: (text: string) => Promise<void> }) {
  return <><div className="ttmai-loading">生成中...</div><Actions><button className="ttmai-button secondary" onClick={() => copy(prompt)}>复制 Prompt</button></Actions></>;
}

function SuccessState({ state, copy, regenerate }: { state: Extract<PanelState, { kind: 'success' }>; copy: (text: string) => Promise<void>; regenerate: () => void }) {
  return <>
    {state.cached && <span className="ttmai-lozenge">cached</span>}
    <Actions>
      <button className="ttmai-button" disabled={!state.reply} onClick={() => copy(state.reply || state.result.content)}>复制推荐回复</button>
      <button className="ttmai-button secondary" onClick={() => copy(state.result.content)}>复制完整分析</button>
      <button className="ttmai-button subtle" onClick={regenerate}>重新生成</button>
    </Actions>
    <MarkdownText text={state.result.content} />
    <UsageDetails usage={state.result.usage} />
    <PromptPreview prompt={state.prompt} />
  </>;
}

function ErrorState({ state, copy, regenerate, openOptions }: { state: Extract<PanelState, { kind: 'error' }>; copy: (text: string) => Promise<void>; regenerate: () => void; openOptions: () => void }) {
  return <>
    <div className="ttmai-error">{state.error}</div>
    <Actions><button className="ttmai-button" onClick={() => copy(state.prompt)}>复制 Prompt</button><button className="ttmai-button secondary" onClick={regenerate}>重试</button><button className="ttmai-button subtle" onClick={openOptions}>去设置</button></Actions>
    {state.previous && <MarkdownText text={state.previous.content} />}
    <PromptPreview prompt={state.prompt} />
  </>;
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="ttmai-actions">{children}</div>;
}

function MarkdownText({ text }: { text: string }) {
  return <div className="ttmai-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>;
}

function PromptPreview({ prompt }: { prompt: string }) {
  return <details className="ttmai-details"><summary>Prompt 预览</summary><textarea readOnly value={prompt} /></details>;
}

function UsageDetails({ usage }: { usage?: DeepSeekUsage }) {
  if (!usage) return null;
  return <details className="ttmai-details"><summary>详情</summary><pre>{JSON.stringify(usage, null, 2)}</pre></details>;
}

function injectEntries() {
  const page = getPageContext(document, location);
  document.querySelectorAll('.comment[data-comment-id]').forEach((comment) => {
    const actionList = findActionList(comment);
    if (!actionList) return;

    const existing = actionList.querySelector(`[${ENTRY_MARK}]`);
    if (!shouldShowEntry(comment, page)) {
      existing?.remove();
      return;
    }
    if (existing) return;

    const item = document.createElement('li');
    item.className = 'action-item ttmai-entry-item';
    item.setAttribute(ENTRY_MARK, 'true');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ttmai-entry-button';
    button.textContent = '跟我的 AI 说去吧！';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      document.querySelectorAll(`[${ENTRY_MARK}="active"]`).forEach((node) => node.setAttribute(ENTRY_MARK, 'true'));
      item.setAttribute(ENTRY_MARK, 'active');
      openPanel?.(comment);
    });
    item.appendChild(button);
    actionList.appendChild(item);
  });
}

function findActionList(comment: Element): Element | null {
  const wrapper = comment.querySelector(':scope > .comment-wrapper') || comment.querySelector('.comment-wrapper');
  return wrapper?.querySelector('.comment-actions .action-list') || null;
}
