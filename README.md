<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="胡言乱语生成器：翻译原话，或者用胡言乱语回答问题。">
</p>

<p align="center">
  <a href="https://blah.freakz2z.com">在线体验</a> · <a href="#快速开始">本地运行</a> · <a href="#生成接口">生成接口</a>
</p>

一个极简的中文文字生成器：让它把原话翻译成胡言乱语，或者直接用胡言乱语回答问题。

> **模式**：回答　·　**问题**：为什么周一总是来得很快？　·　**精神状态**：差<br>
> 因为周一办了加急，而周末还在窗口补材料。

## 它有什么不同

- **两种生成模式**：翻译保留原话核心意思并扭曲逻辑；回答则直接用胡言乱语作答。
- **三种精神状态**：正常、差、极差。它们不是“质量档位”，而是逐渐松动的语言逻辑。
- **三档生成长度**：精辟（4–8 字）、中等（12–24 字）、正常（25–48 字）。短句也有独立提示词与校验规则。
- **不只是随机拼词**：每次生成围绕选题的具体场景，并选择错误因果、字面误解、流程错位等荒谬机制。
- **三候选筛选**：并行生成三个克制但有差异的候选句，再按原意保留、回答相关性、状态特征和重复度选择较好的一条；都不合格时会严格重试一次。
- **可直接带走**：生成结果支持再次生成、复制和保存图片。

## 精神状态

| 状态 | 阅读感受 |
| --- | --- |
| 正常 | 第一眼像观点，第二眼才发现推理歪了。 |
| 差 | 每一段都能懂，连起来却明显不成立。 |
| 极差 | 句法还稳，世界观已经开始漏风。 |

## 快速开始

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

本地未配置生成服务凭据时，应用仍可启动，并返回内置兜底文案。

## 生成接口

```http
POST /api/generate
Content-Type: application/json
```

```json
{
  "topic": "为什么周一总是来得很快？",
  "mode": "回答",
  "mood": "极差",
  "length": "精辟"
}
```

成功响应：

```json
{ "text": "……" }
```

`topic` 是要翻译或回答的文本，最长 30 个字；`mode` 可选值为 `翻译`、`回答`；`mood` 可选值为 `正常`、`差`、`极差`；`length` 可选值为 `精辟`（4–8 字）、`中等`（12–24 字）、`正常`（25–48 字）。`mode` 省略或无效时默认 `翻译`，其余可选项省略或无效时默认 `正常`。接口会对异常请求进行限流，并在生成结果不符合要求时自动换一种策略重试。

## 开发与测试

生产环境默认使用 Ollama Cloud 的 `deepseek-v4-flash`。将 API Key 保存为
Cloudflare Secret `OLLAMA_API_KEY`；可用 `OLLAMA_MODEL` 覆盖模型名，
或将 `MODEL_PROVIDER` 设为 `deepseek` 临时切回原供应商。新密钥尚未配置时，
服务会自动使用已有的 `DEEPSEEK_API_KEY`，避免生成接口中断。

完整生成规则现在由
[`skills/blahblah-generator/SKILL.md`](skills/blahblah-generator/SKILL.md)
统一维护。开发和构建命令会先把整个 Skill 编译进 Worker；不要在
`app/api/generate/prompts.ts` 中另建提示词副本。

社区用户可直接使用 Skill 原生生成，也可通过附带脚本调用线上质量管线：

```bash
node skills/blahblah-generator/scripts/generate.mjs \
  --mode 翻译 --mood 正常 --length 正常 "我今天不想上班"
```

安装到不同宿主：

```bash
node skills/blahblah-generator/scripts/install.mjs codex
node skills/blahblah-generator/scripts/install.mjs claude
node skills/blahblah-generator/scripts/install.mjs openclaw
```

```bash
npm run dev         # 本地开发
npm run build       # 生产构建
npm run test        # 全部测试
npm run test:unit   # 仅运行生成质量测试
npm run lint        # 代码检查
```

核心生成逻辑位于 `app/api/generate/`：

- `prompts.ts`：生成模式、精神状态、荒谬机制与提示词组装。
- `quality.ts`：结果清洗、校验、评分和近似重复检测。
- `validation.ts`：选题输入校验。

## 字体

页面衬线字体为自托管的 [Noto Serif SC](https://fonts.google.com/noto/specimen/Noto+Serif+SC)（SIL OFL 1.1），
经 [cn-font-split](https://www.npmjs.com/package/cn-font-split) 按 unicode-range 切片存放在
`public/fonts/`，浏览器只按页面实际用到的字形下载切片，保证各平台渲染一致。

## 参与改进

欢迎提交 Issue 或 Pull Request。比起“更疯”，我们更想让每种模式和精神状态都有自己的一套歪理。
