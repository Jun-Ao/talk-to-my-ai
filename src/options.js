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
  const DEFAULT_BUTTON_OPTIONS = {
    buttonLabel: "跟我的 AI 说去吧！",
    buttonBackgroundColor: "#0747a6",
    buttonTextColor: "#ffffff",
    showPreviewButton: true
  };
  const BUTTON_BACKGROUND_COLORS = [
    { label: "Bitbucket 蓝", value: "#0747a6" },
    { label: "亮蓝", value: "#0052cc" },
    { label: "绿色", value: "#00875a" },
    { label: "紫色", value: "#6554c0" },
    { label: "红色", value: "#bf2600" },
    { label: "深灰", value: "#42526e" }
  ];
  const BUTTON_TEXT_COLORS = [
    { label: "白色", value: "#ffffff" },
    { label: "深蓝灰", value: "#172b4d" },
    { label: "Bitbucket 蓝", value: "#0747a6" },
    { label: "绿色", value: "#006644" },
    { label: "红色", value: "#bf2600" },
    { label: "灰色", value: "#42526e" }
  ];

  const VARIABLES = [
    {
      label: "PR 信息",
      value: "{{PR_INFO}}",
      description: "包含 PR 标题、PR 描述，以及页面可见的相关 commit 哈希、作者和提交说明。"
    },
    {
      label: "评论信息",
      value: "{{COMMENT_INFO}}",
      description: "包含当前登录用户、评论位置、目标评论、完整对话线程，以及页面中保存的相关 diff 片段。"
    }
  ];

  const templateEditor = document.querySelector("#promptTemplateEditor");
  const hiddenTemplateField = document.querySelector("#promptTemplate");
  const statusText = document.querySelector("#statusText");
  const variableList = document.querySelector("#variableList");
  const buttonLabelField = document.querySelector("#buttonLabel");
  const buttonBackgroundChoices = document.querySelector("#buttonBackgroundChoices");
  const buttonBackgroundColorInput = document.querySelector("#buttonBackgroundColorInput");
  const buttonTextColorChoices = document.querySelector("#buttonTextColorChoices");
  const buttonTextColorInput = document.querySelector("#buttonTextColorInput");
  const showPreviewButtonField = document.querySelector("#showPreviewButton");

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

  function normalizeColor(value, fallback) {
    const raw = String(value || "").trim();
    const hexMatch = raw.match(/^#?([0-9a-f]{6})$/i);
    if (hexMatch) return `#${hexMatch[1].toLowerCase()}`;

    const rgbMatch = raw.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i) ||
      raw.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
    if (rgbMatch) {
      const channels = rgbMatch.slice(1, 4).map((part) => Number(part));
      if (channels.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)) {
        return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
      }
    }

    return fallback;
  }

  function normalizeButtonLabel(value) {
    const label = String(value || "").replace(/\s+/g, " ").trim();
    return label || DEFAULT_BUTTON_OPTIONS.buttonLabel;
  }

  function normalizeButtonOptions(items) {
    return {
      buttonLabel: normalizeButtonLabel(items && items.buttonLabel),
      buttonBackgroundColor: normalizeColor(
        items && items.buttonBackgroundColor,
        DEFAULT_BUTTON_OPTIONS.buttonBackgroundColor
      ),
      buttonTextColor: normalizeColor(items && items.buttonTextColor, DEFAULT_BUTTON_OPTIONS.buttonTextColor),
      showPreviewButton: items && typeof items.showPreviewButton === "boolean"
        ? items.showPreviewButton
        : DEFAULT_BUTTON_OPTIONS.showPreviewButton
    };
  }

  function renderColorChoices(container, input, colors) {
    container.textContent = "";
    colors.forEach((color) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "color-choice";
      button.dataset.color = color.value;
      button.style.setProperty("--choice-color", color.value);
      button.title = color.label;
      button.setAttribute("aria-label", color.label);
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => setColorField(container, input, color.value));
      container.appendChild(button);
    });
  }

  function selectColor(container, value) {
    const normalized = normalizeColor(value, "").toLowerCase();
    container.querySelectorAll(".color-choice").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.color.toLowerCase() === normalized ? "true" : "false");
    });
  }

  function setColorField(container, input, value) {
    const normalized = normalizeColor(value, input.value || "");
    input.value = normalized;
    input.setAttribute("aria-invalid", normalized ? "false" : "true");
    selectColor(container, normalized);
  }

  function handleColorInput(container, input) {
    const normalized = normalizeColor(input.value, "");
    input.setAttribute("aria-invalid", input.value.trim() && !normalized ? "true" : "false");
    selectColor(container, normalized);
  }

  function selectedColor(container, input, fallback) {
    const normalizedInput = normalizeColor(input.value, "");
    if (normalizedInput) return normalizedInput;

    const selected = container.querySelector('.color-choice[aria-pressed="true"]');
    return normalizeColor(selected && selected.dataset.color, fallback);
  }

  function setButtonOptions(options) {
    const nextOptions = normalizeButtonOptions(options);
    buttonLabelField.value = nextOptions.buttonLabel;
    showPreviewButtonField.checked = nextOptions.showPreviewButton;
    setColorField(buttonBackgroundChoices, buttonBackgroundColorInput, nextOptions.buttonBackgroundColor);
    setColorField(buttonTextColorChoices, buttonTextColorInput, nextOptions.buttonTextColor);
  }

  function getButtonOptions() {
    return {
      buttonLabel: normalizeButtonLabel(buttonLabelField.value),
      buttonBackgroundColor: selectedColor(
        buttonBackgroundChoices,
        buttonBackgroundColorInput,
        DEFAULT_BUTTON_OPTIONS.buttonBackgroundColor
      ),
      buttonTextColor: selectedColor(
        buttonTextColorChoices,
        buttonTextColorInput,
        DEFAULT_BUTTON_OPTIONS.buttonTextColor
      ),
      showPreviewButton: showPreviewButtonField.checked
    };
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
    VARIABLES.forEach((variable, index) => {
      const wrapper = document.createElement("span");
      wrapper.className = "variable-chip-wrap";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "variable-chip";
      button.textContent = variable.label;
      button.title = variable.description;
      button.setAttribute("aria-describedby", `variable-tooltip-${index}`);
      button.addEventListener("click", () => insertAtCursor(variable));

      const tooltip = document.createElement("span");
      tooltip.id = `variable-tooltip-${index}`;
      tooltip.className = "variable-tooltip";
      tooltip.setAttribute("role", "tooltip");
      tooltip.textContent = variable.description;

      wrapper.append(button, tooltip);
      variableList.appendChild(wrapper);
    });
  }

  async function loadOptions() {
    const items = await storageGet({
      promptTemplate: DEFAULT_PROMPT_TEMPLATE,
      ...DEFAULT_BUTTON_OPTIONS
    });
    renderTemplate(typeof items.promptTemplate === "string" ? items.promptTemplate : DEFAULT_PROMPT_TEMPLATE);
    setButtonOptions(items);
    syncHiddenField();
  }

  async function saveOptions() {
    try {
      syncHiddenField();
      await storageSet({
        promptTemplate: hiddenTemplateField.value,
        ...getButtonOptions()
      });
      setStatus("已保存。");
    } catch (error) {
      console.error("[Talk to My AI] Failed to save options", error);
      setStatus("保存失败。");
    }
  }

  async function resetOptions() {
    renderTemplate(DEFAULT_PROMPT_TEMPLATE);
    setButtonOptions(DEFAULT_BUTTON_OPTIONS);
    syncHiddenField();
    try {
      await storageSet({
        promptTemplate: DEFAULT_PROMPT_TEMPLATE,
        ...DEFAULT_BUTTON_OPTIONS
      });
      setStatus("已恢复默认。");
    } catch (error) {
      console.error("[Talk to My AI] Failed to reset options", error);
      setStatus("恢复失败。");
    }
  }

  renderColorChoices(buttonBackgroundChoices, buttonBackgroundColorInput, BUTTON_BACKGROUND_COLORS);
  renderColorChoices(buttonTextColorChoices, buttonTextColorInput, BUTTON_TEXT_COLORS);
  renderVariables();
  buttonBackgroundColorInput.addEventListener("input", () => {
    handleColorInput(buttonBackgroundChoices, buttonBackgroundColorInput);
  });
  buttonBackgroundColorInput.addEventListener("blur", () => {
    setColorField(
      buttonBackgroundChoices,
      buttonBackgroundColorInput,
      selectedColor(buttonBackgroundChoices, buttonBackgroundColorInput, DEFAULT_BUTTON_OPTIONS.buttonBackgroundColor)
    );
  });
  buttonTextColorInput.addEventListener("input", () => {
    handleColorInput(buttonTextColorChoices, buttonTextColorInput);
  });
  buttonTextColorInput.addEventListener("blur", () => {
    setColorField(
      buttonTextColorChoices,
      buttonTextColorInput,
      selectedColor(buttonTextColorChoices, buttonTextColorInput, DEFAULT_BUTTON_OPTIONS.buttonTextColor)
    );
  });
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
