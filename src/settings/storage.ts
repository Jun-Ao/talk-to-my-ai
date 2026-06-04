import { storage } from '#imports';
import type { DeepSeekModel } from '../shared/types';
import { DEFAULT_USER_PROMPT_TEMPLATE } from '../prompt/defaultTemplate';

export type Settings = {
  deepSeekApiKey: string;
  deepSeekModel: DeepSeekModel;
  userPromptTemplate: string;
};

export const DEFAULT_MODEL: DeepSeekModel = 'deepseek-v4-pro';

const apiKeyItem = storage.defineItem<string>('local:deepSeekApiKey', { fallback: '' });
const modelItem = storage.defineItem<DeepSeekModel>('local:deepSeekModel', { fallback: DEFAULT_MODEL });
const templateItem = storage.defineItem<string>('local:userPromptTemplate', { fallback: DEFAULT_USER_PROMPT_TEMPLATE });

export async function getSettings(): Promise<Settings> {
  const [deepSeekApiKey, deepSeekModel, userPromptTemplate] = await Promise.all([
    apiKeyItem.getValue(),
    modelItem.getValue(),
    templateItem.getValue(),
  ]);
  return { deepSeekApiKey, deepSeekModel, userPromptTemplate };
}

export async function setApiKey(value: string): Promise<void> {
  await apiKeyItem.setValue(value.trim());
}

export async function setModel(value: DeepSeekModel): Promise<void> {
  await modelItem.setValue(value);
}

export async function setUserPromptTemplate(value: string): Promise<void> {
  await templateItem.setValue(value);
}

export async function resetUserPromptTemplate(): Promise<void> {
  await templateItem.setValue(DEFAULT_USER_PROMPT_TEMPLATE);
}

export async function clearApiKey(): Promise<void> {
  await apiKeyItem.setValue('');
}
