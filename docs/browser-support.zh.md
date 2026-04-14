# 浏览器支持

| 功能 | Chrome | Firefox | Safari | Edge | Chrome Android | Safari iOS | IE11 | `< IE11` | Opera |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| loading | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| init | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| rum request | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| flush on hide | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| console error | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| runtime error | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| CSP violation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| intervention | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| auto action | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| custom action | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| long task | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| tracing | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| route change | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| loading time | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| resource timing | ✅ | ✅ | ⚠️(2) | ✅ | ✅ | ⚠️(2) | ⚠️(3) | ❌ | ✅ |
| navigation timing | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| web vitals | ✅ | ⚠️(1) | ⚠️(1) | ✅ | ✅ | ⚠️(1) | ❌ | ❌ | ✅ |
| FCP | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |

1. 仅支持 FID。
2. Safari 对部分 `PerformanceResourceTiming` 字段支持不完整。
3. IE11 对资源时序相关字段支持有限。
