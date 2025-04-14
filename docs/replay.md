# How to Connect SESSION REPLAY

---

## Enable SESSION REPLAY

Through your previous SDK introduction method, replace the NPM package with version `> 3.0.0`, or replace the original CDN link with `https://static.guance.com/browser-sdk/v3/dataflux-rum.js`. After SDK initialization with `init()`, it will not automatically collect SESSION REPLAY RECORD data; you need to execute `startSessionReplayRecording` to enable data collection. This is useful for some cases where only specific situations of SESSION REPLAY RECORD data need to be collected, such as:

```js
// Collect user operation data only after login
if (user.isLogin()) {
  DATAFLUX_RUM.startSessionReplayRecording()
}
```

If you need to stop SESSION REPLAY data collection, you can call `stopSessionReplayRecording()` to turn it off.

### NPM {#npm}

Introduce the @cloudcare/browser-rum package and ensure that [@cloudcare/browser-rum](https://www.npmjs.com/package/@cloudcare/browser-rum) version is `> 3.0.0`. If you want to start recording, after initialization, please execute `datafluxRum.startSessionReplayRecording()`.

```js
import { datafluxRum } from '@cloudcare/browser-rum'

datafluxRum.init({
  applicationId: '<DATAFLUX_APPLICATION_ID>',
  datakitOrigin: '<DATAKIT ORIGIN>',
  service: 'browser',
  env: 'production',
  version: '1.0.0',
  sessionSampleRate: 100,
  sessionReplaySampleRate: 70,
  trackInteractions: true
})

datafluxRum.startSessionReplayRecording()
```

### CDN {#cdn}

Replace the original CDN address `https://static.guance.com/browser-sdk/v2/dataflux-rum.js` with `https://static.guance.com/browser-sdk/v3/dataflux-rum.js`, and after executing `DATAFLUX_RUM.init()`, execute `DATAFLUX_RUM.startSessionReplayRecording()`.

```js
<script
src="https://static.guance.com/browser-sdk/v3/dataflux-rum.js"
type="text/javascript"
></script>
<script>
window.DATAFLUX_RUM &&
window.DATAFLUX_RUM.init({
    applicationId: '<DATAFLUX_APPLICATION_ID>',
    datakitOrigin: '<DATAKIT ORIGIN>',
    service: 'browser',
    env: 'production',
    version: '1.0.0',
    sessionSampleRate: 100,
    sessionReplaySampleRate: 100,
    trackInteractions: true,
})

window.DATAFLUX_RUM && window.DATAFLUX_RUM.startSessionReplayRecording()
</script>
```

## Precautions

### Some HTML Elements Are Invisible During Playback

SESSION REPLAY does not support the following HTML elements: iframe, video, audio, or canvas. SESSION REPLAY does not support Web Components and Shadow DOM.

### FONT or IMG Cannot Be Displayed Correctly

SESSION REPLAY is not a video but a reconstruction based on DOM snapshots in an iframe. Therefore, playback depends on various static resources of the page: fonts and images.

For the following reasons, static resources may not be available during playback:

- The static resource no longer exists. For example, it was part of a previous deployment.
- The static resource is inaccessible. For example, authentication may be required, or the resource may only be accessible from an internal network.
- Static resources are blocked by browsers due to CORS (usually web fonts).

  - Since playback occurs within the sandbox environment corresponding to `guance.com` if certain static resources have not been authorized for a specific domain, your browser will block the request;
  - Allow access to any font or image static resources your site depends on by using the Access-Control-Allow-Origin header to ensure these resources can be accessed during playback.

  > For more information, refer to [Cross-Origin Resource Sharing](https://developer.mozilla.org/en-US/docs/Web).

### CSS Style Not Applied Correctly or Mouse Hover Events Not Replayed

Unlike fonts and images, SESSION REPLAY RECORD attempts to use the [CSSStyleSheet](https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet) interface to bundle various CSS rules as part of the recorded data. If this cannot be executed, it will fall back to recording the links to CSS files.

To achieve correct mouse hover support, CSS rules must be accessible via the CSSStyleSheet interface.

If style sheets are hosted on a different domain than the webpage, access to CSS rules will be subject to cross-origin security checks by the browser, and the browser must load style sheets using the [crossorigin](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/crossorigin) attribute to utilize CORS.

For example, if your application is located on the example.com domain and depends on CSS files on assets.example.com through a link element, the `crossorigin` attribute should be set to `anonymous`.

```js
<link rel="stylesheet" crossorigin="anonymous"
      href="https://assets.example.com/style.css”>
```

Additionally, authorize the example.com domain in assets.example.com. This allows resource files to correctly load resources by setting the [Access-Control-Allow-Origin](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Origin) header.

## Further Reading

<div class="grid cards" markdown>

- [<font color="coral"> :fontawesome-solid-arrow-right-long: &nbsp; How Does SESSION REPLAY Ensure Your Data Security?</font>](./rum/index.md#session-replay)

</div>
