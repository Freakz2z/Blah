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

当前 Toy 主界面提供三种模式：`翻译`、`回答`、`自由`，以及三档长度：`精辟`、`中等`、`正常`。结果支持重新生成和复制；每次有效生成增加 1 点「胡言乱语值」，它会同步到 Toy KV、进入排行榜并推进成就勋章。

## 它如何保证结果

生成协议要求模型先提取输入的事实骨架，再自由选择一个歪法角度（谐音梗、自嘲、错误因果等十种可选，或自创）只扭歪一个关系。输出会依次经过：

1. 清洗模型多余的前缀、引号和换行。
2. 检查长度、模式、相关性和重复结果。
3. 拦截攻击、歧视、色情、违法、自残和真实伤害内容。
4. 模型超时、失败或结果不合格时，返回不依赖网络的本地安全兜底。

这套规则由 [`skills/blahblah-generator/SKILL.md`](skills/blahblah-generator/SKILL.md) 维护，并编译给 Toy、中转 Worker 和测试共同使用。

生成提示词还接入了经过人工审校的网络语境层（[`shared/generate/trending.ts`](shared/generate/trending.ts)）：每项都有生效期、复核日期、适用信号、禁用语境和来源。系统会按输入相关性最多选择两项；无明确匹配或涉及真实伤害、灾难、急救等严肃内容时完全不注入。过期项自动失效，当前项超过 45 天未复核会让测试失败；候选也不会仅因出现热词获得额外分数。本地兜底不依赖该语境层，仍按模式和长度从多套歪理池里抽取。

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
| 反馈接口 | `POST /feedback` |
| 健康检查 | `GET /health` |
| 当前模型 | Ollama Cloud `deepseek-v4-flash:0731` |
| 思考模式 | 已关闭 |

DeepSeek 官方的 `deepseek-v4-flash` 适配仍保留在 Worker 代码中，可通过 `TOY_PROVIDER=deepseek` 切回。当前部署使用 Ollama Cloud，API Key 只从 Cloudflare Secrets 读取。

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

中转会限制请求频率，每次并行生成 3 个候选结果（同一提示词、不同温度：主候选低温保证连贯，高温候选提供多样性），经校验评分后取最优；全部不合格时走本地兜底，避免 Toy 一直等待。生成结果不再附带机制名，兜底结果是 `兜底`。

排行榜仅保留「胡言乱语榜」：使用 Toy JS SDK 的 board 1，以登录用户的胡言乱语值作为绝对分数，提供总榜 / 月榜 / 周榜 / 日榜。SDK 会保留每个用户在对应周期提交过的最高分；游客可读榜单，登录后可提交分数并查询本人排名。

成就系统共六级：初次失真（1）、逻辑松动（5）、语义漂移（20）、语言实验员（50）、现实改写者（100）、终身胡言（300）。老用户会从旧的累计生成数迁移，不会清零；完整规则见 [`docs/achievement-system.md`](docs/achievement-system.md)。

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

- 历史记录仅登录用户可见：同步到 B站云存储（按「登录用户 + Toy」隔离），跨设备最多保留 20 条，点击记录即可恢复结果；未登录游客没有历史记录。
- 历史文本不会发送给排行榜或本项目的统计接口；输入话题本身是生成的必要条件，会随每次请求发给中转并转发给模型，但不会被 Worker 落库。排行榜只提交胡言乱语值这个整数，不提交话题或生成文本。
- 「我的」页面顶部显示登录用户的头像、昵称和胡言乱语值，下方展示成就进度与全部勋章；胡言乱语值通过 B站云存储跨设备同步。未登录也可以正常生成并在本地累计，但无法参与排行榜或同步进度与历史记录。底部导航为「主页 / 排行 / 我的」三个入口。
- 云存储与排行榜能力来自 B站官方 Toy JS SDK（`toy-sdk.js`），只读写当前 Toy 维度；API Key 仍只存在 Cloudflare Secrets，不进入 Toy 静态产物和 Git 历史。

## 仓库结构

```text
toy/
├── index.html                 # Toy 入口、中转地址与 Toy JS SDK 加载
├── main.tsx                   # React 启动文件
└── src/
    ├── Home.tsx               # 页面与交互
    ├── achievements.ts        # 胡言乱语值成就规则与独立勋章引用
    ├── cloud-history.ts       # 云存储历史同步（h-0..h-19，仅登录用户）
    ├── leaderboard.ts         # Toy SDK 胡言乱语榜（总/月/周/日）
    ├── profile.ts             # 登录用户资料（头像/昵称）
    ├── globals.css             # Toy 样式
    ├── history.ts              # 历史记录解析/序列化（云端共用）
    └── toy-local-generator.ts  # 无网络时的安全兜底

types/
└── toy.d.ts                   # Toy JS SDK 类型声明（window.toy）

shared/generate/
├── prompts.ts                 # Skill 与运行配置组装
├── generated-skill.ts         # 自动生成，请勿手动编辑
├── quality.ts                 # 清洗、校验、评分与去重
├── trending.ts                # 有生命周期和相关性选择的网络语境层
├── fallback.ts                # 本地兜底结果
├── safety.ts                  # 输出安全拦截
└── validation.ts              # 输入和长度约束

toy-relay/
├── src/index.ts               # freakz2z-api Worker
├── src/vote-store.ts          # 反馈投票聚合 DurableObject（当前 UI 未使用）
└── wrangler.jsonc             # Worker 与 api.freakz2z.com 配置

skills/blahblah-generator/
├── SKILL.md                   # 唯一生成规则源
└── scripts/                   # 编译、调用与安装脚本

assets/readme/
├── logo.png                   # README 顶部 Logo
└── hero.svg                   # README 顶部 Hero 视觉

toy/assets/achievements/
└── *.webp                     # 六枚独立透明成就勋章（512 × 512）
```

旧的 Cloudflare 网页版本不再属于这个仓库；Cloudflare 这里只保留 Toy 所需的 AI 中转 Worker。
