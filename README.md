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
- 支持自定义 Prompt 模板，并通过可视化变量标签插入上下文
- 支持自定义按钮文字、按钮颜色、文字和图标颜色，以及是否显示预览按钮
- 自动跳过名为 `superman` 的机器人评论
- 配置保存到 `chrome.storage.sync`，同一个浏览器中会持续生效

## Prompt 模板

配置页提供一个可视化 Prompt 模板编辑器。模板中的动态上下文通过标签插入，标签会以胶囊样式显示在编辑器里，可以放在任意位置，也可以点击标签上的 `×` 删除。

目前有两个变量标签：

- `PR 信息`：包含 PR 标题、Overview 中的 PR 描述、页面中可见的相关 commit。生成 Prompt 时会自带清晰的 Markdown 标题结构。
- `评论信息`：包含当前 Bitbucket 登录用户、评论位置、目标评论、完整对话线程和页面中保存的相关 diff 片段。生成 Prompt 时会自带清晰的 Markdown 标题结构。

鼠标悬浮在变量标签上时，会显示这个标签包含哪些内容。生成 Prompt 时，标签会被替换为当前 PR 页面中的实际内容。

## 加载方式

1. 打开 Chrome：`chrome://extensions/`
2. 打开右上角 `开发者模式`
3. 点击 `加载已解压的扩展程序`
4. 选择本目录：`Talk to My AI`

## 配置方式

方式一：

1. 点击浏览器右上角的扩展图标
2. 在弹出的配置面板里编辑 Prompt 模板
3. 点击模板下方的变量标签，可将变量插入到光标位置
4. 在按钮设置中配置按钮文字、按钮颜色、文字和图标颜色，以及是否显示预览按钮
5. 点击 `保存设置`

方式二：

1. 在 `chrome://extensions/` 中找到 `跟我的 AI 说去吧！`
2. 点击 `详情`
3. 点击 `扩展程序选项`
4. 编辑 Prompt 模板，或点击变量标签插入变量
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
