# Web Application Data Collection

---

After collecting application data to Guance, you can perform custom configuration scenarios and configure anomaly detection events through the Guance console.

## Data Types

Guance's RUM includes six types of data:

| Type      | Description                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| session   | User session information records. Within the current session, user page, resource, operation, error, and long task related access data are captured based on session dimensions.                                   |
| view      | When a user visits a page, a page view record is generated. When a user stays on the same page, resources, long tasks, errors, and operation logs are linked to the relevant RUM view via the `view_id` attribute. |
| resource  | Records of resource information loaded when a user visits a page.                                                                                                                                                  |
| error     | Collects all front-end errors from the browser.                                                                                                                                                                    |
| long_task | Any task in the browser that blocks the main thread for more than 50ms generates a long task record.                                                                                                               |
| action    | Tracks all user interaction records during page browsing.                                                                                                                                                          |

## Global Attributes

Scenarios building and event alerts for RUM can be queried using the following global attributes.

### SDK Attributes

| Field         | Type   | Description                                                                                                          |
| ------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `sdk_name`    | string | Collector name, fixed names:<br>`df_web_rum_sdk`<br>`df_miniapp_rum_sdk`<br>`df_ios_rum_sdk`<br>`df_android_rum_sdk` |
| `sdk_version` | string | Collector version information.                                                                                       |

### Application Attributes

| Field     | Type   | Description                                                                                                                                                                                                                             |
| --------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_id`  | string | Required, unique ID identifying the user-accessed application. Automatically generated when creating monitoring in the Guance console.                                                                                                  |
| `env`     | string | Required, environment field. Values: prod/gray/pre/common/local. Where:<br>prod: production environment;<br>gray: gray release environment;<br>pre: pre-release environment;<br>common: daily environment;<br>local: local environment. |
| `version` | string | Required, version number.                                                                                                                                                                                                               |
| `service` | string | Required, value corresponding to the service field configured within the user-accessed SDK.                                                                                                                                             |

### User & Session Attributes

| Field          | Type    | Description                                                                                                                                                                                                        |
| -------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `userid`       | string  | Default is to get the browser Cookie as `userid`. If [custom user identifier](./custom-sdk/user-id.md) sets the user id, then `userid` will match the defined one.<br>:warning: Cookie expiration time is 60 days. |
| `session_id`   | string  | Session ID (if no interaction occurs within 15 minutes, the session is considered expired).                                                                                                                        |
| `session_type` | string  | Session type. Reference values: user & synthetics:<br><li>user: data generated by RUM features;<br><li>synthetics: data generated by headless tests.                                                               |
| `is_signin`    | boolean | Whether it is a registered user, attribute values: True / False.                                                                                                                                                   |

### Device & Resolution Attributes

| Field                   | Type   | Description                                           |
| :---------------------- | :----- | :---------------------------------------------------- |
| `os`                    | string | Operating system                                      |
| `os_version`            | string | Operating system version                              |
| `os_version_major`      | string | Major operating system version reported by the device |
| `browser`               | string | Browser provider                                      |
| `browser_version`       | string | Browser version                                       |
| `browser_version_major` | string | Major browser version information                     |
| `screen_size`           | string | Screen width\*height, resolution                      |

### Geographic & Network Attributes

| Field              | Type   | Description                                                                                                                                                         |
| ------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ip`               | string | User access IP address                                                                                                                                              |
| `isp`              | string | Internet Service Provider                                                                                                                                           |
| `network_type`     | string | Network connection type, reference values:<br>wifi &#124; 2g &#124; 3g &#124; 4g &#124; 5g &#124; unknown (unknown network)&#124; unreachable (unavailable network) |
| `country`          | string | Country                                                                                                                                                             |
| `country_iso_code` | string | Country `iso_code`                                                                                                                                                  |
| `province`         | string | Province                                                                                                                                                            |
| `city`             | string | City                                                                                                                                                                |

## Custom Attributes

In addition to global attributes, scenes can be built and events configured using custom attributes (**SDK supports users tagging custom data**). Custom attributes are non-global attributes. By using custom attributes, you can track the entire process of user access to applications, identify and discover affected user access situations, and monitor user access performance.

## Other Data Type Attributes

### Session

#### Attributes

