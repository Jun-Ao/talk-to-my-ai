import type { AnalyzeResult, DeepSeekModel } from '../shared/types';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

export async function analyzeWithDeepSeek(input: {
  apiKey: string;
  model: DeepSeekModel;
  prompt: string;
  signal?: AbortSignal;
}): Promise<AnalyzeResult> {
  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    signal: input.signal,
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        {
          role: 'user',
          content: input.prompt,
        },
      ],
      temperature: 0,
      thinking: { type: 'disabled' },
      stream: false,
    }),
  });

  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(formatApiError(payload, response));
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error(JSON.stringify(payload));
  return { content, usage: payload.usage };
}

export async function testDeepSeek(input: { apiKey: string; model: DeepSeekModel; signal?: AbortSignal }): Promise<void> {
  await analyzeWithDeepSeek({
    apiKey: input.apiKey,
    model: input.model,
    prompt: '请只回复 OK。',
    signal: input.signal,
  });
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function formatApiError(payload: any, response: Response): string {
  if (typeof payload === 'string') return payload;
  if (payload?.error) return JSON.stringify(payload.error);
  return JSON.stringify(payload || { status: response.status, statusText: response.statusText });
}
