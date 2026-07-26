# 胡言乱语生成器

输入一个选题，选一档「精神状态」，认真说一句 25～65 字的废话。

单页应用：Next.js 16 + React 19，通过 [vinext](https://github.com/cloudflare/vinext)
运行在 Cloudflare Workers 上，由 OpenAI Sites 平台托管（`.openai/hosting.json`）。
文案生成调用 DeepSeek Chat API。

## 快速开始

```bash
npm install
npm run dev
```

不配置 API key 也能跑：`/api/generate` 会返回内置兜底文案（并在日志里警告）。
要接真实模型，为运行环境提供以下变量（本地可放 `.env`，已被 gitignore）：

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 是 | DeepSeek API 密钥；缺失时静默降级为兜底文案 |
| `DEEPSEEK_API_BASE` | 否 | 覆盖上游地址，默认 `https://api.deepseek.com/chat/completions` |
| `DEEPSEEK_MODEL` | 否 | 覆盖模型名，默认 `deepseek-v4-flash` |

## 生成管线（`app/api/generate/`）

`POST /api/generate`，请求体 `{ topic: string, mood?: "正常"|"差"|"极差"|"最差"|"钝角" }`，
响应 `{ text }`。质量优先的多候选管线：

1. **提示词**（`prompts.ts`）：公共规则 + 所选精神状态（各带一句风格示范）+
   按档位白名单随机抽取的 1~2 条「本次优先荒谬机制」（12 条机制池，两个候选的机制互斥）。
2. **双候选并行**（`route.ts`）：temperature 1.25 / 1.45 各发一次
   （top_p 0.95、frequency_penalty 0.3、`stop: ["\n"]`、只接受 `finish_reason === "stop"`）。
3. **清洗与校验**（`quality.ts`）：剥前缀/引号/markdown 残留；校验 25~65 码点、
   字符白名单、汉字占比、提示词泄漏、重复度、单句性、标点占比，并与同选题最近
   3 条结果做 bigram 查重。
4. **启发式打分二选一**：选题相关性主导，机制连接词按档位加分，高频套路词
   （奶茶/猫/宇宙…，选题自带则豁免）减分。
5. 双候选全废 → 低温严格重试一次 → 仍失败返回 `502 {error:"generation_failed"}`。

每次用户请求最多 3 次上游调用。限流在 Worker 入口（`worker/index.ts`）：
Durable Object 按 `CF-Connecting-IP` 每 60 秒最多 12 次，超限
`429 {error:"rate_limited"}` + `Retry-After`；无效请求体不消耗配额。

## 常用命令

- `npm run dev` — 本地开发（Miniflare 模拟 Workers 绑定）
- `npm run build` — vinext 构建，产物在 `dist/`
- `npm test` — 构建 + 全部测试（SSR 渲染断言 + 生成管线单元测试）
- `npm run test:unit` — 只跑生成管线单元测试（无需构建，秒级）
- `npm run lint` — ESLint
- `npm run db:generate` — 生成 Drizzle 迁移（当前未使用数据库）

## 脚手架保留能力（当前未使用）

项目由 `site-creator-vinext-starter` 模板生成，以下能力保留但未接入应用：

- **D1 + Drizzle**：`db/schema.ts` 刻意为空；`examples/d1/` 是可选的 notes 示例；
  启用需在 `.openai/hosting.json` 声明绑定。
- **Sign in with ChatGPT**：`app/chatgpt-auth.ts` 提供 `getChatGPTUser()` /
  `requireChatGPTUser()` 等辅助函数，读取平台注入的 `oai-authenticated-user-*`
  请求头；`/signin-with-chatgpt`、`/signout-with-chatgpt`、`/callback` 由托管平台
  拥有，应用内勿实现。SIWC 只证明身份，不证明工作区成员资格。
- `app/_sites-preview/` 是平台建站期间的占位骨架屏，测试会断言它不出现在
  真实渲染产物中。

本项目不使用 `wrangler.jsonc`：Worker 绑定在 `vite.config.ts` 内联声明，
构建时生成 `dist/server/wrangler.json`。要求 Node >= 22.13.0。
