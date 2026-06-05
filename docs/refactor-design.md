# WXT + React 重构设计

## 背景

当前项目是一个面向 Bitbucket Server / Data Center Pull Request review 场景的 Chrome 扩展。旧实现是纯静态 Manifest V3 扩展，核心逻辑集中在 `src/content.js` 和 `src/options.js` 中，职责混杂，缺少构建体系和类型边界。新版将进行大幅重构，目标是在保留“跟我的 AI 说去吧！”核心体验的基础上，引入 WXT、React、TypeScript，并支持 DeepSeek 直接分析评论。

## 技术选型

- 框架：WXT
- UI：React
- 语言：TypeScript
- 包管理器：pnpm
- UI 组件：不引入 Atlaskit，使用自定义 React 组件 + CSS 实现 Atlassian 风格
- 自动化测试：第一版暂不引入，先手动验证
- 开发分支：`refactor/wxt-react-redesign`

## Manifest 与页面匹配

### Content script 匹配范围

不再支持 `file:///*`。

保留通用 Bitbucket Server / Data Center 匹配，并新增个人仓库 PR 支持：

```text
*://*/projects/*/repos/*/pull-requests/*
*://*/users/*/repos/*/pull-requests/*
```

### 生效页面

- Overview 页：发现评论 DOM 时注入入口
- Diff 页：发现评论 DOM 时注入入口
- Commits / Builds 等页面：不主动显示入口；如果没有评论 DOM 则不注入

不依赖 tab 名称硬编码，主要以是否发现可处理评论为准。

## 视觉设计

视觉根据 `~/atlassian-DESIGN.md` 重构，整体贴近 Atlassian / Bitbucket 风格。

### 设计 token

- Primary：`#0052CC`
- Primary hover / Bitbucket blue：`#0747A6`
- Text：`#172B4D`
- Muted text：`#6B778C`
- Canvas：`#ffffff`
- Surface：`#F4F5F7` / `#EBECF0`
- Border：`#DFE1E6`
- Success：`#00875A`
- Warning：`#FF8B00`
- Danger：`#DE350B`
- Discovery：`#6554C0`

### UI 原则

- 企业工具风格，信息密度适中
- 14px 系统字体
- 小半径卡片、lozenge、Atlassian 双层 shadow
- 不提供按钮颜色自定义，保持视觉一致性
- 保留品牌文案“跟我的 AI 说去吧！”

## 入口按钮设计

### 文案

按钮文案固定为：

```text
跟我的 AI 说去吧！
```

不开放按钮文案和颜色自定义。

### 位置

继续插入到 Bitbucket 评论 action-list 中，放在“回复”按钮之后。

### 按钮数量

只保留单一入口按钮，不再保留旧版独立预览眼睛按钮。

### 显示规则

只给以下评论显示入口：

- 非当前登录用户
- 非 PR 作者
- 非机器人 `superman`

PR 作者的回复仍然会作为评论线程上下文收集，但不显示入口按钮。

机器人过滤第一版只忽略作者名为 `superman` 的评论，不提供忽略作者列表配置。

## 右侧分析面板

### 形式

使用右侧固定抽屉面板，并使用 Shadow DOM 隔离样式，避免被 Bitbucket / Atlaskit 页面样式污染。

### 有 API Key 时

点击评论入口后：

1. 打开右侧面板
2. 切换到当前评论上下文
3. 自动收集上下文
4. 自动调用 DeepSeek 分析
5. 展示结构化 Markdown 结果

### 无 API Key 时

点击评论入口后：

1. 打开右侧面板
2. 显示生成的 Prompt 预览
3. 提供“复制 Prompt”按钮
4. 提供“去设置”按钮

不再直接静默复制 Prompt。

### 面板主要功能

- 展示当前目标评论概要
- 展示状态：生成中 / 成功 / 失败 / 无 API Key
- 展示 AI 分析结果
- 提供“复制推荐回复”
- 提供“复制完整分析”
- 提供“复制 Prompt”
- 提供“重新生成”
- 提供“去设置”
- 折叠显示 usage / cache hit 详情

## 多评论交互与缓存

### 点击其他评论

当用户点击另一个评论入口：

- 面板切换到新评论
- 如果命中当前页面内存缓存，直接展示结果
- 未命中缓存则自动分析

### 正在进行的请求

切换评论时：

- 尝试 Abort 上一个 AI 请求
- 同时使用 `requestId` 防止旧请求结果覆盖当前面板

### AI 结果缓存

