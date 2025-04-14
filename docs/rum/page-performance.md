# Page Performance

Continuously optimizing user experience is key to the long-term success of all websites. Whether you are an entrepreneur, marketer, or developer, web metrics can help you quantify the experience index of your website and uncover opportunities for improvement.

## Google Core Web Vitals

[Web Vitals](https://web.dev/vitals/) is a new initiative by Google aimed at providing unified guidance for web quality signals that are essential for delivering an excellent web user experience.

The metrics that constitute Core Web Vitals evolve over time. The current metrics for 2020 focus on three aspects of user experience—loading performance, interactivity, and visual stability—and include the following metrics (along with their respective thresholds):

[Largest Contentful Paint (LCP)](https://web.dev/lcp/): Measures loading performance. To provide a good user experience, LCP should occur within 2.5 seconds of the page first starting to load.

[First Input Delay (FID)](https://web.dev/fid/): Measures interactivity. To provide a good user experience, the page's FID should be 100 milliseconds or less.

[Cumulative Layout Shift (CLS)](https://web.dev/cls/): Measures visual stability. To provide a good user experience, the page's CLS should be kept at 0.1 or less.

To ensure you meet the recommended target values for most users during their visits, a good measurement threshold for each metric is the 75th percentile of page loads, applicable to both mobile and desktop devices.

## Page Collection Metrics

| Metric                          | Type (Unit) | Description                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `view.time_spent`               | number(ns)  | Time spent on the page.                                                                                                                                                                                                                                                                                                                          |
| `view.loading_time`             | number(ns)  | The page has reached the ready state and there are no network requests or DOM changes.<br/>> See [Page Loading Time](./page-performance.md#loading-time).                                                                                                                                                                                        |
| `view.largest_contentful_paint` | number(ns)  | Largest Contentful Paint, measuring loading performance. To provide a good user experience, LCP should occur within 2.5 seconds of the page first starting to load.                                                                                                                                                                              |
| `view.first_input_delay`        | number(ns)  | First Input Delay, measuring interactivity. To provide a good user experience, the page's FID should be 100 milliseconds or less.                                                                                                                                                                                                                |
| `view.cumulative_layout_shift`  | number(ns)  | Cumulative Layout Shift, measuring visual stability. To provide a good user experience, the page's CLS should be kept at 0.1 or less.                                                                                                                                                                                                            |
| `view.first_contentful_paint`   | number(ns)  | First Contentful Paint (FCP) measures the time from when the page starts loading until any part of the page content is rendered on screen. "Content" refers to text, images (including background images), `<svg>` elements, or non-white `<canvas>` elements.<br/>> Refer to [w3c](https://www.w3.org/TR/paint-timing/#sec-terminology)         |
| `view.first_byte`               | number(ns)  | Time from requesting the page to receiving the first byte of the response.                                                                                                                                                                                                                                                                       |
| `view.time_to_interactive`      | number(ns)  | Time from when the page starts loading until it finishes rendering major sub-resources and can respond quickly and reliably to user input.                                                                                                                                                                                                       |
| `view.dom_interactive`          | number(ns)  | Time when the parser completes document parsing. For more details, refer to [MDN](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceTiming/domInteractive).                                                                                                                                                                            |
| `view.dom_content_loaded`       | number(ns)  | Triggered when the pure HTML is fully loaded and parsed without waiting for stylesheets, images, or subframes to complete loading. For more details, refer to [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Document/DOMContentLoaded_event)                                                                                            |
| `view.dom_complete`             | number(ns)  | When the page and all sub-resources are fully ready. For users, this means the loading animation has stopped spinning. For more details, refer to [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/DOMContentLoaded_event)                                                                                                          |
| `view.load_event`               | number(ns)  | Triggered when the entire page and all dependent resources such as stylesheets and images have completed loading. This differs from `DOMContentLoaded`, which triggers once the page DOM is loaded without waiting for dependent resources. For more details, refer to [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/load_event) |

## Single-Page Applications (SPA)

For single-page applications (SPAs), the RUM browser SDK uses the `loading_type` tag to differentiate between `initial_load` and `route_change`. The RUM SDK generates a `view` event with the `loading_type:route_change` tag. RUM uses the [History API](https://developer.mozilla.org/en-US/docs/Web/API/History) to listen for URL changes.

## Loading Time Calculation {#loading-time}

Based on the powerful API capabilities provided by modern browsers, Loading Time monitors changes in the page's DOM and network requests.

- **Initial Load**: Loading Time takes the longer of the two:
  - `loadEventEnd - navigationStart`
  - The first time the page becomes inactive - `navigationStart`
- **SPA Route Change**: The first time the page becomes inactive - time of URL change

## Page Activity Status {#page-active}

A page is considered _active_ if any of the following conditions are met:

- The page DOM has changes.
- Static resources are being loaded (such as JS, CSS, etc.).
- There are asynchronous requests.

**Note**: If no events occur within 100ms, the page is considered inactive.

**Caution**:

In certain scenarios, the 100ms standard since the last request or DOM change may not accurately determine activity:

- The application collects analytics data by sending requests to an API periodically or after each click.
- The application uses “comet” technology (i.e., streaming or long polling), where requests are held indefinitely.

To improve the accuracy of activity determination in these cases, you can specify `excludedActivityUrls` configuration to exclude these requests:

```js
window.DATAFLUX_RUM.init({
  excludedActivityUrls: [
    // Exact match
    'https://third-party-analytics-provider.com/endpoint',

    // Regular expression
    /\/comet$/,

    // Return true via function to exclude
    (url) => url === 'https://third-party-analytics-provider.com/endpoint'
  ]
})
```
