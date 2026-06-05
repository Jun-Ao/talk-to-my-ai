import type { CommentContext, CommentInfo, FileContext, LocalDiffLine, PullRequestInfo, UserInfo } from '../shared/types';
import { cloneText, normalizeIdentity, normalizeText, textOf } from '../shared/normalize';
import { normalizeUser, parsePullRequestPath, pullRequestFromInitialData, readInitialData } from './initialData';

export type PageContext = {
  currentUser: UserInfo | null;
  pullRequest: PullRequestInfo;
};

export function getPageContext(document: Document, location: Location): PageContext {
  const initialData = readInitialData(document);
  const initialPr = pullRequestFromInitialData(initialData, location);
  const fallbackPr = pullRequestFromDom(document, location);
  return {
    currentUser: normalizeUser(initialData?.currentUser) || currentUserFromDom(document),
    pullRequest: initialPr || fallbackPr,
  };
}

function pullRequestFromDom(document: Document, location: Location): PullRequestInfo {
  const pathInfo = parsePullRequestPath(location.pathname);
  const title = textOf(document.querySelector('.pull-request-title')).replace(/^Pull Request\s+#\d+:\s*/i, '') ||
    normalizeText(document.title).replace(/^Pull Request\s+#\d+:\s*/i, '').replace(/\s+-\s+代码管理$/, '');
  const description = extractMarkupText(document.querySelector('.pull-request-description'));
  return {
    id: pathInfo.prId,
    title,
    description,
    author: null,
    projectKey: pathInfo.projectKey,
    repoSlug: pathInfo.repoSlug,
    sourceBranch: '',
    targetBranch: '',
    url: location.href,
  };
}

function currentUserFromDom(document: Document): UserInfo | null {
  const avatar = document.querySelector('#current-user');
  if (!avatar) return null;
  const trigger = avatar.closest('a[title]');
  const title = trigger?.getAttribute('title') || '';
  const titleMatch = title.match(/(?:Logged in as|登录作为)\s+(.+?)(?:\s+\(([^)]+)\))?$/i);
  return {
    name: avatar.getAttribute('data-username') || titleMatch?.[2] || '',
    displayName: titleMatch?.[1] || '',
    slug: '',
    emailAddress: avatar.getAttribute('data-emailaddress') || '',
  };
}

export function shouldShowEntry(comment: Element, page: PageContext): boolean {
  const author = getCommentAuthor(comment);
  if (normalizeIdentity(author) === 'superman') return false;
  if (isSameUser(author, page.currentUser)) return false;
  if (isSameUser(author, page.pullRequest.author)) return false;
  return true;
}

function isSameUser(author: string, user: UserInfo | null): boolean {
  if (!user) return false;
  const authorKey = normalizeIdentity(author);
  const candidates = [
    user.name,
    user.displayName,
    user.slug,
    user.emailAddress,
    user.emailAddress ? user.emailAddress.split('@')[0] : '',
  ].map(normalizeIdentity).filter(Boolean);
  return candidates.some((candidate) => authorKey === candidate || authorKey.includes(candidate));
}

export function getCommentAuthor(comment: Element): string {
  return textOf(comment.querySelector('.comment-header-text .user-name')) || textOf(comment.querySelector('.user-name'));
}

export function getCommentContext(comment: Element): CommentContext {
  const threadElement = comment.closest('.comments-thread') || comment;
  const comments = Array.from(threadElement.querySelectorAll('.comment[data-comment-id]'));
  const thread = comments.map((item, index) => commentInfoFromElement(item, item === comment, index));
  const targetComment = thread.find((item) => item.isTarget) || thread[0];
  return {
    targetCommentId: targetComment?.id || '',
    targetComment,
    thread,
    file: getFileContext(threadElement),
  };
}

function commentInfoFromElement(comment: Element, isTarget: boolean, index: number): CommentInfo {
  const authorLink = comment.querySelector('.comment-header-text .user-name a[href], .user-name a[href]');
  const href = authorLink?.getAttribute('href') || '';
  return {
    id: comment.getAttribute('data-comment-id') || '',
    author: getCommentAuthor(comment),
    authorSlug: href.split('/').filter(Boolean).pop() || '',
    timestamp: textOf(comment.querySelector('.comment-timestamp')),
    body: cloneText(comment.querySelector('.comment-body'), ['.comment-actions', '.comment-add-reaction', 'button', 'svg']),
    level: comment.closest('ol.replies') ? 'reply' : 'root',
    isTarget,
  };
}

function getFileContext(thread: Element): FileContext {
  const fileComment = thread.closest('.file-comment');
  if (!fileComment) {
    return { path: '', fileName: '', focusLine: '', permalink: getThreadPermalink(thread), localDiff: [] };
  }

  const breadcrumbLink = fileComment.querySelector<HTMLAnchorElement>('.file-breadcrumbs-segment-highlighted[href]');
  const path = extractPathFromDiffHref(breadcrumbLink?.href || '') || extractPathFromBreadcrumbs(fileComment.querySelector('.file-breadcrumbs'));
  const targetRow = findTargetDiffRow(thread);
  const focusLine = lineNumberFromRow(targetRow) || extractLineFromDiffHref(breadcrumbLink?.href || '');
  return {
    path,
    fileName: path ? path.split('/').pop() || '' : textOf(breadcrumbLink),
    focusLine,
    permalink: getThreadPermalink(thread),
    localDiff: extractCodeLines(fileComment, targetRow),
  };
}

function extractPathFromDiffHref(href: string): string {
  if (!href) return '';
  try {
    const url = new URL(href, location.href);
    return decodeURIComponent(url.hash || '').replace(/^#/, '').split('?')[0];
  } catch {
    return '';
  }
}

function extractLineFromDiffHref(href: string): string {
  if (!href) return '';
  try {
    const url = new URL(href, location.href);
    return (url.hash.match(/[?&]t=(\d+)/) || [])[1] || url.searchParams.get('t') || '';
  } catch {
    return '';
  }
}

function extractPathFromBreadcrumbs(breadcrumbs: Element | null): string {
  if (!breadcrumbs) return '';
  return Array.from(breadcrumbs.children)
    .filter((child) => !child.classList.contains('file-breadcrumbs-separator'))
    .map((child) => textOf(child))
    .filter(Boolean)
    .join('/');
}

function findTargetDiffRow(thread: Element): Element | null {
  return thread.closest('.additional-line-content')?.closest('tr.diff-row') || thread.closest('tr.diff-row');
}

function lineNumberFromRow(row: Element | null): string {
  return textOf(row?.querySelector('.diff-line-number'));
}

function getThreadPermalink(thread: Element): string {
  return (thread.querySelector<HTMLAnchorElement>('.comment-permalink[href]')?.href) || '';
}

function extractCodeLines(fileComment: Element, targetRow: Element | null): LocalDiffLine[] {
  const rows = Array.from(fileComment.querySelectorAll('tr.diff-row'));
  return rows.map((row) => {
    const codeCell = row.querySelector('td.diff-line');
    const isAdded = row.classList.contains('added-line') || Boolean(codeCell?.classList.contains('added-line'));
    const isRemoved = row.classList.contains('removed-line') || Boolean(codeCell?.classList.contains('removed-line'));
    return {
      lineNumber: lineNumberFromRow(row),
      marker: isAdded ? '+' : isRemoved ? '-' : ' ',
      code: extractCodeText(codeCell),
      isTarget: row === targetRow,
    };
  });
}

function extractCodeText(codeCell: Element | null): string {
  if (!codeCell) return '';
  const clone = codeCell.cloneNode(true) as Element;
  clone.querySelectorAll('.additional-line-content').forEach((node) => node.remove());
  return (clone.textContent || '').replace(/\u200B/g, '').replace(/\r?\n/g, '').trimEnd();
}

function extractMarkupText(root: Element | null): string {
  if (!root) return '';
  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll('script, style, svg, button').forEach((node) => node.remove());
  clone.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
  return (clone.textContent || '').replace(/\u200B/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim();
}
