# Content Security Policy

HTTP 响应头 Content-Security-Policy 允许站点管理者控制用户代理能够为指定的页面加载哪些资源。除了少数例外情况，设置的政策主要涉及指定服务器的源和脚本结束点。这将帮助防止跨站脚本攻击（Cross-Site Script）。
详情参考 [Content-Security-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy)

## 多内容安全策略

CSP 允许在一个资源中指定多个策略，包括通过 [Content-Security-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy) 头，以及 [Content-Security-Policy-Report-Only](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/Content-Security-Policy-Report-Only) 头，和 [<meta>](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Element/meta) 组件。

## 是列子

```js
// header
Content-Security-Policy: connect-src http://example.com/;
                         script-src http://example.com/

// meta tag
<meta http-equiv="Content-Security-Policy" content="connect-src http://example.com/;
                         script-src http://example.com/">
```

## 如何在使用 CSP 的网站应用中，接入 RUM SDK

如果您的网站应用正在使用 CSP， 接入观测云 RUM SDK 之后，可能会在浏览器中出现安全违规的提示，你需要将以下 URL 添加到对应的指令中

### Datakit 上报 URLs

依赖于 [RUM SDK 初始化配置]()中的 `datakitOrigin` 选项：

```js
 DATAFLUX_RUM.init({
      ...
      datakitOrigin: 'https://test.dk.com',
      ...
    })
```

在 CSP 安全指令中，请添加如下条目：

```js
    connect-src https://*.dk.com
```

### web worker

如果你开启了 RUM SDK [Session Replay]()功能或者 RUM 初始化配置中添加了[compressIntakeRequests]()配置,请确保通过添加以下 worker-src 条目:

```json
 worker-src blob:;
```

在 SDK 版本 `>=3.2.0` 开始支持自己托管 webwork 文件。在 SDK 配置中添加 `workerUrl` 来添加托管地址。可以通过以下两种方式来获取 worker 文件

1. 从观测云官方地址 https://static.guance.com/browser-sdk/v3/worker.js 下载
2. 安装 @cloudcare/browser-worker NPM 包并使用构建工具将其包含在构建资产中（参见 [Webpack 4](https://v4.webpack.js.org/loaders/file-loader/)、[Webpack 5](https://webpack.js.org/guides/asset-modules/#url-assets)、[Vite](https://vitejs.dev/guide/assets.html#new-url-url-import-meta-url) 和 [Rollup](https://github.com/rollup/plugins/tree/master/packages/url/#readme) 的文档）。

必要条件：

1.  将文件托管在与您的 Web 应用程序相同的来源上。由于浏览器限制，它无法托管在单独的域（例如，第三方 CDN 主机）或其他方案上。
2.  保证 SDK 版本 `>=3.2.0`

### CDN 地址

如果您正在使用 [CDN 异步]() 或 [CDN 同步]() 的方式引入 RUM SDK，请添加以下 script-src 条目：

```json
script-src https://static.guance.com
```
