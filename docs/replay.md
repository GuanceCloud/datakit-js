# Session Replay

### 什么是 Session Replay

Session Replay 通过现代浏览器提供的强大 API 拓展能力，捕获 Web 应用的用户的操作数据，并重播用户当时的使用体验。

结合 RUM 性能数据，Session Replay 有利于错误定位、重现和解决，并及时发现 Web 应用程序在使用模式和设计上的缺陷。

### Session Replay Record

Session Replay Record 是 RUM SDK 的一部分。Record 通过跟踪和记录网页上发生的事件（例如 DOM 修改、鼠标移动、单击和输入事件）以及这些事件的时间戳来获取浏览器的 DOM 和 CSS 的快照。并通过观测云重建网页并在适当的时间重新回放视图中应用记录的事件。

Session Replay Record 支持 RUM Browser SDK 支持的所有浏览器，IE11 除外。

### 使用

Session Replay Record 功能集成在 RUM SDK 中, 所以不需要额外引入其他包或者外部插件。

### 如何开启 Session Replay

通过您之前的 SDK 引入方式，替换 NPM 包为 `> 3.0.0` 版本、或者替换原来的 CDN 链接为 `https://static.guance.com/browser-sdk/v3/dataflux-rum.js。` SDK 初始化 `init()` 之后并不会自动采集 Session Replay Record 数据，需要执行 `startSessionReplayRecording` 开启数据的采集，这对于一些只采集特定情况 Session Replay Record 数据很有用， 比如：

```js
// 只采集用户登录之后的操作数据
if (user.isLogin()) {
  DATAFLUX_RUM.startSessionReplayRecording()
}
```

#### NPM