缓存策略：

- 只做当前页面内存缓存
- 刷新页面即失效
- 缓存 key：`commentId + promptHash`
- patch 不缓存，每次实时下载

### 重新生成

- 不保留历史版本
- 重新生成成功后覆盖当前缓存
- 重新生成失败时保留旧结果，并提示失败

## DeepSeek 集成

### Provider

第一版只支持 DeepSeek。

### API Key 存储

- 使用 WXT / Chrome `storage.local`
- 不使用 `storage.sync`
- 不迁移旧版 storage 配置

### 请求位置

DeepSeek 请求统一由 background service worker 发起。

Content script 通过 runtime message 向 background 请求分析。

这样可以让 API key 只在扩展后台读取，不进入页面 DOM 或 content UI 状态。

### 模型

支持两个模型：

- `deepseek-v4-pro`
- `deepseek-v4-flash`

默认模型：

```text
deepseek-v4-pro
```

### Thinking

关闭 thinking。

调用时使用 DeepSeek 支持的关闭思考参数，例如：

```json
{
  "thinking": { "type": "disabled" }
}
```

### Temperature

按照 DeepSeek 官方 Coding / Math 推荐，固定：

```text
temperature: 0.0
```

其他参数保持 DeepSeek 默认，不在设置页暴露高级参数。

### 流式输出

第一版不做流式输出。

面板显示“生成中”，等待完整结果返回后一次性展示。

### 错误展示

DeepSeek API 错误只展示原始错误信息。

AI 分析失败时，面板提供：

- 复制 Prompt
- 重试
- 去设置

### Usage / Cache 信息

DeepSeek 返回的 usage 信息折叠在“详情”里展示，包括：

- prompt tokens
- completion tokens
- total tokens
- prompt cache hit tokens
- prompt cache miss tokens

默认不展开，避免干扰主要结果。

## DeepSeek 前缀缓存适配

DeepSeek Context Caching 是自动的，基于重复 prompt 前缀命中。

Prompt 结构应尽量稳定，将同一 PR 内重复的大块内容放前面，变化内容放后面。

推荐顺序：

1. 固定分析要求
2. PR 元信息
3. 完整 patch
4. 评论挂载的局部 diff / 文件位置
5. 当前评论线程
6. 目标评论与本次任务
7. 锁定输出格式

Prompt 中不包含动态时间、模型名、插件版本等信息，避免破坏缓存稳定性。

## Bitbucket 数据提取

### PR / 当前用户信息

优先解析 Bitbucket 页面中的 initial-data：

```js
define('@bitbucket/apps/pull-requests/initial-data', ...)
```

用于获取：

- currentUser
- repository
- pullRequest
- PR author
- reviewers
- projectKey
- repoSlug
- prId
- branches
- description

如果 initial-data 解析失败，再使用 DOM 兜底。

这也用于解决旧版当前用户显示名识别不完整的问题。

### 评论线程

只收集当前点击评论所在的 thread。

不收集 PR 页面所有评论，不收集同文件其他评论。

线程中包含：

- 根评论
- 回复
- 评论人
- 身份关系：我 / 对方 / PR 作者等内部判断信息
- 时间
- 评论正文
- 当前目标评论标记

### 评论入口目标

即使 PR 作者回复在 thread 中，也不会显示入口按钮；但会被纳入上下文。

## Patch 获取

### 获取位置

patch 由 content script 在当前 Bitbucket 页面 origin 下直接 `fetch`。

原因：

- 使用当前页面同源 cookie / 鉴权信息
- 不需要给 background 配置宽泛 Bitbucket host permissions
- background 只负责 DeepSeek

### 获取策略

默认自动获取完整 patch，并完整贴入 Prompt。

如果评论挂载了局部 diff，则局部 diff / 文件位置优先展示，然后再附完整 patch。

如果 patch 下载失败，则降级为页面可见 diff。

### 截断策略

完整 patch 完全不截断。

### Patch URL 构造

只构造 patch URL，不扫描页面已有 patch 链接。

#### projects PR

页面：

```text
/projects/{projectKey}/repos/{repoSlug}/pull-requests/{prId}/...
```

patch：

```text
/rest/patch/1.0/projects/{projectKey}/repos/{repoSlug}/pull-requests/{prId}/patch
```

#### users PR

页面：

```text
/users/{user}/repos/{repoSlug}/pull-requests/{prId}/...
```

patch 使用 Bitbucket personal project key：

