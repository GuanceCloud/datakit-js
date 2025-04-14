## FAQ

### Configuring allowedTracingOrigins Results in Cross-Origin Requests for Asynchronous Calls

To achieve full tracking from the frontend to the backend when using APM (Application Performance Monitoring) tools (commonly known as RUM, or Real User Monitoring), you need to configure both the frontend and backend accordingly. Below are the main steps and considerations:

#### Frontend Configuration

1. **Install and Configure RUM SDK**:

   - Install the RUM SDK provided by the APM tool in your web frontend application.
   - Configure the SDK, including setting `allowedTracingOrigins` (domains allowed to send tracing information) and `traceType` (tracing type or framework, such as `ddtrace` for Datadog).

2. **Send Tracing Information**:
   - The RUM SDK will automatically add necessary tracing headers to requests initiated from the frontend, such as `x-datadog-parent-id`, `x-datadog-origin`, `x-datadog-sampling-priority`, `x-datadog-trace-id`, etc.

#### Backend Configuration

1. **Set Up CORS Policy**:

   - Configure a CORS (Cross-Origin Resource Sharing) policy on your backend server to allow requests from the frontend domain and specifically specify `Access-Control-Allow-Headers` to include all necessary tracing headers.
   - For example, if your backend uses Node.js and Express, you can add the CORS middleware and set the `allowedHeaders` property to include these tracing headers.

   ```javascript
   const cors = require('cors')
   app.use(
     cors({
       origin: 'https://your-frontend-domain.com', // Replace with your frontend application domain
       allowedHeaders: [
         'x-datadog-parent-id',
         'x-datadog-origin',
         'x-datadog-sampling-priority',
         'x-datadog-trace-id'
         // Possibly other necessary headers
       ]
     })
   )
   ```

2. **Process Requests**:
   - Ensure that the backend service can receive and correctly handle these tracing headers. This information is typically used to correlate and trace requests within the backend services.

#### Verification and Testing

- **Test Configuration**:

  - Initiate requests from the frontend to the backend and inspect the HTTP headers of network requests to ensure tracing information is sent correctly.
  - Review backend server logs to confirm that tracing information is processed correctly.

- **Debugging and Fixes**:
  - If any issues arise (such as CORS errors, missing headers, etc.), review the configurations of both the frontend and backend and adjust as necessary.

#### Precautions

- **Security**: Ensure `allowedTracingOrigins` only includes trusted sources to prevent potential Cross-Site Request Forgery (CSRF) attacks.
- **Performance**: Although tracing information is crucial for performance monitoring, ensure it does not negatively impact your application's performance.

By following these steps, you can successfully configure the APM tool to support full tracking from the frontend to the backend, thereby more effectively monitoring and optimizing the performance of your web application.

### Script Error Appears

When using <<< custom_key.brand_name >>> Web RUM SDK for web-side error collection, you often see `Script error` in `js_error`. Such error messages do not contain any detailed information.

:face_with_monocle: Possible reasons for this issue:

1. The user's browser does not support error capturing (very rare).
2. The script file is loaded cross-origin into the page.

For cases where the user's browser does not support error capturing, there is nothing we can do; here we focus on solving the issue of cross-origin script errors not being collected.

In general, script files are loaded using `<script>` tags. For same-origin scripts, when using the browser's `GlobalEventHandlers API`, the collected error information includes detailed error information. However, for cross-origin scripts, the collected error information only contains the text `Script error.` This is controlled by the browser's same-origin policy and is normal behavior. For non-same-origin scripts, we need to perform Cross-Origin Resource Sharing (CORS) operations.

:partying_face: Solution:

:material-numeric-1-circle-outline: Script File Hosted Directly on the Server:

Add the following header when serving static files on the server:

```
Access-Control-Allow-Origin: *
```

Add the attribute `crossorigin="anonymous"` to the `<script>` tag for non-same-origin scripts:

```
<script type="text/javascript" src="path/to/your/script.js" crossorigin="anonymous"></script>
```

:material-numeric-2-circle-outline: Script File Hosted on CDN:

Add the following header in the CDN settings:

```
Access-Control-Allow-Origin: *
```

