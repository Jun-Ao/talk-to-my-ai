import type { PullRequestInfo, UserInfo } from '../shared/types';

type InitialData = {
  currentUser?: BitbucketUser;
  repository?: BitbucketRepository;
  pullRequest?: BitbucketPullRequest;
};

type BitbucketUser = {
  name?: string;
  displayName?: string;
  slug?: string;
  emailAddress?: string;
};

type BitbucketRepository = {
  slug?: string;
  project?: { key?: string };
};

type BitbucketPullRequest = {
  id?: number | string;
  title?: string;
  description?: string;
  author?: { user?: BitbucketUser };
  fromRef?: { displayId?: string };
  toRef?: { displayId?: string; repository?: BitbucketRepository };
  links?: { self?: Array<{ href?: string }> };
};

export function readInitialData(document: Document): InitialData | null {
  const scripts = Array.from(document.scripts);
  for (const script of scripts) {
    const text = script.textContent || '';
    const marker = "define('@bitbucket/apps/pull-requests/initial-data'";
    const markerIndex = text.indexOf(marker);
    if (markerIndex < 0) continue;

    const objectStart = text.indexOf('{', markerIndex);
    if (objectStart < 0) continue;

    const objectText = extractBalancedObject(text, objectStart);
    if (!objectText) continue;

    try {
      return Function(`"use strict"; return (${objectText});`)() as InitialData;
    } catch (error) {
      console.warn('[Talk to My AI] Failed to parse Bitbucket initial-data', error);
    }
  }
  return null;
}

function extractBalancedObject(text: string, start: number): string {
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return '';
}

export function normalizeUser(user?: BitbucketUser | null): UserInfo | null {
  if (!user) return null;
  return {
    name: user.name || '',
    displayName: user.displayName || '',
    slug: user.slug || '',
    emailAddress: user.emailAddress || '',
  };
}

export function pullRequestFromInitialData(data: InitialData | null, location: Location): PullRequestInfo | null {
  const pr = data?.pullRequest;
  if (!pr) return null;

  const pathInfo = parsePullRequestPath(location.pathname);
  const repository = pr.toRef?.repository || data?.repository;
  const projectKey = repository?.project?.key || pathInfo.projectKey;
  const repoSlug = repository?.slug || pathInfo.repoSlug;
  const id = String(pr.id || pathInfo.prId || '');

  return {
    id,
    title: pr.title || '',
    description: pr.description || '',
    author: normalizeUser(pr.author?.user),
    projectKey,
    repoSlug,
    sourceBranch: pr.fromRef?.displayId || '',
    targetBranch: pr.toRef?.displayId || '',
    url: pr.links?.self?.[0]?.href || location.href,
  };
}

export function parsePullRequestPath(pathname: string): {
  kind: 'projects' | 'users' | '';
  projectKey: string;
  repoSlug: string;
  prId: string;
  userSlug: string;
} {
  const projectMatch = pathname.match(/\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)/i);
  if (projectMatch) {
    return {
      kind: 'projects',
      projectKey: decodeURIComponent(projectMatch[1]),
      repoSlug: decodeURIComponent(projectMatch[2]),
      prId: projectMatch[3],
      userSlug: '',
    };
  }

  const userMatch = pathname.match(/\/users\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)/i);
  if (userMatch) {
    const userSlug = decodeURIComponent(userMatch[1]);
    return {
      kind: 'users',
      projectKey: `~${userSlug.toUpperCase()}`,
      repoSlug: decodeURIComponent(userMatch[2]),
      prId: userMatch[3],
      userSlug,
    };
  }

  return { kind: '', projectKey: '', repoSlug: '', prId: '', userSlug: '' };
}
