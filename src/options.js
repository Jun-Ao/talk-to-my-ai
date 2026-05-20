(function () {
  "use strict";

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

  const VARIABLES = [
    { label: "PR 信息", value: "{{PR_INFO}}" },
    { label: "评论信息", value: "{{COMMENT_INFO}}" }
  ];

  const templateEditor = document.querySelector("#promptTemplateEditor");
  const hiddenTemplateField = document.querySelector("#promptTemplate");
  const statusText = document.querySelector("#statusText");
  const variableList = document.querySelector("#variableList");

  function storageGet(defaults) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(defaults, (items) => {
        if (chrome.runtime.lastError) {
          setStatus("读取设置失败，已显示默认值。");
          resolve(defaults);
          return;
        }
        resolve(items);
      });
    });
  }

  function storageSet(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set(items, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve();
      });
    });
  }

  function setStatus(message) {
    statusText.textContent = message;
    if (message) {
      setTimeout(() => {
        if (statusText.textContent === message) statusText.textContent = "";
      }, 2400);
    }
  }

  function createToken(variable) {
    const token = document.createElement("span");
    token.className = "template-token";
    token.contentEditable = "false";
    token.dataset.variable = variable.value;
    token.title = variable.value;

    const label = document.createElement("span");
    label.className = "template-token-label";
    label.textContent = variable.label;

    const remove = document.createElement("span");
    remove.className = "template-token-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-hidden", "true");

    token.append(label, remove);
    return token;
  }

  function variableByValue(value) {
    return VARIABLES.find((variable) => variable.value === value);
  }

  function tokenFromPlaceholder(value) {
    return createToken(variableByValue(value) || { label: value.replace(/[{}]/g, ""), value });
  }

  function renderTemplate(template) {
    templateEditor.textContent = "";
    const pattern = /\{\{\s*([A-Z_]+)\s*\}\}/g;
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(template)) !== null) {
      if (match.index > lastIndex) {
        templateEditor.appendChild(document.createTextNode(template.slice(lastIndex, match.index)));
      }
      templateEditor.appendChild(tokenFromPlaceholder(`{{${match[1]}}}`));
      lastIndex = pattern.lastIndex;
    }

    if (lastIndex < template.length) {
      templateEditor.appendChild(document.createTextNode(template.slice(lastIndex)));
    }
  }

  function serializeEditor() {
    return serializeNodes(templateEditor.childNodes).replace(/\u00a0/g, " ");
  }

  function serializeNodes(nodes) {
    let result = "";
    nodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        result += node.nodeValue;
      } else if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("template-token")) {
        result += node.dataset.variable || "";
      } else if (node.nodeName === "BR") {
        result += "\n";
      } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "DIV") {
        if (result && !result.endsWith("\n")) result += "\n";
        result += serializeNodes(node.childNodes);
        if (!result.endsWith("\n")) result += "\n";
      } else {
        result += node.childNodes && node.childNodes.length > 0
          ? serializeNodes(node.childNodes)
          : node.textContent;
      }
    });
    return result;
  }

  function syncHiddenField() {
    hiddenTemplateField.value = serializeEditor();
  }

  function placeCursorAfter(node) {
    const range = document.createRange();
    const selection = window.getSelection();
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function insertAtCursor(variable) {
    templateEditor.focus();

    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0
      ? selection.getRangeAt(0)
      : document.createRange();

    if (!templateEditor.contains(range.commonAncestorContainer)) {
      range.selectNodeContents(templateEditor);
      range.collapse(false);
    }

    const token = createToken(variable);
    const space = document.createTextNode(" ");
    range.deleteContents();
    range.insertNode(space);
    range.insertNode(token);
    placeCursorAfter(space);
    syncHiddenField();
  }

  function renderVariables() {
    variableList.textContent = "";
    VARIABLES.forEach((variable) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "variable-chip";
      button.textContent = variable.label;
      button.title = `插入 ${variable.value}`;
      button.addEventListener("click", () => insertAtCursor(variable));
      variableList.appendChild(button);
    });
  }

  async function loadOptions() {
    const items = await storageGet({ promptTemplate: DEFAULT_PROMPT_TEMPLATE });
    renderTemplate(typeof items.promptTemplate === "string" ? items.promptTemplate : DEFAULT_PROMPT_TEMPLATE);
    syncHiddenField();
  }

  async function saveOptions() {
    try {
      syncHiddenField();
      await storageSet({ promptTemplate: hiddenTemplateField.value });
      setStatus("已保存。");
    } catch (error) {
      console.error("[Talk to My AI] Failed to save options", error);
      setStatus("保存失败。");
    }
  }

  async function resetOptions() {
    renderTemplate(DEFAULT_PROMPT_TEMPLATE);
    syncHiddenField();
    try {
      await storageSet({ promptTemplate: DEFAULT_PROMPT_TEMPLATE });
      setStatus("已恢复默认。");
    } catch (error) {
      console.error("[Talk to My AI] Failed to reset options", error);
      setStatus("恢复失败。");
    }
  }

  renderVariables();
  templateEditor.addEventListener("input", syncHiddenField);
  templateEditor.addEventListener("click", (event) => {
    const remove = event.target.closest(".template-token-remove");
    if (!remove) return;

    const token = remove.closest(".template-token");
    token.remove();
    syncHiddenField();
    templateEditor.focus();
  });
  templateEditor.addEventListener("paste", (event) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
    syncHiddenField();
  });
  document.querySelector("#saveButton").addEventListener("click", saveOptions);
  document.querySelector("#resetButton").addEventListener("click", resetOptions);
  document.addEventListener("DOMContentLoaded", loadOptions);
})();
