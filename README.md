# 胡言乱语生成器 Toy

这是一个面向 Bilibili Toy 的轻量版胡言乱语生成器：用户输入一句话，选择「翻译」或「回答」以及生成长度，得到一句荒诞但通顺的结果。

仓库只保留 Toy 前端、生成质量核心、Skill 和 Toy 专用 AI 中转 Worker。网页页面不在 Cloudflare 上单独部署；Toy 通过 `https://api.freakz2z.com` 调用 Worker，密钥只保存在 Cloudflare Secrets 中。

## 生成规则

- `翻译`：保留原话的事实、态度、否定和转折，只改变解释。
- `回答`：直接回答问题，再用一个具体的荒谬理由收尾。
- `精辟`：4–8 个汉字。
- `中等`：12–24 个汉字。
- `正常`：25–48 个汉字。
- 结果经过清洗、长度/相关性/模式校验、重复检测和输出安全拦截；模型不合格时使用本地兜底结果。
- 历史记录只保存在用户浏览器中，最多保留 20 条；不会上传历史内容。

## 本地开发

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev:toy
```

打开 Vite 输出的本地地址即可预览 Toy。生产构建和测试：

```bash
npm run build:toy   # 产物写入 dist/toy/
npm run test        # 构建 Toy 并运行全部测试
npm run test:unit   # 只运行生成质量测试
npm run lint        # TypeScript 类型检查
```

## Toy AI 中转

`toy-relay/` 是 Toy 唯一的服务端组件，Worker 名称为 `freakz2z-api`，域名为 `api.freakz2z.com`。

- `POST /generate`：生成结果。
- `GET /health`：查看服务是否已配置，不返回任何密钥内容。
- 当前线上提供商为 DeepSeek 官方 `deepseek-v4-flash`，思考模式关闭。
- Ollama Cloud 的 `deepseek-v4-flash:0731` 适配仍保留在 Worker 代码中，可通过 `TOY_PROVIDER` 切换。
- 请求会先经过 IP 限流，再进行候选竞争、质量校验和安全拦截。

部署或预检：

```bash
npx wrangler deploy --config toy-relay/wrangler.jsonc
npx wrangler deploy --config toy-relay/wrangler.jsonc --dry-run
curl https://api.freakz2z.com/health
```

密钥只能通过 Wrangler Secret 设置，不要写入仓库：

```bash
npx wrangler secret put DEEPSEEK_API_KEY --config toy-relay/wrangler.jsonc
npx wrangler secret put OLLAMA_API_KEY --config toy-relay/wrangler.jsonc
```

## Skill

完整生成协议只维护在 [`skills/blahblah-generator/SKILL.md`](skills/blahblah-generator/SKILL.md)。运行 `npm run prepare:skill` 会把它编译为 `shared/generate/generated-skill.ts`，Toy 中转 Worker 和质量测试共用同一份规则源。

安装到 Agent 宿主：

```bash
node skills/blahblah-generator/scripts/install.mjs codex
node skills/blahblah-generator/scripts/install.mjs claude
node skills/blahblah-generator/scripts/install.mjs openclaw
```

通过中转接口调用：

```bash
node skills/blahblah-generator/scripts/generate.mjs \
  --mode 翻译 \
  --length 正常 \
  "我今天不想上班"
```

也可以用 `BLAHBLAH_API_URL` 指向另一套兼容 `POST /generate` 的服务。

## 目录

```text
toy/
├── index.html             # Toy 入口
├── main.tsx               # React 启动文件
├── src/Home.tsx           # Toy 页面与交互
├── src/globals.css        # Toy 样式
├── src/history.ts         # 浏览器历史记录
└── src/toy-local-generator.ts  # 无网络时的安全兜底

shared/generate/
├── prompts.ts              # Skill 与运行配置组装
├── generated-skill.ts      # 自动生成，请勿手动编辑
├── quality.ts              # 清洗、校验、评分与去重
├── fallback.ts             # 本地兜底结果
├── safety.ts               # 输出安全拦截
└── validation.ts           # 输入和长度约束

toy-relay/
├── src/index.ts            # freakz2z-api Worker
└── wrangler.jsonc          # Worker 与 api.freakz2z.com 配置

skills/blahblah-generator/
├── SKILL.md                # 唯一生成规则源
└── scripts/                # 编译、调用与安装脚本
```
