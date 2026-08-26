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

### Shadow DOM 中的 Action 命名

对于开放 Shadow DOM 内的点击，SDK 会使用实际点击元素生成 selector。Action 名称只从显式命名属性或按钮、链接、ARIA 等具有明确语义的交互元素中提取，不会将任意文本节点、表格行或卡片容器的聚合文本作为名称。

如果自定义可点击容器没有原生交互语义，请在点击元素或其祖先上添加 `data-guance-action-name`，或通过 `actionNameAttribute` 配置自定义命名属性：

```html
<div data-guance-action-name="Open Payment" role="button">
  <!-- payment details -->
</div>
```

该限制只应用于跨越 Shadow DOM 边界的自动 Action 命名，普通 DOM 保持原有命名策略。

## 自定义行为

如果自动采集不够，可以调用 `addAction()` 创建自定义 action。详细见 [自定义 Action](./custom-sdk/add-action.md)。
