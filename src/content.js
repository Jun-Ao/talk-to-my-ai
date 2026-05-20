(function () {
  "use strict";

  const BUTTON_MARK = "data-bpc-copy-prompt";
  const OBSERVER_DEBOUNCE_MS = 250;
  const MAX_CODE_LINES = 120;
  const DEFAULT_PROMPT_INTRO = [
    "# Bitbucket PR Review 评论分析",
    "",
    "下面是 Bitbucket Pull Request 的一段 review 评论上下文。请基于本地真实代码、相关提交和测试进行判断，不要盲目认同评论，也不要只给泛泛建议。"
  ].join("\n");
  const DEFAULT_PROMPT_TASKS = [
    "## 分析要求",
    "",
    "1. 先根据文件路径和行号定位相关代码；必要时阅读调用链、测试，以及下面列出的 commit。",
    "2. 判断评论人指出的问题是否真实存在、是否合理。",
    "3. 判断评论中隐含或明确提出的解决方向是否有效，是否会引发新的问题、破坏兼容性或遗漏边界条件。",
    "4. 如果评论是对的，请给出应如何调整代码，并拟一条简洁、自然的回复。",
    "5. 如果评论不成立，请说明原因，并拟一条简洁、礼貌、有依据的回复。",
    "6. 输出时请包含：判断结论、建议处理方式、需要改动/验证的点、推荐回复。"
  ].join("\n");
  const DEFAULT_PROMPT_OUTRO = [
    "## 输出要求",
    "",
    "请现在开始分析，并最终给出一条可以直接回复到 Bitbucket 的中文回复。"
  ].join("\n");
  const DEFAULT_PROMPT_TEMPLATE = [
    DEFAULT_PROMPT_INTRO,
    "",
    DEFAULT_PROMPT_TASKS,
    "",
    "{{PR_INFO}}",
    "",
    "{{COMMENT_INFO}}",
    "",
    DEFAULT_PROMPT_OUTRO
  ].join("\n");

  let observerTimer = null;

  function normalizePromptTemplate(config) {
    if (config && typeof config.promptTemplate === "string") return config.promptTemplate;
    return DEFAULT_PROMPT_TEMPLATE;
  }

  function readPromptTemplate() {
    const defaults = {
      promptTemplate: DEFAULT_PROMPT_TEMPLATE
    };
    const storage = globalThis.chrome && chrome.storage && chrome.storage.sync;
    if (!storage) return Promise.resolve(DEFAULT_PROMPT_TEMPLATE);

    return new Promise((resolve) => {
      try {
        storage.get(defaults, (items) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            console.warn("[Talk to My AI] Failed to read prompt template", chrome.runtime.lastError);
            resolve(DEFAULT_PROMPT_TEMPLATE);
            return;
          }
          resolve(normalizePromptTemplate(items));
        });
      } catch (error) {
        console.warn("[Talk to My AI] Failed to read prompt template", error);
        resolve(DEFAULT_PROMPT_TEMPLATE);
      }
    });
  }

  function normalizeText(value) {
    return (value || "")
      .replace(/\u200B/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeIdentity(value) {
    return normalizeText(value).toLowerCase();
  }

  function textOf(node) {
    return normalizeText(node ? node.textContent : "");
  }

  function cloneText(node, removals) {
    if (!node) return "";
    const clone = node.cloneNode(true);
    for (const selector of removals || []) {
      clone.querySelectorAll(selector).forEach((item) => item.remove());
    }
    return normalizeText(clone.textContent);
  }

  function getOriginalSavedUrl() {
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
    let comment = walker.nextNode();
    while (comment) {
      const match = comment.nodeValue.match(/\burl:\s*(\S+)/i);
      if (match) return match[1];
      comment = walker.nextNode();
    }
    return "";
  }

  function getCurrentUser() {
    const avatar = document.querySelector("#current-user");
    const trigger = avatar ? avatar.closest("a[title]") : document.querySelector(".user-dropdown-trigger[title]");
    const title = trigger ? trigger.getAttribute("title") || "" : "";
    const titleMatch = title.match(/Logged in as\s+(.+?)(?:\s+\(([^)]+)\))?$/i);

    const username = avatar ? avatar.getAttribute("data-username") || "" : "";
    const email = avatar ? avatar.getAttribute("data-emailaddress") || "" : "";
    const displayName = titleMatch ? titleMatch[1] : "";
    const alias = titleMatch ? titleMatch[2] || "" : "";

    return {
      displayName,
      username,
      alias,
      email,
      title
    };
  }

  function isCurrentUser(author, currentUser) {
    const authorKey = normalizeIdentity(author);
    const candidates = [
      currentUser.displayName,
      currentUser.username,
      currentUser.alias,
      currentUser.email,
      currentUser.email ? currentUser.email.split("@")[0] : ""
    ].map(normalizeIdentity).filter(Boolean);

    return candidates.some((candidate) => authorKey === candidate || authorKey.includes(candidate));
  }

  function getPrInfo() {
    return {
      title: getPrTitle(),
      description: getPrDescription(),
      commits: getVisibleCommits()
    };
  }

  function getPrTitle() {
    const headerTitle = textOf(document.querySelector(".pull-request-title"));
    if (headerTitle) return headerTitle;
    return normalizeText(document.title).replace(/^Pull Request\s+#\d+:\s*/i, "").replace(/\s+-\s+代码管理$/, "");
  }

  function getPrDescription() {
    const description = document.querySelector(".pull-request-description");
    if (!description) return "";
    return extractMarkupText(description);
  }

  function extractMarkupText(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll("script, style, svg, button").forEach((node) => node.remove());

    const parts = [];
    Array.from(clone.childNodes).forEach((node) => appendMarkupNode(parts, node));
    return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function appendMarkupNode(parts, node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeText(node.textContent);
      if (text) parts.push(text);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toLowerCase();
    if (tag === "br") {
      parts.push("");
      return;
    }

    if (tag === "code" && node.classList.contains("code-block")) {
      parts.push(["```", node.textContent.replace(/\u200B/g, "").trim(), "```"].join("\n"));
      return;
    }

    if (tag === "ul" || tag === "ol") {
      Array.from(node.children).forEach((child, index) => {
        if (child.tagName && child.tagName.toLowerCase() === "li") {
          const prefix = tag === "ol" ? `${index + 1}. ` : "- ";
          parts.push(prefix + extractInlineText(child));
        }
      });
      return;
    }

    if (tag === "p" || tag === "div") {
      const blockText = extractInlineText(node);
      if (blockText) parts.push(blockText);
      return;
    }

    const text = extractInlineText(node);
    if (text) parts.push(text);
  }

  function extractInlineText(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll("script, style, svg, button").forEach((item) => item.remove());
    clone.querySelectorAll("br").forEach((item) => item.replaceWith("\n"));
    return clone.textContent.replace(/\u200B/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").trim();
  }

  function getVisibleCommits() {
    const commits = [];
    const seen = new Set();
    const links = Array.from(document.querySelectorAll([
      ".commit-hash a[href*='/commits/']",
      "a[aria-label^='Navigate to commit']",
      "a[data-commitid]"
    ].join(",")));

    links.forEach((link) => {
      const commit = commitFromLink(link);
      const key = commit.fullHash || commit.shortHash;
      if (!key || seen.has(key)) return;
      seen.add(key);
      commits.push(commit);
    });

    return commits.slice(0, 30);
  }

  function commitFromLink(link) {
    const row = link.closest("tr");
    const activity = link.closest(".activity-item");
    const fullHash = link.getAttribute("data-commitid") || extractCommitHashFromHref(link.href);
    const shortHash = textOf(link) || (fullHash ? fullHash.slice(0, 12) : "");
    const author = textOf(row ? row.querySelector(".commit-author-cell .user-name") : null)
      || textOf(activity ? activity.querySelector(".user-name") : null);
    const message = textOf(row ? row.querySelector(".commit-message-cell .message-subject") : null)
      || extractCommitMessageFromActivity(activity, shortHash);
    const date = textOf(row ? row.querySelector(".commit-date-cell time") : null)
      || textOf(activity ? activity.querySelector("time") : null);

    return {
      shortHash,
      fullHash,
      author,
      message,
      date
    };
  }

  function extractCommitHashFromHref(href) {
    if (!href) return "";
    const match = href.match(/\/commits\/([0-9a-f]{7,40})/i);
    return match ? match[1] : "";
  }

  function extractCommitMessageFromActivity(activity, shortHash) {
    if (!activity || !shortHash) return "";
    const text = textOf(activity.querySelector(".activity-item-title"));
    return text.replace(new RegExp(`.*\\b${escapeRegExp(shortHash)}\\b\\s*`, "i"), "").trim();
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function getFileContext(thread) {
    const fileComment = thread.closest(".file-comment");
    if (!fileComment) {
      return {
        path: "",
        fileName: "",
        isOutdated: false,
        focusLine: "",
        permalink: "",
        codeLines: []
      };
    }

    const breadcrumbLink = fileComment.querySelector(".file-breadcrumbs-segment-highlighted[href]");
    const pathFromHref = breadcrumbLink ? extractPathFromDiffHref(breadcrumbLink.href) : "";
    const pathFromBreadcrumbs = extractPathFromBreadcrumbs(fileComment.querySelector(".file-breadcrumbs"));
    const path = pathFromHref || pathFromBreadcrumbs;
    const fileName = path ? path.split("/").pop() : textOf(breadcrumbLink);
    const isOutdated = Boolean(fileComment.querySelector(".outdated-lozenge"));
    const targetRow = findTargetDiffRow(thread);
    const focusLine = lineNumberFromRow(targetRow) || extractLineFromDiffHref(breadcrumbLink ? breadcrumbLink.href : "");
    const permalink = getThreadPermalink(thread);
    const codeLines = extractCodeLines(fileComment, targetRow);

    return {
      path,
      fileName,
      isOutdated,
      focusLine,
      permalink,
      codeLines
    };
  }

  function extractPathFromDiffHref(href) {
    try {
      const url = new URL(href, location.href);
      const hash = decodeURIComponent(url.hash || "").replace(/^#/, "");
      return hash.split("?")[0];
    } catch (error) {
      return "";
    }
  }

  function extractLineFromDiffHref(href) {
    if (!href) return "";
    try {
      const url = new URL(href, location.href);
      const hashLine = (url.hash.match(/[?&]t=(\d+)/) || [])[1];
      return hashLine || url.searchParams.get("t") || "";
    } catch (error) {
      return "";
    }
  }

  function extractPathFromBreadcrumbs(breadcrumbs) {
    if (!breadcrumbs) return "";
    const parts = Array.from(breadcrumbs.children)
      .filter((child) => !child.classList.contains("file-breadcrumbs-separator"))
      .map((child) => textOf(child))
      .filter(Boolean);
    return parts.join("/");
  }

  function findTargetDiffRow(thread) {
    const additionalContent = thread.closest(".additional-line-content");
    if (additionalContent) {
      const row = additionalContent.closest("tr.diff-row");
      if (row) return row;
    }
    return thread.closest("tr.diff-row");
  }

  function lineNumberFromRow(row) {
    return row ? textOf(row.querySelector(".diff-line-number")) : "";
  }

  function getThreadPermalink(thread) {
    const permalink = thread.querySelector(".comment-permalink[href]");
    return permalink ? permalink.href : "";
  }

  function extractCodeLines(fileComment, targetRow) {
    const rows = Array.from(fileComment.querySelectorAll("tr.diff-row"));
    const targetIndex = targetRow ? rows.indexOf(targetRow) : -1;
    const limitedRows = limitRowsAroundTarget(rows, targetIndex, MAX_CODE_LINES);

    return limitedRows.map((row) => {
      const codeCell = row.querySelector("td.diff-line");
      const lineNumber = lineNumberFromRow(row);
      const code = extractCodeText(codeCell);
      const marker = row.classList.contains("added-line") || (codeCell && codeCell.classList.contains("added-line"))
        ? "+"
        : row.classList.contains("removed-line") || (codeCell && codeCell.classList.contains("removed-line"))
          ? "-"
          : " ";
      const isTarget = row === targetRow;

      return {
        lineNumber,
        marker,
        code,
        isTarget
      };
    });
  }

  function limitRowsAroundTarget(rows, targetIndex, maxLines) {
    if (rows.length <= maxLines) return rows;
    if (targetIndex < 0) return rows.slice(0, maxLines);

    const before = Math.floor(maxLines / 2);
    let start = Math.max(0, targetIndex - before);
    let end = Math.min(rows.length, start + maxLines);
    start = Math.max(0, end - maxLines);
    return rows.slice(start, end);
  }

  function extractCodeText(codeCell) {
    if (!codeCell) return "";
    const clone = codeCell.cloneNode(true);
    clone.querySelectorAll(".additional-line-content").forEach((node) => node.remove());
    return clone.textContent.replace(/\u200B/g, "").replace(/\r?\n/g, "").trimEnd();
  }

  function extractConversation(thread, clickedComment) {
    const currentUser = getCurrentUser();
    const comments = Array.from(thread.querySelectorAll(".comment[data-comment-id]"));

    return comments.map((comment, index) => {
      const author = textOf(comment.querySelector(".comment-header-text .user-name")) || textOf(comment.querySelector(".user-name"));
      const timestamp = textOf(comment.querySelector(".comment-timestamp"));
      const id = comment.getAttribute("data-comment-id") || "";
      const body = extractCommentBody(comment);
      const task = extractTaskState(comment);
      const relation = isCurrentUser(author, currentUser) ? "我" : "对方";
      const level = comment.closest("ol.replies") ? "回复" : "根评论";

      return {
        index: index + 1,
        id,
        author,
        relation,
        level,
        timestamp,
        body,
        task,
        isClicked: comment === clickedComment
      };
    });
  }

  function extractCommentBody(comment) {
    const body = comment.querySelector(".comment-body");
    return cloneText(body, [
      ".comment-actions",
      ".comment-add-reaction",
      "button",
      "svg"
    ]);
  }

  function extractTaskState(comment) {
    const task = comment.querySelector(".comment-task");
    if (!task) return "";
    const checkbox = task.querySelector("input[type='checkbox']");
    if (task.classList.contains("resolved") || (checkbox && checkbox.checked)) return "resolved";
    return "open";
  }

  function buildPrompt(thread, clickedComment, promptTemplate) {
    const pr = getPrInfo();
    const currentUser = getCurrentUser();
    const file = getFileContext(thread);
    const conversation = extractConversation(thread, clickedComment);
    const target = conversation.find((item) => item.isClicked) || conversation[0];
    const values = {
      PR_INFO: formatPrInfo(pr),
      COMMENT_INFO: formatCommentInfo(currentUser, file, target, conversation)
    };

    const template = typeof promptTemplate === "string" ? promptTemplate : DEFAULT_PROMPT_TEMPLATE;
    return renderTemplate(template, values);
  }

  function renderTemplate(template, values) {
    return String(template || "")
      .replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (match, key) => {
        return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
      })
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
  }

  function formatPrInfo(pr) {
    return [
      "## PR 信息",
      "",
      "### PR 标题",
      "",
      `- 标题：${pr.title || "未知"}`,
      "",
      "### PR 描述",
      "",
      pr.description || "未识别到 PR 描述。",
      "",
      "### 相关 Commit",
      "",
      "下面这些 commit 编号来自当前 PR 页面。必要时请在本地仓库中使用 `git show <commit>`、`git diff <commit>` 或相邻提交对比查看真实改动，再结合评论判断。",
      "",
      formatCommits(pr.commits)
    ].join("\n");
  }

  function formatCommentInfo(currentUser, file, target, conversation) {
    return [
      "## 评论信息",
      "",
      "### 当前登录用户",
      "",
      "下面这个用户是对话中的“我”：",
      "",
      formatCurrentUser(currentUser),
      "",
      "### 评论位置",
      "",
      formatCommentLocation(file),
      "",
      "### 本次点击的目标评论",
      "",
      formatConversationItem(target, 4),
      "",
      "### 完整对话线程",
      "",
      conversation.map((item) => formatConversationItem(item, 4)).join("\n\n"),
      "",
      "### 页面中保存的相关 Diff 片段",
      "",
      formatCodeLines(file.codeLines)
    ].join("\n");
  }

  function formatCurrentUser(currentUser) {
    return [
      `- 显示名：${currentUser.displayName || "未知"}`,
      `- 用户名：${currentUser.username || currentUser.alias || "未知"}`
    ].join("\n");
  }

  function formatCommentLocation(file) {
    return [
      `- 文件路径：${file.path || "未识别到文件路径"}`,
      `- 文件名：${file.fileName || "未知"}`,
      `- 关注行号：${file.focusLine || "未识别到行号"}`
    ].join("\n");
  }

  function formatCommits(commits) {
    if (!commits || commits.length === 0) return "未识别到 commit 列表。";
    return commits.map((commit, index) => {
      const hash = commit.fullHash || commit.shortHash || "未知 commit";
      const lines = [
        `${index + 1}. \`${hash}\``,
        commit.shortHash && commit.shortHash !== hash ? `   - 短 hash：\`${commit.shortHash}\`` : "",
        commit.author ? `   - 作者：${commit.author}` : "",
        commit.date ? `   - 时间：${commit.date}` : "",
        commit.message ? `   - 信息：${commit.message}` : ""
      ].filter(Boolean);
      return lines.join("\n");
    }).join("\n");
  }

  function formatConversationItem(item, headingLevel = 4) {
    if (!item) return "- 未识别到评论内容";
    const heading = "#".repeat(Math.min(Math.max(headingLevel, 1), 6));
    return [
      `${heading} 评论 ${item.index}`,
      "",
      `- 身份：${item.relation}`,
      `- 类型：${item.level}`,
      `- 评论人：${item.author || "未知作者"}`,
      `- 评论时间：${item.timestamp || "未知"}`,
      "",
      "- 评论内容：",
      indentBlock(item.body || "（空评论）")
    ].join("\n");
  }

  function indentBlock(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map((line) => `  ${line}`)
      .join("\n");
  }

  function formatCodeLines(lines) {
    if (!lines || lines.length === 0) return "未识别到 diff 代码片段。";
    return [
      "```diff",
      ...lines.map((line) => {
        const pointer = line.isTarget ? ">> " : "   ";
        const lineNumber = (line.lineNumber || "").padEnd(10, " ");
        return `${pointer}${line.marker} ${lineNumber}${line.code || ""}`;
      }),
      "```"
    ].join("\n");
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function setButtonState(button, state, label) {
    button.classList.remove("bpc-copy-prompt-button--ok", "bpc-copy-prompt-button--error");
    if (state) button.classList.add(`bpc-copy-prompt-button--${state}`);
    button.textContent = label;
  }

  async function getPromptForComment(comment) {
    const thread = comment.closest(".comments-thread") || comment;
    const promptTemplate = await readPromptTemplate();
    return buildPrompt(thread, comment, promptTemplate);
  }

  function createEyeIcon() {
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("width", "16");
    icon.setAttribute("height", "16");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");

    const eye = document.createElementNS("http://www.w3.org/2000/svg", "path");
    eye.setAttribute("d", "M2.1 12s3.4-6 9.9-6 9.9 6 9.9 6-3.4 6-9.9 6-9.9-6-9.9-6Z");
    eye.setAttribute("fill", "none");
    eye.setAttribute("stroke", "currentColor");
    eye.setAttribute("stroke-width", "2");
    eye.setAttribute("stroke-linecap", "round");
    eye.setAttribute("stroke-linejoin", "round");

    const pupil = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    pupil.setAttribute("cx", "12");
    pupil.setAttribute("cy", "12");
    pupil.setAttribute("r", "3");
    pupil.setAttribute("fill", "none");
    pupil.setAttribute("stroke", "currentColor");
    pupil.setAttribute("stroke-width", "2");

    icon.append(eye, pupil);
    return icon;
  }

  function getPreviewPanel() {
    let panel = document.querySelector(".bpc-prompt-preview-panel");
    if (panel) return panel;

    panel = document.createElement("section");
    panel.className = "bpc-prompt-preview-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Prompt 预览");
    panel.hidden = true;

    const header = document.createElement("div");
    header.className = "bpc-prompt-preview-header";

    const title = document.createElement("div");
    title.className = "bpc-prompt-preview-title";
    title.textContent = "Prompt 预览";

    const actions = document.createElement("div");
    actions.className = "bpc-prompt-preview-actions";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "bpc-prompt-preview-copy";
    copyButton.textContent = "复制";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "bpc-prompt-preview-close";
    closeButton.setAttribute("aria-label", "关闭预览");
    closeButton.textContent = "×";

    const body = document.createElement("pre");
    body.className = "bpc-prompt-preview-body";
    body.tabIndex = 0;

    copyButton.addEventListener("click", async () => {
      try {
        await copyText(body.textContent || "");
        copyButton.textContent = "已复制";
        setTimeout(() => {
          copyButton.textContent = "复制";
        }, 1400);
      } catch (error) {
        console.error("[Bitbucket PR Prompt Copier] Preview copy failed", error);
        copyButton.textContent = "复制失败";
        setTimeout(() => {
          copyButton.textContent = "复制";
        }, 1800);
      }
    });

    closeButton.addEventListener("click", () => {
      panel.hidden = true;
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) panel.hidden = true;
    });

    actions.append(copyButton, closeButton);
    header.append(title, actions);
    panel.append(header, body);
    document.body.appendChild(panel);

    return panel;
  }

  function showPromptPreview(prompt) {
    const panel = getPreviewPanel();
    const body = panel.querySelector(".bpc-prompt-preview-body");
    body.textContent = prompt;
    panel.hidden = false;
    body.scrollTop = 0;
    body.focus({ preventScroll: true });
  }

  function closePromptPreviewOnOutsideClick(event) {
    const panel = document.querySelector(".bpc-prompt-preview-panel");
    if (!panel || panel.hidden) return;
    if (panel.contains(event.target)) return;
    if (event.target.closest(".bpc-copy-prompt-control")) return;

    panel.hidden = true;
  }

  function createButton(comment) {
    const item = document.createElement("li");
    item.className = "action-item bpc-copy-prompt-item";
    item.setAttribute(BUTTON_MARK, "true");

    const control = document.createElement("span");
    control.className = "bpc-copy-prompt-control";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "bpc-copy-prompt-button bpc-copy-prompt-button--main";
    copyButton.textContent = "跟我的 AI 说去吧！";
    copyButton.title = "复制这条评论线程的 prompt";

    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.className = "bpc-copy-prompt-button bpc-copy-prompt-button--preview";
    previewButton.title = "预览 prompt";
    previewButton.setAttribute("aria-label", "预览 prompt");
    previewButton.appendChild(createEyeIcon());

    copyButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      setButtonState(copyButton, "", "生成中...");

      try {
        const prompt = await getPromptForComment(comment);
        await copyText(prompt);
        setButtonState(copyButton, "ok", "已复制");
        setTimeout(() => setButtonState(copyButton, "", "跟我的 AI 说去吧！"), 1600);
      } catch (error) {
        console.error("[Bitbucket PR Prompt Copier] Copy failed", error);
        setButtonState(copyButton, "error", "复制失败");
        setTimeout(() => setButtonState(copyButton, "", "跟我的 AI 说去吧！"), 2200);
      }
    });

    previewButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      try {
        showPromptPreview(await getPromptForComment(comment));
      } catch (error) {
        console.error("[Bitbucket PR Prompt Copier] Preview failed", error);
        showPromptPreview("生成 prompt 失败，请打开控制台查看错误。");
      }
    });

    control.append(copyButton, previewButton);
    item.appendChild(control);
    return item;
  }

  function findActionList(comment) {
    const wrapper = comment.querySelector(":scope > .comment-wrapper") || comment.querySelector(".comment-wrapper");
    return wrapper ? wrapper.querySelector(".comment-actions .action-list") : null;
  }

  function injectButtons() {
    const comments = Array.from(document.querySelectorAll(".comment[data-comment-id]"));

    comments.forEach((comment) => {
      if (comment.querySelector(`[${BUTTON_MARK}="true"]`)) return;

      const actionList = findActionList(comment);
      if (!actionList) return;

      actionList.appendChild(createButton(comment));
    });
  }

  function scheduleInject() {
    clearTimeout(observerTimer);
    observerTimer = setTimeout(injectButtons, OBSERVER_DEBOUNCE_MS);
  }

  function startObserver() {
    const observer = new MutationObserver(scheduleInject);
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function init() {
    injectButtons();
    startObserver();
    document.addEventListener("click", closePromptPreviewOnOutsideClick, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