```text
/rest/patch/1.0/projects/{personalProjectKey}/repos/{repoSlug}/pull-requests/{prId}/patch
```

优先级：

1. 优先从 initial-data 的 `repository.project.key` 获取，例如 `~WINTER.JI`
2. 如果取不到，则用 URL user 兜底：`~${urlUser.toUpperCase()}`

示例：

```text
https://code.fineres.com/users/winter.ji/repos/ceshi/pull-requests/1/overview
```

对应 patch：

```text
https://code.fineres.com/rest/patch/1.0/projects/~WINTER.JI/repos/ceshi/pull-requests/1/patch
```

## Prompt 模板

### 模板文件

默认 Prompt 模板放在单独模板文件中维护，便于修改。

### 用户自定义

设置页允许用户自定义模板的一部分，但锁定输出格式段。

用户只能编辑：

- 前置分析要求
- 上下文组织说明

用户不能破坏固定输出结构。

### 暴露变量

第一版只暴露少量稳定组合变量，避免用户误组装导致上下文缺失或缓存命中变差。

推荐变量：

- `{{PR_CONTEXT}}`
- `{{PATCH_CONTEXT}}`
- `{{COMMENT_CONTEXT}}`

不暴露大量细粒度变量。

### Prompt 顺序

AI 调用和复制 Prompt 使用同一顺序，优先优化 DeepSeek 前缀缓存。

### 输出格式锁定

固定要求模型输出结构化 Markdown：

```markdown
## 结论

## 依据

## 建议处理

## 需要验证

## 推荐回复
```

UI 从 `## 推荐回复` 小节提取可直接复制的回复内容。

如果提取失败，可降级为复制完整分析。

## AI 结果展示

### 格式

结果以结构化 Markdown 展示。

主要小节：

- 结论
- 依据
- 建议处理
- 需要验证
- 推荐回复

### 复制能力

提供两个核心复制动作：

- 复制推荐回复
- 复制完整分析

第一版不写回 Bitbucket，不自动填充回复框，不自动提交评论。

## 设置页

### 配置项

新版设置页包含：

- DeepSeek API Key
- 模型选择：`deepseek-v4-pro` / `deepseek-v4-flash`
- 测试连接
- Prompt 模板可编辑部分
- 恢复默认模板

不保留旧版配置：

- 按钮颜色
- 按钮文字颜色
- 是否显示预览按钮
- 按钮文案自定义

### API Key 输入

- 默认使用密码框隐藏
- 提供显示 / 隐藏按钮
- 提供清空按钮

### 测试连接

设置页提供“测试连接”按钮。

使用当前 API key 和当前模型发起极短请求，验证：

- key 是否有效
- model 是否可用
- 网络是否正常

测试结果显示在设置页。

## Popup

浏览器扩展图标点击后打开轻量 Popup。

Popup 展示：

- API key 是否已配置
- 当前模型
- 打开设置按钮

Popup 不提供模型快速切换。

## 旧版配置迁移

不迁移旧版 `storage.sync` 中的配置。

原因：

- 旧模板可能破坏新版结构化输出
- 旧颜色配置已废弃
- 新版默认模板和输出格式需要保持稳定

## 安全与用户操作边界

- 不自动写回 Bitbucket 评论
- 不自动提交回复
- 只复制推荐回复或完整分析，由用户自己粘贴确认
- 不做额外“会发送给 DeepSeek”的提示
- API key 仅存本机 `storage.local`
- DeepSeek 请求由 background 统一处理
- patch fetch 由 content script 同源请求

## 建议的代码结构

```text
entrypoints/
  background.ts
  content.tsx
  popup/
    App.tsx
    index.html
    main.tsx
  options/
    App.tsx
    index.html
    main.tsx

src/
  bitbucket/
    adapter.ts
    initialData.ts
    comments.ts
    diff.ts
    patch.ts
    users.ts
  deepseek/
    client.ts
    messages.ts
    types.ts
  prompt/
    defaultTemplate.ts
    renderPrompt.ts
    extractReply.ts
    variables.ts
  settings/
    storage.ts
    types.ts
  ui/
    tokens.css
    components/
    content-panel/
  shared/
    hash.ts
    normalize.ts
    types.ts
```

## 第一版非目标

第一版不做：

- 流式输出
- 自动回复 / 自动填入 Bitbucket 回复框
- Atlaskit 组件库
- 自动化测试
- 旧配置迁移
- patch 缓存
- 多版本 AI 结果历史
- 细粒度 prompt 变量
- file:// 本地 HTML 注入调试
