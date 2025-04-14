# 页面性能

不断优化用户体验是所有网站取得长远成功的关键。无论您是一名企业家、营销人员，还是开发者，Web 指标都能帮助您量化网站的体验指数，并发掘改进的机会。

## Google 核心 Web 指标 (Google’s Core Web Vitals)

[Web Vitals](https://web.dev/vitals/) 是 Google 开创的一项新计划，旨在为网络质量信号提供统一指导，这些信号对于提供出色的网络用户体验至关重要。

核心 Web 指标的构成指标会随着时间的推移而发展 。当前针对 2020 年的指标构成侧重于用户体验的三个方面——加载性能、交互性和视觉稳定性——并包括以下指标（及各指标相应的阈值）：

![web-vitals](../assets/web-vitals.avif)

[Largest Contentful Paint (LCP) ](https://web.dev/lcp/):最大内容绘制，测量加载性能。为了提供良好的用户体验，LCP 应在页面首次开始加载后的 2.5 秒内发生。

[First Input Delay (FID)](https://web.dev/fid/) ：首次输入延迟，测量交互性。为了提供良好的用户体验，页面的 FID 应为 100 毫秒或更短。

[Cumulative Layout Shift (CLS)](https://web.dev/cls/) :累积布局偏移，测量视觉稳定性。为了提供良好的用户体验，页面的 CLS 应保持在 0.1. 或更少。

为了确保您能够在大部分用户的访问期间达成建议目标值，对于上述每项指标，一个良好的测量阈值为页面加载的第 75 个百分位数，且该阈值同时适用于移动和桌面设备。

## 页面采集指标

| 指标                                             | 类型（单位） | 简介                                                                                                                                                        |
| ------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `view.time_spent`                                | number(ns)   | 页面停留时间                                                                                                                                                |
| `view.loading_time`                              | number(ns)   | 页面已经 ready，并且没有任何网络请求和 DOM 变动，详情可参考 [页面 Loading Time](./page-performance.md)                                                      |
| `view.largest_contentful_paint`                  | number(ns)   | LCP 报告的是视口中可见最大图片或文本块的呈现时间（相对于用户首次导航到相应网页的时间）。为了提供良好的用户体验，LCP 应在页面首次开始加载后的 2.5 秒内发生。 |
| `view.largest_contentful_paint_element_selector` | string       | 产生 LCP 指标对应元素的 selector                                                                                                                            |
| `view.first_input_delay`                         | number(ns)   | 首次输入延迟，测量交互性。为了提供良好的用户体验，页面的 FID 应为 100 毫秒或更短。                                                                          |
| `view.cumulative_layout_shift`                   | number(ns)   | 累积布局偏移，测量视觉稳定性。为了提供良好的用户体验，页面的 CLS 应保持在 0.1. 或更少。                                                                     |

| `view.cumulative_layout_shift_target_selector` | number(ns) | 产生 CLS 指标对应元素的 selector |

| `view.first_input_delay` | number(ns) | 测量页面上首次互动的输入延迟， 目前已被 inp 代替 |

| `view.interaction_to_next_paint` | number(ns) | 通过考虑所有页面互动（从输入延迟到运行事件处理程序所需的时间，再到浏览器绘制下一帧）来改进 FID。 |

| `view.interaction_to_next_paint_target_selector` | number(ns) | 产生 inp 指标对应元素的 selector |

| `view.first_contentful_paint` | number(ns) | 首次内容绘制 (FCP) 指标测量页面从开始加载到页面内容的任何部分在屏幕上完成渲染的时间。对于该指标，"内容"指的是文本、图像（包括背景图像）、`<svg>`元素或非白色的 `<canvas>` 元素。 可参考 [w3c](https://www.w3.org/TR/paint-timing/#sec-terminology) |

| `view.first_byte` | number(ns) | 请求页面到页面响应第一个字节的时间 |
| `view.time_to_interactive` | number(ns) | 页面从开始加载到主要子资源完成渲染，并能够快速、可靠地响应用户输入所需的时间 |
| `view.dom_interactive` | number(ns) | 解析器完成文档解析的时间，详情可参考 [MDN](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceTiming/domInteractive) |
| `view.dom_content_loaded` | number(ns) | 当纯 HTML 被完全加载以及解析时，DOMContentLoaded 事件会被触发，而不必等待样式表，图片或者子框架完成加载,详情参考 [MDN](https://developer.mozilla.org/zh-CN/docs/Web/API/Document/DOMContentLoaded_event) |
| `view.dom_complete` | number(ns) | 页面和所有子资源都已准备就绪。对于用户来说，加载 loading 动画已停止旋转。详情可参考 [MDN](https://developer.mozilla.org/zh-CN/docs/Web/API/Window/DOMContentLoaded_event) |
| `view.load_event` | number(ns) | 整个页面及所有依赖资源如样式表和图片都已完成加载时触发，它与 `DOMContentLoaded` 不同，后者只要页面 DOM 加载完成就触发，无需等待依赖资源的加载。 详情可参考 [MDN](https://developer.mozilla.org/zh-CN/docs/Web/API/Window/load_event) |

## 关于单页应用（SPA）

对于单页应用程序 (SPA)，RUM 浏览器 SDK 使用 `loading_type` 标签区分 `initial_load` 和 `route_change`。RUM SDK 会生成一个带有 `loading_type:route_change` 标签的 `view`事件。 RUM 使用 [History API](https://developer.mozilla.org/en-US/docs/Web/API/History) 监听 URL 的改变。

## Loading Time 计算方式

基于现代浏览器提供了强大的 API 能力，Loading Time 会监听页面的 DOM 变化，以及网络请求情况。

- Initial Load：Loading Time 取下面两个较长者。
  - loadEventEnd - navigationStart
  - 页面第一次没有活动的时间 - navigationStart
- SPA Route Change: 页面第一次没有活动的时间 - url 变化的时间

## 页面的活动状态

满足下面条件之一，即判断页面是*活跃状态*：

- 页面 dom 是有变动的
- 有静态资源加载（加载 js,css, 等等）
- 有异步请求

Note：当页面在 100ms 内没有任何事件产生，则被认为当前页面是不活跃的

注意事项：
以下情况，可能会出现自上次请求或 DOM 变化以来 100 毫秒的标准可能无法准确确定活动：

- 该应用程序通过定期或在每次点击后向 API 发送请求来收集分析数据。
- 该应用程序使用“comet”技术（即流式传输或长轮询），请求将无限期保留。

为了在这些情况下提高活动确定的准确性，可以指定 excludedActivityUrls 配置 排除这些请求：

```js
window.DATAFLUX_RUM.init({
  excludedActivityUrls: [
    // 精确匹配
    'https://third-party-analytics-provider.com/endpoint',

    // 正则
    /\/comet$/,

    //通过 方法 返回 true，排除
    (url) => url === 'https://third-party-analytics-provider.com/endpoint'
  ]
})
```
