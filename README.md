<div align="center">
  <img src="./public/favicon.png" width="128" height="128" alt="胡言乱语生成器图标">

  <img src="./assets/readme/hero.svg" width="100%" alt="胡言乱语生成器：生成荒诞但通顺的中文句子">

  <a href="https://blah.freakz2z.com">在线体验</a> ·
  <a href="#把它作为-skill-使用">安装 Skill</a> ·
  <a href="#生成接口">生成接口</a> ·
  <a href="#本地开发">本地开发</a>

</div>

## 先看效果

### 翻译

**原话**：我很困，但还是起床上班了。

**结果**：我虽然困得很有原则，但身体为了全勤还是擅自把我送到了工位。

> 保留主语、动作、否定和转折，让读者能够从结果猜回原话；笑点来自错误解释，而不是另编一件事。
---
### 回答

**问题**：为什么周一来得这么快？

**结果**：因为周一怕迟到，周日晚上就开始往前跑，顺便撞掉了你的两个小时。

> 先真正回答问题，再用一个荒谬理由收尾。问“为什么”就给原因，问“怎么办”就给做法，问“能不能”就先表态。

## 生成方式


**两种模式**：`翻译`保留原意并扭曲解释；`回答`直接生成一句答案。

网站主界面直接选择模式和生成长度；主题设置保留在设置面板中。

**三档生成长度**：`精辟` 4–8 个汉字、`中等` 12–24 个汉字、`正常` 25–48 个汉字。

**八种构思机制**：错误因果、字面误解、主客倒置、目的倒置、情绪实体化、细节篡位、过度认真和时间借口。

## 质量是第一优先级

生成内容不能凌驾于结果质量。固定裁决顺序是：

```text
原意可辨 / 回答切题 > 一句一梗 > 意外但说得通
```

每次生成都会经过以下边界：

1. **两遍成句**：先在心里写出忠实、直接的正常句，再只扭歪一个关系。
2. **三候选竞争**：并行生成三个采用不同机制的候选结果。
3. **硬性淘汰**：拒绝长度错误、事实漂移、答非所问、提示词泄露、重复和多句输出。
4. **质量排序**：优先选择贴合输入、机制清楚且没有陈词滥调的候选。
5. **反模板检查**：降低“排队、请假、加急、办理”等万能笑点，以及“因为……所以……”式重复解释的权重。
6. **严格重试与兜底**：所有候选不合格时严格重试，仍失败才使用与模式和长度匹配的本地兜底。
7. **输出安全拦截**：结果返回前会拦截明确的攻击、色情、违法、自残和真实伤害内容。

换成任何输入仍然成立的句子，不算合格的胡言乱语。

## 一份 Skill，多个入口

完整协议只维护在
[`skills/blahblah-generator/SKILL.md`](skills/blahblah-generator/SKILL.md)。
网站构建时会把整份 Skill 编译进 Worker，Agent 则可以直接读取它：

```text
                         ┌─ Claude Code
SKILL.md ────────────────├─ OpenClaw
   │                     └─ Codex
   │
   └─ 编译进网站 → 模型候选 → 质量闸门 → 最终结果
```

这意味着社区修改生成协议后，不需要再同步维护一份隐藏的网站提示词。

## 把它作为 Skill 使用

### 安装

克隆仓库后运行对应命令：

```bash
node skills/blahblah-generator/scripts/install.mjs codex
node skills/blahblah-generator/scripts/install.mjs claude
node skills/blahblah-generator/scripts/install.mjs openclaw
```

脚本会把完整的 `blahblah-generator` Skill 安装到对应宿主的 Skill 目录。

| 宿主 | 安装位置 |
| --- | --- |
| Codex | `~/.agents/skills/blahblah-generator` |
| Claude Code | `~/.claude/skills/blahblah-generator` |
| OpenClaw | `~/.openclaw/skills/blahblah-generator` |

### 原生调用

安装后，可以让 Agent 直接使用 Skill：

```text
使用 blahblah-generator，把“我今天不想上班，但还是准时到了公司”
按“翻译 / 正常”生成一句结果。
```

网站界面未指定配置时默认使用 `翻译 / 正常`；历史 Skill/API 调用仍兼容 `mood` 参数，缺省时使用 `正常`。

### 调用网站质量管线

如果希望不同宿主获得与网站相同的模型、候选筛选和质量校验，可以使用 Skill 附带的脚本：

```bash
node skills/blahblah-generator/scripts/generate.mjs \
  --mode 翻译 \
  --length 正常 \
  "我今天不想上班"
```

可通过环境变量 `BLAHBLAH_API_URL` 指向自行部署的兼容接口。

## 快速启动网站

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

打开终端中显示的本地地址即可使用。未配置模型凭据时，应用仍可启动，并返回内置兜底文案。

## 生成接口

```http
POST /api/generate
Content-Type: application/json
```

请求示例：

```json
{
  "topic": "为什么周一总是来得这么快？",
  "mode": "回答",
  "length": "精辟"
}
```

成功响应：

```json
{
  "text": "周末跑输了。"
}
```

| 字段 | 可选值 | 默认值 | 限制 |
| --- | --- | --- | --- |
| `topic` | 任意文本 | 无 | 必填，最多 30 个字符 |
| `mode` | `翻译`、`回答` | `翻译` | 无效值回退为默认值 |
| `length` | `精辟`、`中等`、`正常` | `正常` | 无效值回退为默认值 |

接口包含异常请求限流，并会在模型结果不符合质量要求时自动更换候选或严格重试。

## 本地开发

```bash
npm run dev         # 编译 Skill 并启动开发服务
npm run build       # 编译 Skill 并构建生产产物
npm run test        # 构建并运行全部测试
npm run test:unit   # 只运行生成质量测试
npm run lint        # 代码检查
```

核心目录：

```text
app/api/generate/
├── prompts.ts          # 从 Skill 组装本次运行配置
├── generated-skill.ts  # 自动生成，请勿手动编辑
├── quality.ts          # 清洗、硬校验、评分与近似重复检测
├── fallback.ts         # 分模式、状态和长度的兜底结果
├── safety.ts           # 输出层安全拦截与安全兜底
├── provider.ts         # Ollama Cloud 与 DeepSeek 适配
└── validation.ts       # 输入和生成长度约束

skills/blahblah-generator/
├── SKILL.md            # 网站与社区共同使用的唯一规则源
├── agents/openai.yaml  # Agent 展示元数据
└── scripts/
    ├── compile.mjs     # 把完整 Skill 编译进网站
    ├── generate.mjs    # 调用网站质量管线
    └── install.mjs     # 安装到不同 Agent 宿主
```

修改 `SKILL.md` 后，运行以下命令检查编译结果和质量边界：

```bash
npm run test:unit
```

## 字体

页面衬线字体为自托管的
[Noto Serif SC](https://fonts.google.com/noto/specimen/Noto+Serif+SC)（SIL OFL 1.1）。

字体通过 [cn-font-split](https://www.npmjs.com/package/cn-font-split)
按 `unicode-range` 切片存放在 `public/fonts/`，浏览器只下载页面实际使用的字形。

## 参与改进

欢迎提交 Issue 或 Pull Request，尤其欢迎：

- 新的荒谬机制和更好的正例；
- 能稳定复现质量问题的输入；
- 面向其他 Agent 宿主的安装适配；
- 对事实保留、回答相关性和中文表达的测试。

---

<div align="center">
  <p>比起“更疯”，这个项目更在意结果是否先理解了你的输入。</p>
</div>
