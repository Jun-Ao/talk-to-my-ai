import type { CommentInfo, LocalDiffLine, PromptContext } from '../shared/types';
import { LOCKED_OUTPUT_TEMPLATE } from './defaultTemplate';

export function renderPrompt(userTemplate: string, context: PromptContext): string {
  return [
    userTemplate.trim(),
    '',
    renderPrContext(context),
    '',
    renderPatchContext(context),
    '',
    renderCommentContext(context),
    '',
    renderTargetTask(context.comment.targetComment),
    '',
    LOCKED_OUTPUT_TEMPLATE,
  ].join('\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

function renderPrContext(context: PromptContext): string {
  const pr = context.pullRequest;
  return [
    '## PR 上下文',
    '',
    `- 标题：${pr.title || '未知'}`,
    `- PR ID：${pr.id || '未知'}`,
    `- 仓库：${pr.projectKey || '未知'} / ${pr.repoSlug || '未知'}`,
    `- 源分支：${pr.sourceBranch || '未知'}`,
    `- 目标分支：${pr.targetBranch || '未知'}`,
    `- PR 作者：${formatUser(pr.author)}`,
    `- 当前登录用户：${formatUser(context.currentUser)}`,
    '',
    '### PR 描述',
    '',
    pr.description || '未识别到 PR 描述。',
  ].join('\n');
}

function renderPatchContext(context: PromptContext): string {
  const patch = context.patch;
  return [
    '## 完整 Patch 上下文',
    '',
    `- 来源：${patch.source === 'rest' ? 'Bitbucket patch API' : '页面可见 diff 降级'}`,
    patch.url ? `- Patch URL：${patch.url}` : '',
    patch.error ? `- Patch 获取错误：${patch.error}` : '',
    '',
    '```diff',
    patch.patch || '未获取到 patch 内容。',
    '```',
  ].filter((line) => line !== '').join('\n');
}

function renderCommentContext(context: PromptContext): string {
  const comment = context.comment;
  return [
    '## 评论上下文',
    '',
    '### 评论位置',
    '',
    `- 文件路径：${comment.file.path || '未识别到文件路径'}`,
    `- 文件名：${comment.file.fileName || '未知'}`,
    `- 关注行号：${comment.file.focusLine || '未识别到行号'}`,
    comment.file.permalink ? `- 评论链接：${comment.file.permalink}` : '',
    '',
    '### 评论挂载位置的局部 Diff',
    '',
    renderLocalDiff(comment.file.localDiff),
    '',
    '### 当前评论线程',
    '',
    comment.thread.map((item) => renderComment(item)).join('\n\n'),
  ].filter((line) => line !== '').join('\n');
}

function renderTargetTask(target: CommentInfo): string {
  return [
    '## 本次需要重点分析的目标评论',
    '',
    renderComment(target),
  ].join('\n');
}

function renderComment(comment: CommentInfo): string {
  return [
    `### 评论 ${comment.id || ''}${comment.isTarget ? '（目标评论）' : ''}`.trim(),
    '',
    `- 类型：${comment.level === 'root' ? '根评论' : '回复'}`,
    `- 评论人：${comment.author || '未知'}`,
    `- 评论时间：${comment.timestamp || '未知'}`,
    '',
    '- 评论内容：',
    indent(comment.body || '（空评论）'),
  ].join('\n');
}

function renderLocalDiff(lines: LocalDiffLine[]): string {
  if (!lines.length) return '未识别到局部 diff。';
  return [
    '```diff',
    ...lines.map((line) => `${line.isTarget ? '>> ' : '   '}${line.marker} ${line.lineNumber.padEnd(10, ' ')}${line.code}`),
    '```',
  ].join('\n');
}

function formatUser(user: { name: string; displayName: string; emailAddress: string } | null): string {
  if (!user) return '未知';
  return [user.displayName, user.name, user.emailAddress].filter(Boolean).join(' / ') || '未知';
}

function indent(text: string): string {
  return text.split(/\r?\n/).map((line) => `  ${line}`).join('\n');
}