Add the attribute `crossorigin="anonymous"` to the `<script>` tag for non-same-origin scripts:

```
<script type="text/javascript" src="path/to/your/script.js" crossorigin="anonymous"></script>
```

:material-numeric-3-circle-outline: Script File Loaded from Third Party:

Add the attribute `crossorigin="anonymous"` to the `<script>` tag for non-same-origin scripts:

```
<script type="text/javascript" src="path/to/your/script.js" crossorigin="anonymous"></script>
```

### Incomplete Resource Data Collection

The following phenomena may indicate that resource data has not been fully collected:

1. **Resource Size Data is 0**  
   Including fields like `resource_transfer_size`, `resource_decode_size`, `resource_encode_size`, `resource_size`.

2. **Time-Related Data Not Collected**  
   Including fields like `resource_dns`, `resource_tcp`, `resource_ssl`, `resource_ttfb`, `resource_trans`, `resource_first_byte`, `resource_dns_time`, `resource_download_time`, `resource_first_byte_time`, `resource_connect_time`.

#### Possible Reasons

- **Connection Reuse (Keep-Alive)**  
  When resource requests use the `keep-alive` method to maintain connections, DNS queries and TCP connection processes only occur during the first request. Subsequent requests reuse the same connection, so related data may not be recorded or may be 0.

- **Cross-Origin Loading of Resources**  
  If resources are loaded cross-origin without configuring relevant headers, browsers cannot collect complete performance data. This is the primary cause of data loss.

- **Browser Compatibility**  
  In rare cases, some browsers may not support the `Performance API`, preventing the collection of resource-related performance data.

---

#### How to Resolve Data Loss Caused by Cross-Origin Resources

**1. Resource Files Hosted on the Server**  
Add the following HTTP Header to resource files on the server:

```http
Timing-Allow-Origin: *
```

**2. Resource Files Hosted on CDN**  
Add the following HTTP Header to resource files in the CDN configuration:

```http
Timing-Allow-Origin: *
```

[Reference Document](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/transferSize)

### Missing `resource_status` Data

In certain cases, `resource_status` data may be missing, due to the following reasons:

- **Cross-Origin Loading of Resources**  
  If resources are loaded cross-origin without setting cross-origin access permissions, browsers cannot obtain resource status information.

- **Browser Compatibility**  
  Some browsers may not support the `Performance API`, leading to the inability to collect relevant data (very rare).

---

#### How to Resolve Missing `resource_status` Data Caused by Cross-Origin Resources

**1. Resource Files Hosted on the Server**  
Add the following HTTP Header to resource files in the server configuration:

```http
Access-Control-Allow-Origin: *
```

**2. Resource Files Hosted on CDN**  
Add the following HTTP Header to resource files in the CDN configuration:

```http
Access-Control-Allow-Origin: *
```

By implementing the above configurations, you can effectively resolve data collection issues caused by cross-origin resources and ensure that browsers can correctly obtain performance data.
[Reference Document](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/responseStatus).

### Identifying Search Engine Bots {#bot}

When engaging in web activities, it is necessary to distinguish between real user activity and search engines. You can use the following sample script to filter sessions containing bots:

