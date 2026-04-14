# 用户行为追踪

## 概述

Guance RUM 可以自动识别用户点击行为，帮助你了解关键交互的性能、使用频率以及错误前的操作路径。

## 开启自动行为采集

使用 `trackUserInteractions: true` 后，SDK 会自动采集点击行为。

需要注意：

- 页面中的敏感文本可能会参与元素命名
- 对隐私要求较高的页面，应配合命名策略和事件过滤使用

## 自动行为的判定条件

一个点击行为会被记录为 action，通常需要同时满足：

- 点击后页面存在活动
- 点击没有直接触发新页面加载
- SDK 能拿到可用的 action 名称

## 常见指标

- `action.duration`
- `action.action_long_task_count`
- `action.action_resource_count`
- `action.action_error_count`

## Action 命名

你可以使用：

- `data-guance-action-name`
- 或 `actionNameAttribute`

来显式指定元素对应的行为名称。

```html
<button data-guance-action-name="Submit Order">Submit</button>
```

## 自定义行为

如果自动采集不够，可以调用 `addAction()` 创建自定义 action。详细见 [自定义 Action](./custom-sdk/add-action.md)。
