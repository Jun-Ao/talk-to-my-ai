import { getSettings } from '../src/settings/storage';
import type { BackgroundMessage } from '../src/shared/types';
import { analyzeWithDeepSeek, testDeepSeek } from '../src/deepseek/client';

const controllers = new Map<string, AbortController>();

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: BackgroundMessage) => {
    if (message.type === 'abortAnalyze') {
      controllers.get(message.requestId)?.abort();
      controllers.delete(message.requestId);
      return Promise.resolve({ ok: true });
    }

    if (message.type === 'analyze') {
      return handleAnalyze(message.requestId, message.prompt);
    }

    if (message.type === 'testDeepSeek') {
      return handleTest(message.apiKey, message.model);
    }

    if (message.type === 'openOptions') {
      return browser.runtime.openOptionsPage().then(() => ({ ok: true }));
    }

    return Promise.resolve({ ok: false, error: 'Unknown message type' });
  });
});

async function handleAnalyze(requestId: string, prompt: string) {
  const settings = await getSettings();
  if (!settings.deepSeekApiKey) return { ok: false, error: 'DeepSeek API key is not configured' };

  const controller = new AbortController();
  controllers.set(requestId, controller);
  try {
    const result = await analyzeWithDeepSeek({
      apiKey: settings.deepSeekApiKey,
      model: settings.deepSeekModel,
      prompt,
      signal: controller.signal,
    });
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    controllers.delete(requestId);
  }
}

async function handleTest(apiKey: string, model: 'deepseek-v4-pro' | 'deepseek-v4-flash') {
  try {
    await testDeepSeek({ apiKey, model });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
