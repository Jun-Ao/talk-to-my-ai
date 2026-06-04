import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '跟我的 AI 说去吧！',
    description: '在 Bitbucket Pull Request 评论旁生成按钮，复制 Prompt 或直接调用 DeepSeek 分析 review 评论。',
    version: '0.2.0',
    permissions: ['storage', 'clipboardWrite'],
    host_permissions: ['https://api.deepseek.com/*'],
    icons: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
    action: {
      default_icon: {
        16: 'icons/icon16.png',
        32: 'icons/icon32.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png',
      },
    },
  },
});