| Field                           | Type   | Description                                                                                                                                          |
| ------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_id`                    | string | Session ID (if no interaction occurs within 15 minutes, the session is considered expired)                                                           |
| `session_type`                  | string | Session type. Reference values: user & synthetics:<br><li>user: data generated by RUM features;<br><li>synthetics: data generated by headless tests. |
| `session_first_view_id`         | string | The `view_id` of the first page in the current session                                                                                               |
| `session_first_view_url`        | string | The URL of the first page in the current session                                                                                                     |
| `session_first_view_host`       | string | The domain name of the first page in the current session                                                                                             |
| `session_first_view_path`       | string | The address of the first page in the current session                                                                                                 |
| `session_first_view_path_group` | string | The grouped address of the first page in the current session                                                                                         |
| `session_first_view_url_query`  | string | Query information of the first page in the current session                                                                                           |
| `session_first_view_name`       | string | Address group of the first page in the current session, same as the `session_first_view_path_group` field                                            |
| `session_last_view_id`          | string | The `view_id` of the last visited page in the current session                                                                                        |
| `session_last_view_url`         | string | The URL of the last page in the current session                                                                                                      |
| `session_last_view_host`        | string | The domain name of the last page in the current session                                                                                              |
| `session_last_view_path`        | string | The address of the last page in the current session                                                                                                  |
| `session_last_view_path_group`  | string | The grouped address of the last page in the current session                                                                                          |
| `session_last_view_url_query`   | object | Query information of the last page in the current session                                                                                            |
| `session_last_view_name`        | string | Address group of the last page in the current session, same as the `session_last_view_path_group` field                                              |

#### Metrics

| Field                      | Type       | Description                                           |
| -------------------------- | ---------- | ----------------------------------------------------- |
| `time_spent`               | number(ns) | Duration of the current session                       |
| `session_time_spent_count` | number     | Counted every 4 hours if exceeded                     |
| `session_view_count`       | number     | Number of associated `view_id` in the current session |
| `session_error_count`      | number     | Number of errors generated in the current session     |
| `session_resource_count`   | number     | Number of resources loaded in the current session     |
| `session_action_count`     | number     | Number of user operations in the current session      |
| `session_long_task_count`  | number     | Number of long tasks generated in the current session |

### View

#### Attributes

| Field               | Type   | Description                                                                                     |
| ------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `view_id`           | string | Unique ID generated each time a page is visited                                                 |
| `view_loading_type` | string | Page loading type, reference values: `initial_load` `route_change` `route_change` for SPA pages |
| `view_referrer`     | string | Referrer of the page                                                                            |
| `view_url`          | string | Page URL                                                                                        |
| `view_host`         | string | Domain part of the page URL                                                                     |
| `view_path`         | string | Path part of the page URL                                                                       |
| `view_path_group`   | string | Grouped path part of the page URL                                                               |
| `view_url_query`    | string | Query part of the page URL                                                                      |

#### Metrics

| Metric                                      | Type (unit)  | Brief Description                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `loading_time`                              | number(ns)   | Time when the page is ready with no network requests or DOM changes, refer to [Page Loading Time](./page-performance.md#loading-time)                                                                                                                                                                                                      |
| `largest_contentful_paint`                  | number(ns)   | LCP reports the rendering time of the largest image or text block visible in the viewport relative to the initial navigation. For good user experience, LCP should occur within 2.5 seconds after the page starts loading.                                                                                                                 |
| `largest_contentful_paint_element_selector` | string       | Selector of the element generating the LCP metric                                                                                                                                                                                                                                                                                          |
| `cumulative_layout_shift`                   | number(ns)   | Cumulative Layout Shift measures visual stability. For good user experience, the CLS should be kept at 0.1 or less.                                                                                                                                                                                                                        |
| `cumulative_layout_shift_target_selector`   | number(ns)   | Selector of the element generating the CLS metric                                                                                                                                                                                                                                                                                          |
| `first_input_delay`                         | number(ns)   | Measures the input delay on the first interaction on the page, now replaced by inp                                                                                                                                                                                                                                                         |
| `interaction_to_next_paint`                 | number(ns)   | Improves FID by considering all page interactions (from input delay to running event handlers and the time taken for the browser to paint the next frame).                                                                                                                                                                                 |
| `interaction_to_next_paint_target_selector` | number(ns)   | Selector of the element generating the inp metric                                                                                                                                                                                                                                                                                          |
| `first_contentful_paint`                    | number(ns)   | First Contentful Paint (FCP) measures the time from the start of the page load until any part of the page content has been rendered on the screen. "Content" refers to text, images (including background images), `<svg>` elements, or non-white `<canvas>` elements. Refer to [w3c](https://www.w3.org/TR/paint-timing/#sec-terminology) |
| `first_byte`                                | number(ns)   | Time from requesting the page to receiving the first byte of the response                                                                                                                                                                                                                                                                  |
| `dom_interactive`                           | number(ns)   | Time when the parser completes document parsing, refer to [MDN](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceTiming/domInteractive)                                                                                                                                                                                         |
| `dom_content_loaded`                        | number(ns)   | Triggered when pure HTML is fully loaded and parsed without waiting for stylesheets, images, or subframes to complete loading. Refer to [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Document/DOMContentLoaded_event)                                                                                                            |
| `dom_complete`                              | number(ns)   | Indicates that the page and all its sub-resources are fully ready. For users, the loading spinner stops spinning. Refer to [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/DOMContentLoaded_event)                                                                                                                           |
| `load_event`                                | number(ns)   | Triggered when the entire page and all dependent resources such as stylesheets and images have completed loading. It differs from `DOMContentLoaded`, which triggers as soon as the page DOM is loaded without waiting for dependent resources. Refer to [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/load_event)         |
| `resource_load_time`                        | number（ns） | Resource loading time<br>Calculated as: loadEventStart - domContentLoadedEventEnd                                                                                                                                                                                                                                                          |
| `time_to_interactive`                       | number（ns） | Time to interactive<br>Calculated as: domInteractive - fetchStart                                                                                                                                                                                                                                                                          |
| `dom`                                       | number（ns） | DOM parsing time<br>Calculated as: domComplete - domInteractive                                                                                                                                                                                                                                                                            |
| `dom_ready`                                 | number（ns） | DOM Ready time<br>Calculated as: domContentLoadedEventEnd - navigationStart                                                                                                                                                                                                                                                                |
| `time_spent`                                | number（ns） | Page dwell time                                                                                                                                                                                                                                                                                                                            |
| `is_active`                                 | boolean      | Determines whether the user is still active, reference values: true & false                                                                                                                                                                                                                                                                |

#### Statistics Metrics

| Field                  | Type   | Description                                                                                                                                                  |
| ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `view_error_count`     | number | Number of errors occurring each time the page loads                                                                                                          |
| `view_resource_count`  | number | Number of resources requested each time the page loads                                                                                                       |
| `view_long_task_count` | number | Number of long tasks generated each time the page loads                                                                                                      |
| `view_action_count`    | number | Number of operations during the page view                                                                                                                    |
| `view_apdex_level`     | number | Page Apdex satisfaction.<br>Base metric: `first_paint_time` (converted to seconds)<br>Reference values: 0/1/2/3/4/5/6/7/8/9 (where 9 indicates >= 9 seconds) |

### Resource

#### View Attributes

| Field               | Type    | Description                                                                  |
| :------------------ | :------ | :--------------------------------------------------------------------------- |
| `view_id`           | string  | Unique ID generated each time a page is visited                              |
| `is_active`         | boolean | Determines whether the user is still active, reference values: true \| false |
| `view_loading_type` | string  | Page loading type, reference values: `initial_load`                          |
| `view_referrer`     | string  | Referrer of the page                                                         |
| `view_url`          | string  | Page URL                                                                     |
| `view_host`         | string  | Domain part of the page URL                                                  |
| `view_path`         | string  | Path part of the page URL                                                    |
| `view_path_group`   | string  | Grouped path part of the page URL                                            |
| `view_url_query`    | string  | Query part of the page URL                                                   |

#### Resource Attributes

| Field                     | Type   | Description                                          |
| ------------------------- | ------ | ---------------------------------------------------- |
| `resource_url`            | string | Resource URL                                         |
| `resource_url_host`       | string | Domain part of the resource URL                      |
| `resource_url_path`       | string | Path part of the resource URL                        |
| `resource_url_query`      | string | Query part of the resource URL                       |
| `resource_url_path_group` | string | Grouped path part of the resource URL                |
| `resource_type`           | string | Category of the resource                             |
| `resource_method`         | string | Resource request method                              |
| `resource_status`         | string | Status code returned by the resource request         |
| `resource_status_group`   | string | Grouped status code returned by the resource request |

#### Metrics

| Field                 | Type         | Description                                                                                 |
| --------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| `resource_size`       | number       | Resource size, default unit: byte                                                           |
| `resource_dns`        | number（ns） | DNS lookup time for resource loading<br>Calculated as: domainLookupEnd - domainLookupStart  |
| `resource_tcp`        | number（ns） | TCP connection time for resource loading<br>Calculated as: connectEnd - connectStart        |
| `resource_ssl`        | number（ns） | SSL connection time for resource loading<br>Calculated as: connectEnd - secureConnectStart  |
| `resource_ttfb`       | number（ns） | Response time for resource loading<br>Calculated as: responseStart - requestStart           |
| `resource_trans`      | number（ns） | Content transfer time for resource loading<br>Calculated as: responseEnd - responseStart    |
| `resource_first_byte` | number（ns） | Time to first byte for resource loading<br>Calculated as: responseStart - domainLookupStart |
| `duration`            | number（ns） | Total resource loading time<br>Calculated as: duration(responseEnd-startTime)               |

### Error

#### View Attributes

| Field               | Type    | Description                                                                  |
| :------------------ | :------ | :--------------------------------------------------------------------------- |
| `view_id`           | string  | Unique ID generated each time a page is visited                              |
| `is_active`         | boolean | Determines whether the user is still active, reference values: true \| false |
| `view_loading_type` | string  | Page loading type, reference values: `initial_load`                          |
| `view_referrer`     | string  | Referrer of the page                                                         |
| `view_url`          | string  | Page URL                                                                     |
| `view_host`         | string  | Domain part of the page URL                                                  |
| `view_path`         | string  | Path part of the page URL                                                    |
| `view_path_group`   | string  | Grouped path part of the page URL                                            |
| `view_url_query`    | string  | Query part of the page URL                                                   |

#### Error Attributes

| Field                     | Type   | Description                                                                                                                     |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `error_source`            | string | Error source, reference values: console &#124; network &#124; source &#124; custom                                              |
| `error_type`              | string | Error type, refer to link: [error type](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error) |
| `resource_status`         | string | Status code returned by the resource request                                                                                    |
| `resource_url`            | string | Resource URL                                                                                                                    |
| `resource_url_host`       | string | Domain part of the resource URL                                                                                                 |
| `resource_url_path`       | string | Path part of the resource URL                                                                                                   |
| `resource_url_path_group` | string | Grouped path part of the resource URL                                                                                           |
| `resource_method`         | string | Resource request method                                                                                                         |

#### Metrics

| Field           | Type   | Description   |
| --------------- | ------ | ------------- |
| `error_message` | string | Error message |
| `error_stack`   | string | Error stack   |

### Long Task

#### View Attributes

| Field               | Type    | Description                                                                  |
| :------------------ | :------ | :--------------------------------------------------------------------------- |
| `view_id`           | string  | Unique ID generated each time a page is visited                              |
| `is_active`         | boolean | Determines whether the user is still active, reference values: true \| false |
| `view_loading_type` | string  | Page loading type, reference values: `initial_load`                          |
| `view_referrer`     | string  | Referrer of the page                                                         |
| `view_url`          | string  | Page URL                                                                     |
| `view_host`         | string  | Domain part of the page URL                                                  |
| `view_path`         | string  | Path part of the page URL                                                    |
| `view_path_group`   | string  | Grouped path part of the page URL                                            |
| `view_url_query`    | string  | Query part of the page URL                                                   |

#### Metrics

| Field      | Type         | Description                                  |
| ---------- | ------------ | -------------------------------------------- |
| `duration` | number（ns） | Time spent on long tasks during page loading |

### Action

#### View Attributes

| Field               | Type    | Description                                                                  |
| :------------------ | :------ | :--------------------------------------------------------------------------- |
| `view_id`           | string  | Unique ID generated each time a page is visited                              |
| `is_active`         | boolean | Determines whether the user is still active, reference values: true \| false |
| `view_loading_type` | string  | Page loading type, reference values: `initial_load`                          |
| `view_referrer`     | string  | Referrer of the page                                                         |
| `view_url`          | string  | Page URL                                                                     |
| `view_host`         | string  | Domain part of the page URL                                                  |
| `view_path`         | string  | Path part of the page URL                                                    |
| `view_path_group`   | string  | Grouped path part of the page URL                                            |
| `view_url_query`    | string  | Query part of the page URL                                                   |

#### Action Attributes

| Field         | Type   | Description                                     |
| ------------- | ------ | ----------------------------------------------- |
| `action_id`   | string | Unique ID generated during user page operations |
| `action_name` | string | Operation name                                  |
| `action_type` | string | Operation type                                  |

#### Metrics

| Field      | Type         | Description                      |
| ---------- | ------------ | -------------------------------- |
| `duration` | number（ns） | Time spent on the page operation |

#### Statistics Metrics

| Field                    | Type   | Description                            |
| ------------------------ | ------ | -------------------------------------- |
| `action_long_task_count` | number | Number of associated long tasks        |
| `action_resource_count`  | number | Number of associated resource requests |
| `action_error_count`     | number | Number of associated errors            |
