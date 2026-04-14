# Browser Error Collection

Guance RUM automatically collects common browser-side errors, including:

- JavaScript runtime errors
- Unhandled promise rejections
- Console errors
- Resource loading failures

## Automatic Collection Scope

Typical sources include:

- `window.onerror`
- `unhandledrejection`
- console `error`
- failed script, image, or stylesheet loads

## Common Limits

- Cross-origin scripts without proper CORS usually only expose `Script error`.
- Some browsers or page security policies limit how much error detail can be collected.

## Recommendations

- Add `crossorigin="anonymous"` to third-party scripts when possible.
- Return `Access-Control-Allow-Origin` for static assets.
- For handled business exceptions, use [custom error reporting](./custom-sdk/add-error.md) to attach more context.
