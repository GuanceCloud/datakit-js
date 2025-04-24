# Changelog

## v3.2.23

- fix: bug tracingSampleRate default 100

## v3.2.22

- fix: remove monitor console

## v3.2.21

- 

## v3.2.19

- fix: track setErrorForSession
- fix: add firsthidden visible change
- feat: 添加 shouldMaskNode 屏蔽 session replay 节点自定义屏蔽效果
- fix: add doc
- fix: add sessionOnErrorSampleRate configuration
- fix: add sampled_for_error_replay field
- fix: add replaysOnErrorSampleRate desc
- fix: add replaysOnErrorSampleRate only collection error session replay

## v3.2.18

- fix: 修改view name 获取方式

## v3.2.17

- fix: 修复设置cookie 获取条件问题

## v3.2.16

- fix: 删除 decodeURIComponent 处理逻辑

## v3.2.15

- fix: matchRequestResourceEntry entrys length more 2
- feat: 添加view 的操作 api

## v3.2.14

- fix: getSelectorFromElement memeory size

## v3.2.13

- fix: hasRedirection update redirectEnd
- fix: 修改 超时 flush 的时间
- fix: 添加telemtry 类型数据上报

## v3.2.12

- fix: 修改 采集资源是，entry 作用域问题

## v3.2.11

- fix: 添加deliveryType，protocol
- feat: 修改 resource_url、resource_url_query 到field 类型

## v3.2.10

- fix: statusGroup bug

## v3.2.9

- feat: add generateTraceId configuration

## v3.2.8

- feat: add retryMaxSize config
- fix: remove console

## v3.2.7

- fix: 修改 sessionSampleRate 为 0 的情况下，出现的值为100 的bug

## v3.2.6

- feat: 添加 storeage 存储功能
- feat: 添加 allowFallbackToLocalStorage 属性，当cookie 不可用时，回退到local

## v3.2.5

- fix: deflate bug

## v3.2.4

- feat: 添加资源采集延迟逻辑

## v3.2.3

- fix: update babel config
- fix: log and rum getInitConfiguration
- fix: 删除renderBlockingStatus 默认值

## v3.2.2

- fix: remove console
- fix: 添加ie 浏览器支持
- fix: 添加babel 兼容ie

## v3.2.1

- fix: 修改cookie authorized 问题

## v3.2.0

- feat: add longAnimationFrameCollection
- fix: cls handler
- fix: add docs
- fix: markdown
- fix: add error stack and error message
- feat: update cls handler
- Merge branch 'dev' into feature-compress-data
- fix: console error bug
- fix: sendbeacon error handler
- fix: add resource id
- fix: fetch handler
- fix: add worker url config
- fix: status
- fix: remove other import
- fix: add config
- feat: add compress data handler

## v3.1.24

- fix: add log types
- fix: remove monitor
- feat: 修改 longtask ，以及 view 部分指标的获取方式

## v3.1.23

- fix: monitor handler

## v3.1.22

- fix: 修改 loadingTime 在活动状态下，可能为空的情况

## v3.1.21

- fix: computeRelativePerformanceTiming handler
- fix: update firstHidden to loadingTime

## v3.1.20

- fix: 添加 resource 获取资源为负数的判断
- feat: add cumulative_layout_shift_time metric
- feat: 修改 performance 处理方式
- fix: remove resourceCollection pagehistory
- feat: add allowedTracingUrls 配置
- fix: 修改设备获取方式
- feat: contextHistory to valueHistory
- feat: add instrumentMethod handle replace instrumentMethodAndCallOriginal
- feat: add quick-start.md

## v3.1.19

- fix: add hash handler

## v3.1.18

- feat: add storeContextsKey configuration
- Merge branch 'master' into dev
- fix: request duration handler
- feat: add error handle stack

## v3.1.17

- Merge branch 'dev'
- fix: remove hide end view bug
- feat: fadd common fields drift
- add changeLog

## v3.1.16

- fix: CLS cumulatedValue bug
- fix: add injectTraceHeader context
- fix: update license

