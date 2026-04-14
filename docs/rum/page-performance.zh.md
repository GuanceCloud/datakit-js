# 页面性能

持续优化用户体验离不开页面性能指标。Guance RUM 会自动采集页面访问过程中的关键性能数据，帮助你定位加载、交互和稳定性问题。

## 核心体验指标

常见指标包括：

- `LCP`
- `FID`
- `CLS`
- `FCP`
- `TTFB`

这些指标可以帮助你从“页面何时可见、何时可交互、是否稳定”几个维度判断页面体验。

## 页面指标

常见的 `view` 级字段包括：

- `view.time_spent`
- `view.loading_time`
- `view.largest_contentful_paint`
- `view.first_input_delay`
- `view.cumulative_layout_shift`
- `view.first_contentful_paint`
- `view.first_byte`
- `view.time_to_interactive`
- `view.dom_interactive`
- `view.dom_content_loaded`
- `view.dom_complete`
- `view.load_event`

## 单页应用

对于 SPA，SDK 会区分：

- `initial_load`
- `route_change`

并在 URL 变化后重新计算对应页面的性能数据。

## Loading Time 计算

Loading Time 基于两类信号判断页面是否仍在活跃加载：

- DOM 变化
- 网络请求活动

当页面在一段短时间内不再发生这些变化时，SDK 会认为当前页面已进入稳定状态，并以此作为页面加载完成的近似时刻。

## 建议

- 对持续轮询或长连接请求，建议配置 `excludedActivityUrls`，避免页面一直被判定为活跃。
- 看性能趋势时，优先按浏览器、设备和地域分组，否则容易把不同环境混在一起。
