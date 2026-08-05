<div align="center">
  <img src="./assets/readme/logo.png" width="128" height="128" alt="胡言乱语生成器 Logo">

  <img src="./assets/readme/hero.svg" width="100%" alt="胡言乱语生成器 Toy：让句子先听懂你，再故意讲歪">

  <p>
    <a href="#生成示例">生成示例</a> ·
    <a href="#快速开始">快速开始</a> ·
    <a href="#toy-ai-中转">AI 中转</a> ·
    <a href="#skill">Skill</a> ·
    <a href="#仓库结构">仓库结构</a>
  </p>
</div>

> 一款运行在 Bilibili Toy 里的中文荒诞句子生成器。输入一句话，选择「翻译」或「回答」，再选择生成长度，得到一句通顺、具体、只歪一个地方的结果。

## 生成示例

| 模式 | 输入 | 结果 |
| --- | --- | --- |
| 翻译 | 我很困，但还是起床上班了。 | 我虽然困得很有原则，但身体为了全勤还是擅自把我送到了工位。 |
| 回答 | 为什么周一来得这么快？ | 因为周一怕迟到，周日晚上就开始往前跑，顺便撞掉了你的两个小时。 |

当前 Toy 主界面只保留两种模式和三档长度：`精辟`、`中等`、`正常`。结果支持重新生成、复制和保存图片。

## 它如何保证结果

生成协议先要求模型还原输入的事实骨架，再只扭歪一个因果、目的、主动权或字面含义。输出会依次经过：

1. 清洗模型多余的前缀、引号和换行。
2. 检查长度、模式、相关性和重复结果。
3. 拦截攻击、歧视、色情、违法、自残和真实伤害内容。
4. 模型超时、失败或结果不合格时，返回不依赖网络的本地安全兜底。

这套规则由 [`skills/blahblah-generator/SKILL.md`](skills/blahblah-generator/SKILL.md) 维护，并编译给 Toy、中转 Worker 和测试共同使用。

## 快速开始

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

仓库里的 `toy-relay/` 是 Toy 唯一的服务端组件。它是独立的 Cloudflare Worker，只负责调用模型，不承载网页页面。

| 项目 | 当前配置 |
| --- | --- |
| Worker | `freakz2z-api` |
| 域名 | `https://api.freakz2z.com` |
| 生成接口 | `POST /generate` |
| 健康检查 | `GET /health` |
| 当前模型 | DeepSeek 官方 `deepseek-v4-flash` |
| 思考模式 | 已关闭 |

Ollama Cloud 的 `deepseek-v4-flash:0731` 适配仍保留在 Worker 代码中，可通过 `TOY_PROVIDER=ollama` 切换测试。当前部署使用 DeepSeek 官方，API Key 只从 Cloudflare Secrets 读取。

部署或预检：

```bash
npx wrangler deploy --config toy-relay/wrangler.jsonc
npx wrangler deploy --config toy-relay/wrangler.jsonc --dry-run
curl https://api.freakz2z.com/health
```

配置密钥时使用 Wrangler Secret，不要写入仓库：

```bash
npx wrangler secret put DEEPSEEK_API_KEY --config toy-relay/wrangler.jsonc
npx wrangler secret put OLLAMA_API_KEY --config toy-relay/wrangler.jsonc
```

中转会限制请求频率，每次并行比较有限数量的候选结果；单个候选超时后会走本地兜底，避免 Toy 一直等待。

## Skill

完整生成协议只维护在 [`skills/blahblah-generator/SKILL.md`](skills/blahblah-generator/SKILL.md)。修改协议后运行下面的命令，生成 `shared/generate/generated-skill.ts`：

```bash
npm run prepare:skill
```

安装到 Agent 宿主：

```bash
node skills/blahblah-generator/scripts/install.mjs codex
node skills/blahblah-generator/scripts/install.mjs claude
node skills/blahblah-generator/scripts/install.mjs openclaw
```

也可以直接通过中转接口调用：

```bash
node skills/blahblah-generator/scripts/generate.mjs \
  --mode 翻译 \
  --length 正常 \
  "我今天不想上班"
```

脚本默认使用 `https://api.freakz2z.com/generate`，也可以通过 `BLAHBLAH_API_URL` 指向另一套兼容接口。

## 浏览器内的数据

- 历史记录只保存在用户自己的浏览器中，最多保留 20 条，点击记录即可恢复结果。
- 不提供导入导出，历史文本不会发送给统计接口。
- 页面底部的“共生成”数字是当前浏览器本地累计次数，不代表跨用户的全局总量。
- API Key 只存在 Cloudflare Secrets，不进入 Toy 静态产物和 Git 历史。

## 仓库结构

```text
toy/
├── index.html                 # Toy 入口与中转地址
├── main.tsx                   # React 启动文件
└── src/
    ├── Home.tsx               # 页面与交互
    ├── globals.css             # Toy 样式
    ├── history.ts              # 浏览器历史记录
    └── toy-local-generator.ts  # 无网络时的安全兜底

shared/generate/
├── prompts.ts                 # Skill 与运行配置组装
├── generated-skill.ts         # 自动生成，请勿手动编辑
├── quality.ts                 # 清洗、校验、评分与去重
├── fallback.ts                # 本地兜底结果
├── safety.ts                  # 输出安全拦截
└── validation.ts              # 输入和长度约束

toy-relay/
├── src/index.ts               # freakz2z-api Worker
└── wrangler.jsonc             # Worker 与 api.freakz2z.com 配置

skills/blahblah-generator/
├── SKILL.md                   # 唯一生成规则源
└── scripts/                   # 编译、调用与安装脚本

assets/readme/
├── logo.png                   # README 顶部 Logo
└── hero.svg                   # README 顶部 Hero 视觉
```

旧的 Cloudflare 网页版本不再属于这个仓库；Cloudflare 这里只保留 Toy 所需的 AI 中转 Worker。
