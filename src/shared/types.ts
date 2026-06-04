export type DeepSeekModel = 'deepseek-v4-pro' | 'deepseek-v4-flash';

export type UserInfo = {
  name: string;
  displayName: string;
  slug: string;
  emailAddress: string;
};

export type PullRequestInfo = {
  id: string;
  title: string;
  description: string;
  author: UserInfo | null;
  projectKey: string;
  repoSlug: string;
  sourceBranch: string;
  targetBranch: string;
  url: string;
};

export type CommentInfo = {
  id: string;
  author: string;
  authorSlug: string;
  timestamp: string;
  body: string;
  level: 'root' | 'reply';
  isTarget: boolean;
};

export type LocalDiffLine = {
  lineNumber: string;
  marker: '+' | '-' | ' ';
  code: string;
  isTarget: boolean;
};

export type FileContext = {
  path: string;
  fileName: string;
  focusLine: string;
  permalink: string;
  localDiff: LocalDiffLine[];
};

export type CommentContext = {
  targetCommentId: string;
  targetComment: CommentInfo;
  thread: CommentInfo[];
  file: FileContext;
};

export type PatchContext = {
  patch: string;
  source: 'rest' | 'visible-diff';
  url: string;
  error?: string;
};

export type PromptContext = {
  currentUser: UserInfo | null;
  pullRequest: PullRequestInfo;
  comment: CommentContext;
  patch: PatchContext;
};

export type DeepSeekUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
};

export type AnalyzeResult = {
  content: string;
  usage?: DeepSeekUsage;
};

export type AnalyzeMessageRequest = {
  type: 'analyze';
  requestId: string;
  prompt: string;
};

export type AbortAnalyzeMessage = {
  type: 'abortAnalyze';
  requestId: string;
};

export type TestDeepSeekMessage = {
  type: 'testDeepSeek';
  apiKey: string;
  model: DeepSeekModel;
};

export type OpenOptionsMessage = {
  type: 'openOptions';
};

export type BackgroundMessage = AnalyzeMessageRequest | AbortAnalyzeMessage | TestDeepSeekMessage | OpenOptionsMessage;