## v3.1.15

- feat: add injectTraceHeader configuration
- fix: interactiontonextPaint selector bug
- fix: 处理 hash 问题
- feat: add trackResum handler
- fix: getSelectorFromElement add isConnected handler
- fix: 修改 resourceCollection validateEntry 逻辑
- fix: action duration 为负数 bug
- fix: add source:browser to all RUM Events
- fix: cls detached node 内存泄露 bug
- fix: update script
- fix: doc
- feat: 添加部分 md 文档

## v3.1.14

- fix: 修复 rum logs 类型定义

## v3.1.13

- fix: 添加 typescript 注解
- fix: 修复 typescript 定义错误
- fix: 修改 hash 模式 path 获取方式
- fix: buildUrlContext path group bug
- fix: 添加 iframe 屏蔽信息
- feat: updrade learn version

## v3.1.12

- feat: 修改 webpack 版本
- feat: 添加第三方 cookie 支持
- fix: 添加 resource url dataURL 处理
- fix: 忽略滚动对 action 的处理
- feat: add resource collection decodeSize,encodeSize
- fix: trackCumulativeLayoutShift target element connected

## v3.1.11

- feat: Optimize DOM iteration
- fix: fix unexpected session renewal after expire() ([#2632](https://gitlab.jiagouyun.com/cloudcare/dataflux-rum-sdk-javscript/pull/2632))
- fix: 添加 error causes 字段
- fix: add getNodePrivacyLevel cache handler

## v3.1.10

- fix: update npmignore

## v3.1.9

- fix: add package.json repository directory
- fix: types
- fix: update ignore
- feat: add types d.ts file
- merge test unit branch
- feat: update bebel config exclude to ignore
- feat: 添加 exclude spec file
- feat: add test unit
- fix: remove TODO

## v3.1.8

- fix: method undefined
- fix: update worker bug
- fix: observable first function handler
- feat: add view metric sampled_for_replay
- feat: add config metric
- feat: add ds_store ignore
- fix: 重复 shadowroot bug

## v3.1.7

- fix: stop session bug

## v3.1.6

- fix: 修改 view_url_query 逻辑
- fix: .ds_store
- fix: xx
- fix: remove pagestate isTrust hanler
- updrade verstion to 3.1.5
- fix: update changelog

## v3.1.5

- fix: add deviceInfo monitor
- fix: headless bug
- add public dataway configuration
- feat: add resource filter handler
- fix: isSafir to webview bug
- fix: remove resource console
- fix: fix first_paint_time collection bug

## v3.1.4

- fix: \_dd to \_gc
- updrade: changelog

## v3.1.3

- feat: 1. add cumulative_layout_shift_target_selector, first_input_target_selector,interaction_to_next_paint_target_selector metric
- feat: add config to json send data
- feat: update changelog
- feat: add storeContextsToLocal configuration to localstorage global context
- fix: fix memory leak when using shadow dom

## v3.1.2

- feat: add storeContextsToLocal configuration to localstorage global context
- fix: fix memory leak when using shadow dom

## v3.1.1

- fix: bug
- feat: add storeContextsToLocal configuration to localstorage global context
- fix: fix memory leak when using shadow dom

## v3.1.1

- fix: remove console
- fix: update session replay deflate handler
- fix: update changelog

## v3.1.0

- fix: clickCollection bug
- feat: add view scroll metric
- fix: remove style tag child serialize
- feat: add csp md
- fix: isHashAnAnchor hash handler
- fix: serialize isShadow remove
- fix: add shadowroot bug
- feat: add lts version handler
- fix: update publish cdn handler
- fix: update logger telemetry
- add telemetry

## v3.0.29

- fix: serialze bug
- feat: add monitor callback handler
- fix: 修改 generate-changelog.js
- comment: add changelog
- feat: updrade version
- fix: update ci
- fix: 修改 command ci cmd help
- feat: 添加 changelog 配置
- feat: update changlog ci
- feat: add changelog ci
- fix: update esm modules handler
- fix: esm handler
- fix: add cssEscape tagName
