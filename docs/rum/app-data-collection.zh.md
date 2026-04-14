# Web 应用数据采集

## 数据类型

Guance RUM 主要包含 6 类数据：

| 类型 | 说明 |
| --- | --- |
| `session` | 会话级信息，关联当前会话下的页面、资源、操作、错误和长任务。 |
| `view` | 页面访问记录，同一页面停留期间采集到的资源、长任务、错误和操作会关联到对应 `view_id`。 |
| `resource` | 页面加载的静态资源与网络资源信息。 |
| `error` | 浏览器端捕获到的各类前端错误。 |
| `long_task` | 主线程阻塞超过 50ms 的长任务。 |
| `action` | 用户交互行为记录。 |

## 全局属性

### SDK 属性

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `sdk_name` | string | SDK 名称，例如 `df_web_rum_sdk`。 |
| `sdk_version` | string | SDK 版本。 |

### 应用属性

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `app_id` | string | 应用唯一标识，创建应用时生成。 |
| `env` | string | 环境，例如 `prod`、`gray`、`pre`、`common`、`local`。 |
| `version` | string | 版本号。 |
| `service` | string | 服务名。 |

### 用户与会话属性

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `userid` | string | 默认使用 Cookie 生成；也可以通过自定义用户标识覆盖。 |
| `session_id` | string | 会话 ID。15 分钟无活动视为会话结束。 |
| `session_type` | string | 会话类型，例如 `user` 或 `synthetics`。 |
| `is_signin` | boolean | 是否为已登录用户。 |

### 设备与网络属性

常见字段包括：

- `os`
- `os_version`
- `browser`
- `browser_version`
- `screen_size`
- `network_type`
- `country`
- `province`
- `city`

这些字段会随着浏览器能力和部署环境不同而有所差异。

## 使用建议

- 业务侧做筛选和告警时，优先结合 `app_id`、`env`、`service`、`version` 这组字段。
- 用户分析建议结合 `userid`、`session_id`、`view_id` 观察。
- 对性能与异常做横向对比时，应尽量按浏览器、系统、地域分组。