```
// regex patterns to identify known bot instances:
let botPattern = "(googlebot\/|bot|Googlebot-Mobile|Googlebot-Image|Google favicon|Mediapartners-Google|bingbot|slurp|java|wget|curl|Commons-HttpClient|Python-urllib|libwww|httpunit|nutch|phpcrawl|msnbot|jyxobot|FAST-WebCrawler|FAST Enterprise Crawler|biglotron|teoma|convera|seekbot|gigablast|exabot|ngbot|ia_archiver|GingerCrawler|webmon |httrack|webcrawler|grub.org|UsineNouvelleCrawler|antibot|netresearchserver|speedy|fluffy|bibnum.bnf|findlink|msrbot|panscient|yacybot|AISearchBot|IOI|ips-agent|tagoobot|MJ12bot|dotbot|woriobot|yanga|buzzbot|mlbot|yandexbot|purebot|Linguee Bot|Voyager|CyberPatrol|voilabot|baiduspider|citeseerxbot|spbot|twengabot|postrank|turnitinbot|scribdbot|page2rss|sitebot|linkdex|Adidxbot|blekkobot|ezooms|dotbot|Mail.RU_Bot|discobot|heritrix|findthatfile|europarchive.org|NerdByNature.Bot|sistrix crawler|ahrefsbot|Aboundex|domaincrawler|wbsearchbot|summify|ccbot|edisterbot|seznambot|ec2linkfinder|gslfbot|aihitbot|intelium_bot|facebookexternalhit|yeti|RetrevoPageAnalyzer|lb-spider|sogou|lssbot|careerbot|wotbox|wocbot|ichiro|DuckDuckBot|lssrocketcrawler|drupact|webcompanycrawler|acoonbot|openindexspider|gnam gnam spider|web-archive-net.com.bot|backlinkcrawler|coccoc|integromedb|content crawler spider|toplistbot|seokicks-robot|it2media-domain-crawler|ip-web-crawler.com|siteexplorer.info|elisabot|proximic|changedetection|blexbot|arabot|WeSEE:Search|niki-bot|CrystalSemanticsBot|rogerbot|360Spider|psbot|InterfaxScanBot|Lipperhey SEO Service|CC Metadata Scaper|g00g1e.net|GrapeshotCrawler|urlappendbot|brainobot|fr-crawler|binlar|SimpleCrawler|Livelapbot|Twitterbot|cXensebot|smtbot|bnf.fr_bot|A6-Indexer|ADmantX|Facebot|Twitterbot|OrangeBot|memorybot|AdvBot|MegaIndex|SemanticScholarBot|ltx71|nerdybot|xovibot|BUbiNG|Qwantify|archive.org_bot|Applebot|TweetmemeBot|crawler4j|findxbot|SemrushBot|yoozBot|lipperhey|y!j-asr|Domain Re-Animator Bot|AddThis)";

let regex = new RegExp(botPattern, 'i');

// Define var allowedTracingOrigins if the userAgent matches a pattern in botPatterns
// Otherwise, define allowedTracingOrigins to be normal
let allowedTracingOrigins = regex.test(navigator.userAgent)

// Initialize the RUM Browser SDK and set allowedTracingOrigins
DATAFLUX_RUM.init({
 // ... config options
 allowedTracingOrigins: allowedTracingOrigins ? [] : ["https://***.com"],
});
```

### Further Reading

<div class="grid cards" markdown>

- [<font color="coral"> :octicons-arrow-right-24: &nbsp; GlobalEventHandlers.onerror</font>](https://developer.mozilla.org/en-US/docs/Web/API/GlobalEventHandlers/onerror)

</div>

<div class="grid cards" markdown>

- [<font color="coral"> :octicons-arrow-right-24: &nbsp; Cross-Origin Resource Sharing (CORS)</font>](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)

</div>

<div class="grid cards" markdown>

- [<font color="coral"> :octicons-arrow-right-24: &nbsp; The Script element</font>](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script)

</div>

<div class="grid cards" markdown>

- [<font color="coral"> :octicons-arrow-right-24: &nbsp; CORS settings attributes</font>](https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_settings_attributes)

</div>

<div class="grid cards" markdown>

- [<font color="coral"> :octicons-arrow-right-24: &nbsp; Coping_with_CORS</font>](https://developer.mozilla.org/en-US/docs/Web/API/Resource_Timing_API/Using_the_Resource_Timing_API#Coping_with_CORS)

</div>

<div class="grid cards" markdown>

- [<font color="coral"> :octicons-arrow-right-24: &nbsp; Resource Timing Standard; W3C Editor's Draft</font>](https://w3c.github.io/resource-timing/)

</div>

<div class="grid cards" markdown>

- [<font color="coral"> :octicons-arrow-right-24: &nbsp; Resource Timing practical tips; Steve Souders</font>](http://www.stevesouders.com/blog/2014/08/21/resource-timing-practical-tips/)

</div>

<div class="grid cards" markdown>

- [<font color="coral"> :octicons-arrow-right-24: &nbsp; Measuring network performance with Resource Timing API</font>](http://googledevelopers.blogspot.ca/2013/12/measuring-network-performance-with.html)

</div>