引入 @cloudcare/browser-rum 包，并且保证 [@cloudcare/browser-rum](https://www.npmjs.com/package/@cloudcare/browser-rum) 的版本 `> 3.0.0`, 如果要开始录制，在初始化后，请执行 `datafluxRum.startSessionReplayRecording()`.

```js
import { datafluxRum } from '@cloudcare/browser-rum'

datafluxRum.init({
  applicationId: '<DATAFLUX_APPLICATION_ID>',
  datakitOrigin: '<DATAKIT ORIGIN>',
  service: 'browser',
  env: 'production',
  version: '1.0.0',
  sessionSampleRate: 100,
  sessionReplaySampleRate: 100,
  trackInteractions: true
})

datafluxRum.startSessionReplayRecording()
```

#### CDN

替换原来的 CDN 地址 `https://static.guance.com/browser-sdk/v2/dataflux-rum.js` 为 `https://static.guance.com/browser-sdk/v3/dataflux-rum.js`, 并在执行 `DATAFLUX_RUM.init()` 之后，执行 `DATAFLUX_RUM.startSessionReplayRecording()`

```js
<script
src="https://static.guance.com/browser-sdk/v3/dataflux-rum.js"
type="text/javascript"
></script>
<script>
window.DATAFLUX_RUM &&
window.DATAFLUX_RUM.init({
    applicationId: '<DATAFLUX_APPLICATION_ID>',
    datakitOrigin: '<DATAKIT ORIGIN>',
    service: 'browser',
    env: 'production',
    version: '1.0.0',
    sessionSampleRate: 100,
    sessionReplaySampleRate: 100,
    trackInteractions: true,
})

window.DATAFLUX_RUM && window.DATAFLUX_RUM.startSessionReplayRecording()
</script>
```

### 如何实现仅采集错误相关的 Session Replay 数据（SDK 版本要求 `≥3.2.18`）

#### 功能说明

当页面发生错误时，SDK 将自动执行以下操作：

1. **回溯采集**：记录错误发生前 **1 分钟** 的完整页面快照
2. **持续录制**：从错误发生时刻起持续记录直至会话结束
3. **智能补偿**：通过独立采样通道确保错误场景的全覆盖

#### 配置示例

````javascript
<script
  src="https://static.guance.com/browser-sdk/v3/dataflux-rum.js"
  type="text/javascript"
></script>
<script>
// 初始化 SDK 核心配置
window.DATAFLUX_RUM && window.DATAFLUX_RUM.init({
   // 必填参数
   applicationId: '<DATAFLUX_APPLICATION_ID>',
   datakitOrigin: '<DATAKIT_ORIGIN>',

   // 环境标识
   service: 'browser',
   env: 'production',
   version: '1.0.0',

   // 采样策略配置
   sessionSampleRate: 100,          // 全量基础会话采集 (100%)
   sessionReplaySampleRate: 0,       // 关闭常规录屏采样
   sessionReplayOnErrorSampleRate: 100, // 错误场景 100% 采样

   // 辅助功能
   trackInteractions: true          // 启用用户行为追踪
});

// 强制开启录屏引擎（必须调用）
window.DATAFLUX_RUM && window.DATAFLUX_RUM.startSessionReplayRecording();
</script>

### Session Repaly 隐私设置

Session Replay 提供隐私控制，以确保任何公司都不会暴露敏感数据或个人数据。并且数据是加密存储的。
Session Replay 的默认隐私选项旨在保护最终用户隐私并防止敏感的组织信息被收集。

通过开启 Session Replay，可以自动屏蔽敏感元素，使其不被 RUM SDK 记录。

#### 配置

要启用您的隐私设置，请在您的 SDK 配置中将 defaultPrivacyLevel 设置为 mask-user-input、mask 或 allow。

```js
import { datafluxRum } from '@cloudcare/browser-rum'

datafluxRum.init({
  applicationId: '<DATAFLUX_APPLICATION_ID>',
  datakitOrigin: '<DATAKIT ORIGIN>',
  service: 'browser',
  env: 'production',
  version: '1.0.0',
  sessionSampleRate: 100,
  sessionReplaySampleRate: 100,
  trackInteractions: true,
  defaultPrivacyLevel: 'mask-user-input' | 'mask' | 'allow'
})

datafluxRum.startSessionReplayRecording()
````

更新配置后，您可以使用以下隐私选项覆盖 HTML 文档的元素：

#### Mask user input mode

屏蔽大多数表单字段，例如输入、文本区域和复选框值，同时按原样记录所有其他文本。输入被替换为三个星号 (\*\*\*)，文本区域被保留空间的 x 字符混淆。

注意：默认情况下，mask-user-input 是启用会话重播时的隐私设置。

#### Mask mode

屏蔽所有 HTML 文本、用户输入、图像和链接。应用程序上的文本被替换为 X，将页面呈现为线框。

#### Allow mode

记录所有数据

### 使用 `shouldMaskNode` 实现自定义节点屏蔽策略

在某些特殊场景中，可能需要对特定的 DOM 节点进行定制化屏蔽处理。例如，在安全等级较高的应用中，可能希望对页面中所有包含数值的文本内容进行统一屏蔽。这种需求可以通过配置 `shouldMaskNode` 回调函数来实现更灵活的隐私控制策略。

```js
import { datafluxRum } from '@cloudcare/browser-rum'

datafluxRum.init({
  applicationId: '<DATAFLUX_APPLICATION_ID>',
  datakitOrigin: '<DATAKIT ORIGIN>',
  service: 'browser',
  env: 'production',
  version: '1.0.0',
  sessionSampleRate: 100,
  sessionReplaySampleRate: 100,
  trackInteractions: true,
  defaultPrivacyLevel: 'mask-user-input' | 'mask' | 'allow',
  shouldMaskNode: (node, privacyLevel) => {
    if (node.nodeType === Node.TEXT_NODE) {
      // 如果是文本节点，判断内容是否包含数字
      const textContent = node.textContent || ''
      return /\d+/.test(textContent)
    }
    return false
  }
})

datafluxRum.startSessionReplayRecording()
```

上述示例中，shouldMaskNode 函数会针对所有文本节点进行判断，如果内容中包含数字（如金额、手机号等），则自动进行屏蔽处理，从而提升用户数据的隐私保护能力。

### 隐私的一些限制

为了数据安全考虑，不管你配置的 `defaultPrivacyLevel` 是何种模式，以下元素都会被屏蔽：

- password、email 和 tel 类型的输入元
- 具有 `autocomplete` 属性的元素，例如信用卡号、到期日期和安全代码

## 注意事项

### 某些 HTML 元素在播放时候不可见

会话重播不支持以下 HTML 元素：iframe、视频、音频或画布。 Session Replay 不支持 Web Components 和 Shadow DOM。

### FONT 或 IMG 无法正确呈现

Session Replay 不是视频，而是基于 DOM 快照重建的 iframe。因此，重播取决于页面的各种静态资源：font 和 image。

由于以下原因，重播时静态资源可能不可用：

- 该静态资源已经不存在。例如，它是以前部署的一部分。
- 该静态资源不可访问。例如，可能需要身份验证，或者资源可能只能从内部网络访问。
- 由于 CORS（通常是网络字体），静态资源被浏览器阻止。

  1. 由于重播时，是基于 iframe 对应的 `guance.com` 沙箱环境，如果某些静态资源未获得特定域名授权，您的浏览器将阻止该请求。
  2. 通过 Access-Control-Allow-Origin Header 头允许 `guance.com` 访问您的网站所依赖的任何 font 或 image 静态资源，以确保可以访问这些资源以进行重播。有关详细信息，请参阅[跨源资源共享](https://developer.mozilla.org/en-US/docs/W)。

### CSS style 未正确应用或者鼠标悬停事件未重播

与 font 和 image 不同，Session Replay Record 尝试利用 [CSSStyleSheet](https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet) 接口，将应用的各种 CSS 规则捆绑为记录数据的一部分。如果不能被执行，它会回退到记录 CSS 文件的链接。

要获得正确的鼠标悬停支持，必须可以通过 CSSStyleSheet 接口访问 CSS 规则。

如果样式文件托管在与网页不同的域上，则对 CSS 规则的访问将受到浏览器的跨源安全检查，并且必须指定浏览器使用 [crossorigin](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/crossorigin) 属性加载利用 CORS 的样式文件。

例如，如果您的应用程序位于 example.com 域上并通过 link 元素依赖于 assets.example.com 上的 CSS 文件，则 `crossorigin` 属性应设置为 `anonymous`.

```js
<link rel="stylesheet" crossorigin="anonymous"
      href="https://assets.example.com/style.css”>
```

此外，在 assets.example.com 中授权 example.com 域。这允许资源文件通过设置 [Access-Control-Allow-Origin](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Origin) Header 头来正确加载资源。
