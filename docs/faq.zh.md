# 常见问题

## 配置 `allowedTracingOrigins` 后为什么会出现跨域请求

当前端接入链路追踪时，SDK 会在命中的请求上自动附加 trace header。浏览器一旦发现跨域请求带了自定义 header，就会先发起预检请求，这不是异常，而是标准 CORS 行为。

要让前后端链路追踪正常工作，需要同时满足：

1. 前端正确配置 `allowedTracingOrigins` 和 `traceType`
2. 后端 CORS 允许前端域名访问
3. 后端在 `Access-Control-Allow-Headers` 中放行对应 trace header

典型的 header 包括：

- `x-datadog-parent-id`
- `x-datadog-origin`
- `x-datadog-sampling-priority`
- `x-datadog-trace-id`

## 为什么只看到 `Script error`

这通常不是 SDK 丢数据，而是浏览器同源策略的结果。跨域脚本如果没有正确配置 CORS，浏览器只会暴露 `Script error.`。

处理方式：

1. 脚本服务端或 CDN 返回：

```http
Access-Control-Allow-Origin: *
```

2. 页面中的脚本标签增加：

```html
<script src="path/to/script.js" crossorigin="anonymous"></script>
```

## 为什么资源时序字段缺失或为 0

常见原因：

- 连接复用，DNS/TCP/SSL 只在首个请求发生
- 跨域资源没有配置 `Timing-Allow-Origin`
- 浏览器本身对相关 `Performance API` 支持不完整

如果是跨域资源，建议增加：

```http
Timing-Allow-Origin: *
```

## 为什么 `resource_status` 缺失

最常见的原因还是跨域资源没有授权当前页面读取响应状态。可以在资源服务端或 CDN 上增加：

```http
Access-Control-Allow-Origin: *
```

## 如何区分搜索引擎爬虫和真实用户

可以基于 `navigator.userAgent` 识别 bot，再决定是否启用链路追踪或其他采集能力。思路是：

- 命中 bot UA 时，关闭或缩小 tracing
- 真实用户维持正常配置

如果只是想避免 bot 影响分析指标，更直接的做法通常是在后端或分析查询层过滤 bot session。
