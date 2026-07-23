# WebSocket 长连接采集

WebSocket 采集当前为实验功能，默认关闭。初始化 RUM 时通过
`enableExperimentalFeatures` 开启：

```js
DATAFLUX_RUM.init({
  applicationId: '<APPLICATION_ID>',
  datakitOrigin: '<DATAKIT_ORIGIN>',
  enableExperimentalFeatures: ['track_websockets']
})
```

`@cloudcare/browser-rum-slim` 使用相同配置。

## 采集语义

SDK 将一条 WebSocket 连接汇总为一个 `resource.type = websocket` 的 RUM
Resource 事件。事件在以下时机生成：

- 浏览器收到 WebSocket `close` 事件；
- 当前 RUM Session 到期；
- SDK 内部停止采集。

Session 到期时，仍处于打开状态的连接以
`resource.websocket.tracking_end_reason = session_end` 结算。该连接后续产生的消息和
关闭事件不会累计到新 Session；新建的 WebSocket 连接仍可正常采集。

SDK 不采集消息正文，只统计以下连接质量信息：

- 连接 URL、协商后的子协议和握手是否成功；
- 连接起止时间、握手耗时和总持续时间；
- 起止 View ID；
- 收发消息数量和字节数；
- 首条收发消息延迟；
- 最长入站消息间隔和关闭前入站空闲时间；
- 发送前 `bufferedAmount` 峰值；
- 关闭码、关闭原因和是否正常关闭。

字符串消息按 UTF-8 字节数统计；`ArrayBuffer`、TypedArray/DataView 和 Blob
按其实际字节长度统计。未知消息类型按 0 字节统计。

## 本地验收

```bash
npm run dev
```

打开：

```text
http://localhost:8082/websocket-smoke.html
```

Demo 会连接本地 `/ws-echo`，跨两个 View 发送 UTF-8 文本和二进制消息，随后检查
`beforeSend` 事件以及开发服务器收到的 `/v1/write/rum` 请求。页面显示 `Passed`
表示连接统计和最终传输字段均通过。
