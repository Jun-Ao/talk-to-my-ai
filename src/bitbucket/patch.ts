import type { FileContext, PatchContext, PullRequestInfo } from '../shared/types';

export async function fetchPatchContext(pullRequest: PullRequestInfo, file: FileContext, origin: string): Promise<PatchContext> {
  const url = buildPatchUrl(pullRequest, origin);
  if (!url) {
    return { patch: visibleDiffFallback(file), source: 'visible-diff', url: '', error: 'Unable to build patch URL' };
  }

  try {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return { patch: await response.text(), source: 'rest', url };
  } catch (error) {
    return {
      patch: visibleDiffFallback(file),
      source: 'visible-diff',
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildPatchUrl(pullRequest: PullRequestInfo, origin: string): string {
  if (!pullRequest.projectKey || !pullRequest.repoSlug || !pullRequest.id) return '';
  return `${origin}/rest/patch/1.0/projects/${encodeURIComponent(pullRequest.projectKey)}/repos/${encodeURIComponent(pullRequest.repoSlug)}/pull-requests/${encodeURIComponent(pullRequest.id)}/patch`;
}

function visibleDiffFallback(file: FileContext): string {
  if (!file.localDiff.length) return '';
  return [
    `diff -- ${file.path || file.fileName || 'unknown file'}`,
    ...file.localDiff.map((line) => `${line.marker}${line.code}`),
  ].join('\n');
}
