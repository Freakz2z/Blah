# BlahBlah Toy DeepSeek Relay

这是给 Bilibili Toy 使用的独立 Cloudflare Worker，不承载网站页面，也不依赖旧的 `blah.freakz2z.com` Worker。

## 运行契约

- `POST /generate`
- Ollama Cloud 优先使用 `deepseek-v4-flash:0731`
- Ollama 不可用或质量校验失败时，切换到 DeepSeek 官方 `deepseek-v4-flash`
- 两个提供商都关闭思考模式
- API Key 只从 Cloudflare Secrets `OLLAMA_API_KEY` / `DEEPSEEK_API_KEY` 读取
- 只允许 Bilibili Toy 页面来源的 CORS 请求
- 每个客户端 IP 每分钟最多 10 次生成请求
- 生成结果仍经过现有的清理、质量校验和安全拦截

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

## 健康检查

```bash
curl https://api.freakz2z.com/health
```

响应只包含模型、思考模式和是否已配置的布尔值，不会返回 Secret 内容。
