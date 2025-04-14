# 跟踪用户操作

## 概述

浏览器监控会自动检测用户旅程中执行的用户交互，并深入了解用户的行为，而无需您手动检测应用程序中的每次点击。

您可以实现以下目标：

- 了解关键交互的性能（例如，单击某个操作按钮）
- 量化功能采用情况
- 确定某个浏览器错误的步骤

## 控制是否开启采集 Action 采集

`trackUserInteractions` 初始化参数可以收集应用中的用户点击，这意味着页面中包含的敏感和私有数据可能会被包含在内，以识别用户与之交互的元素。

## 跟踪用户交互

RUM SDK 自动跟踪点击次数。 如果满足**以下所有**条件，则会创建点击操作：

- 检测到点击后的活动。
- 单击不会导致加载新页面，在这种情况下， RUM SDK 会生成另一个 RUM View 事件。
- 可以为该操作计算一个名称。

## Action 指标

| 指标                            | 类型       | 描述                             |
| ------------------------------- | ---------- | -------------------------------- |
| `action.loading_time`           | number(ns) | 动作的加载时间。                 |
| `action.action_long_task_count` | number     | 为此操作收集的所有长任务的计数。 |
| `action.action_resource_count`  | number     | 为此操作收集的所有资源的计数。   |
| `action.action_error_count`     | number     | 为此操作收集的所有错误的计数。   |

RUM SDK 通过监听每次点击后的页面活动来计算操作加载时间。 当页面不再有活动时，操作被视为完成。

## Action 属性

| 属性                   | 类型   | 描述                                                                                            |
| ---------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `action.id`            | String | 用户操作的 UUID。                                                                               |
| `action.action_type`   | String | 用户操作的类型。 对于自定义用户操作，它设置为“custom”。                                         |
| `action.action_target` | String | 用户与之交互的元素。 仅适用于自动收集的操作。                                                   |
| `action.action_name`   | String | 创建用户友好的名称（例如“Click on #checkout”）。 对于自定义用户操作，API 调用中给出的操作名称。 |

## Action 操作的名称

RUM SDK 使用各种策略来获取单击操作的名称。 如果您想要更多控制，可以在可点击元素（或其任何父元素）上定义 “data-guance-action-name”属性。

例如：

```html
<a
  class="btn btn-default"
  href="#"
  role="button"
  data-guance-action-name="测试按钮"
  >点击一下！</a
>
```

使用 `actionNameAttribute` 初始化参数，可以为元素添加自定义属性来指定操作的名称

例如：

```html
<脚本>
   window.DATAFLUX_RUM.init({
     ...
     trackUserInteractions: true,
     actionNameAttribute: 'data-custom-name',
   ...
   })
</脚本>

<a class="btn btn-default" href="#" role="button" data-custom-name="点击按钮">点击一下！</a>
```

当元素上同时存在这两个属性时，会优先使用“data-guance-action-name”。

## 发送自定义 Action

要扩展用户 Action 数据，请使用“addAction” API 发送自定义操作。
