# BlahBlah Toy DeepSeek Relay

这是给 Bilibili Toy 使用的独立 Cloudflare Worker，只提供 AI 中转，不承载页面。

## 运行契约

- `POST /generate`
- 当前线上固定使用 Ollama Cloud `deepseek-v4-flash:0731`
- DeepSeek 官方 `deepseek-v4-flash` 适配仍保留，可随时切回
- 通过 `TOY_PROVIDER` 控制提供商：`ollama` / `deepseek`；未设置时才按密钥顺序回退
- DeepSeek 关闭思考模式
- API Key 只从 Cloudflare Secrets `OLLAMA_API_KEY` / `DEEPSEEK_API_KEY` 读取
- 只允许 Bilibili Toy 页面来源的 CORS 请求
- 每个客户端 IP 每分钟最多 30 次生成请求
- 每次先并行生成 3 个候选，再用一次低温模型调用按事实保真、切题、具体性和落点质量进行语义裁决
- 裁判认为全部不合格，或候选全部未通过硬校验时，再并行生成 2 个定向重写候选；仅在模型链路仍失败时使用本地兜底
- 候选、裁判和定向重写共享 9 秒总预算；上游拥堵时及时返回与输入相关的本地结果，不串联累加各阶段超时
- 生成结果始终经过清理、质量校验和安全拦截；真实伤害与无证据真假判断由确定性防线直接处理

## 部署

先部署 Worker（没有 Secret 时 `/health` 会显示 `configured: false`，生成接口返回 `provider_not_configured`）：

```bash
npx wrangler deploy --config toy-relay/wrangler.jsonc
```

配置 API Key 时使用 Secret，不要写进文件：

```bash
npx wrangler secret put DEEPSEEK_API_KEY --config toy-relay/wrangler.jsonc
npx wrangler secret put OLLAMA_API_KEY --config toy-relay/wrangler.jsonc
```

当前 `wrangler.jsonc` 已将 `TOY_PROVIDER` 设为 `ollama`。若后续需要切回 DeepSeek 官方，改为 `deepseek` 后重新部署即可，无需删除另一把 Secret。

## 健康检查

```bash
curl https://api.freakz2z.com/health
```

响应只包含模型、思考模式和是否已配置的布尔值，不会返回 Secret 内容。
