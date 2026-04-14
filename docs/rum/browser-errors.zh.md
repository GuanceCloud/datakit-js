# 浏览器错误采集

Guance RUM 会自动采集浏览器端常见错误，包括：

- JavaScript 运行时错误
- Promise 未处理拒绝
- 控制台错误
- 资源加载错误

## 自动采集范围

常见来源包括：

- `window.onerror`
- `unhandledrejection`
- 控制台 `error`
- 脚本、图片、样式等资源加载失败

## 常见限制

- 跨域脚本如果没有正确配置 CORS，浏览器通常只会暴露 `Script error`。
- 某些浏览器或页面安全策略会限制错误细节的获取。

## 建议

- 对第三方脚本增加 `crossorigin="anonymous"`。
- 静态资源服务端返回 `Access-Control-Allow-Origin`。
- 对业务侧主动捕获到的异常，可结合 [自定义错误](./custom-sdk/add-error.md) 补充上下文。
