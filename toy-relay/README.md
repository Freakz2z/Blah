# BlahBlah Toy DeepSeek Relay

这是给 Bilibili Toy 使用的独立 Cloudflare Worker，不承载网站页面，也不依赖旧的 `blah.freakz2z.com` Worker。

## 运行契约

- `POST /generate`
- 当前线上固定使用 DeepSeek 官方 `deepseek-v4-flash`
- Ollama Cloud `deepseek-v4-flash:0731` 的流式优化仍保留，可随时切回测试
- 通过 `TOY_PROVIDER` 控制提供商：`ollama` / `deepseek`；未设置时才按密钥顺序回退
- DeepSeek 关闭思考模式
- API Key 只从 Cloudflare Secrets `OLLAMA_API_KEY` / `DEEPSEEK_API_KEY` 读取
- 只允许 Bilibili Toy 页面来源的 CORS 请求
- 每个客户端 IP 每分钟最多 10 次生成请求
- 每次最多并行 2 个候选，单个候选超时 8.5 秒；超时或不合格时直接使用本地兜底，避免超过 10 秒
- 生成结果仍经过现有的清理、质量校验和安全拦截，模型失败时使用本地兜底

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

当前 `wrangler.jsonc` 已将 `TOY_PROVIDER` 设为 `deepseek`。若后续需要重新测试 Ollama，改为 `ollama` 后重新部署即可，无需删除另一把 Secret。

## 健康检查

```bash
curl https://api.freakz2z.com/health
```

响应只包含模型、思考模式和是否已配置的布尔值，不会返回 Secret 内容。
