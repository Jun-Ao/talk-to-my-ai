# 跟我的 AI 说去吧！

这是一个面向 Bitbucket Pull Request 代码评审场景的 Chrome 扩展。

在处理 PR review 评论时，我们经常需要把评论内容、评论位置、相关代码片段、PR 描述、commit 信息等上下文整理出来，再交给 AI 帮忙判断评论是否成立、该如何修改、以及应该怎样回复。手动复制这些信息很繁琐，也容易漏掉关键上下文。

这个插件会在 Bitbucket PR 评论旁生成快捷操作，把当前评论线程和相关 PR 上下文自动整理成一段可配置的 Prompt。你可以一键复制给 AI，也可以先预览内容再决定是否复制，从而减少来回翻页面、复制路径、整理 diff 和拼 prompt 的时间。

## 功能概览

- 在 PR 评论旁添加 `跟我的 AI 说去吧！` 操作按钮
- 一键复制当前评论线程对应的 AI Prompt
- 支持预览 Prompt，点击页面其他位置会自动关闭预览
- 自动识别当前 Bitbucket 登录用户，用来区分“我”和“对方”
- 自动提取 PR 标题、PR 描述、相关 commit、评论位置、评论对话和 diff 片段
- 支持自定义 Prompt 模板，并使用变量标签插入上下文
- 配置保存到 `chrome.storage.sync`，同一个浏览器中会持续生效

## Prompt 模板

插件会自动生成两类上下文变量：

- `{{PR_INFO}}`：PR 信息，展开后自带 `## PR 信息` 标题，包含 PR 标题、Overview 中的 PR 描述、页面中可见的 commit 信息
- `{{COMMENT_INFO}}`：评论信息，展开后自带 `## 评论信息` 标题，包含当前 Bitbucket 登录用户、评论位置、目标评论、完整对话和 diff 片段

你可以在配置页中编辑完整 Prompt 模板，自由调整文字和变量顺序，也可以删除不需要的变量。变量在编辑器中会显示为标签，点击标签上的 `×` 可以删除。

## 加载方式

1. 打开 Chrome：`chrome://extensions/`
2. 打开右上角 `开发者模式`
3. 点击 `加载已解压的扩展程序`
4. 选择本目录：`Talk to My AI`

## 配置方式

方式一：

1. 点击浏览器右上角的扩展图标
2. 在弹出的配置面板里编辑完整 Prompt 模板
3. 点击下方变量标签，可将变量插入到光标位置
4. 点击 `保存设置`

方式二：

1. 在 `chrome://extensions/` 中找到 `跟我的 AI 说去吧！`
2. 点击 `详情`
3. 点击 `扩展程序选项`
4. 编辑完整 Prompt 模板，或点击变量标签插入变量
5. 点击 `保存设置`

## 本地 HTML 测试

`manifest.json` 已包含 `file:///*`，方便测试 SingleFile 保存的页面。

如果要让扩展作用于本地 `case1.html`：

1. 在 `chrome://extensions/` 里找到本扩展
2. 打开 `允许访问文件网址`
3. 用 Chrome 打开 `case1.html`

## 适配说明

当前实现适配 Bitbucket Server / Data Center 的 PR 页面结构，核心选择器包括：

- `.comments-thread`
- `.comment[data-comment-id]`
- `.file-comment`
- `.file-breadcrumbs`
- `tr.diff-row`
- `#current-user`

页面异步更新时，扩展会通过 `MutationObserver` 自动给新出现的评论补按钮。
