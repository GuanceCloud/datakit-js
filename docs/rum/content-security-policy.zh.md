# CSP 安全策略

如果你开启了 Session Replay、压缩上传或 canvas 编码 worker，需要注意 CSP 配置。

## Worker 相关

默认情况下，SDK 会使用内联 blob worker，因此通常需要允许：

```text
worker-src blob:;
```

如果不允许 blob worker，可以改成自托管：

- `workerUrl`
  - 原有的 replay / compress worker
- `replayCanvasWorkerUrl`
  - canvas snapshot 编码专用 worker

注意：

- `replayCanvasWorkerUrl` 只影响 canvas snapshot 编码
- 它不替代 `workerUrl`
- 如果当前这一帧没有走 snapshot 编码，就不会用到 canvas worker

## 推荐做法

如果 CSP 较严格，建议把两个 worker 都自托管到同源地址，例如：

```js
datafluxRum.init({
  workerUrl: '/worker.js',
  replayCanvasWorkerUrl: '/canvas-worker.js'
})
```

并确保：

1. worker 文件和页面同源
2. `worker-src` 允许这些地址

