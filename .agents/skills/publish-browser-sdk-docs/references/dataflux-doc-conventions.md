# Dataflux Web RUM documentation conventions

## Sources of truth

Re-read these files from the current `release` branch for every task because the repository can evolve:

- `README.md`: authoring rules and collaboration workflow
- `docs/zh/real-user-monitoring/web/.pages`: Web RUM navigation
- `docs/zh/real-user-monitoring/web/custom-sdk/.pages`: custom SDK navigation
- `docs/zh/real-user-monitoring/session-replay/web/.pages`: Web Session Replay navigation
- `mkdocs.zh.yml`: Guance template keys
- neighboring documents: current structure, terminology, code style, admonitions, and tabs

Do not copy rules from an old branch when current `release` differs.

## Topic mapping

| SDK change | Primary document |
| --- | --- |
| Installation, initialization, CDN, config, public method overview | `app-access.md` |
| Versioned release behavior | `sdk-changelog.md` |
| Next.js, Nuxt, SSR, hydration | `ssr-access.md` |
| Electron integration | `electron-access.md` |
| Event fields and collected data | `app-data-collection.md` |
| Sampling | `sampling.md` |
| Session Replay configuration and capability boundaries | `../session-replay/web/replay.md` |
| Canvas 2D and WebGL Session Replay | `../session-replay/web/canvas-replay.md` |
| Resource hooks | `hook-resource.md` |
| Action tracking | `tracking-user-actions.md` |
| Custom View | `custom-view.md` |
| Custom user, context, Action, or Error APIs | `custom-sdk/` |
| Troubleshooting and edge cases | `faq.md` |

Prefer the narrowest existing owner. If a new topic deserves its own page, place it beside related pages and update the nearest `.pages`.

## Template syntax

Use the repository's triple-angle template syntax exactly.

Brand name:

```markdown
<<< custom_key.brand_name >>> RUM SDK
```

Brand-aware domain:

```markdown
https://static.<<< custom_key.brand_main_domain >>>/browser-sdk/v3/dataflux-rum.js
```

Brand-specific values:

````markdown
<<<% if custom_key.brand_key == "truewatch" %>>>
```bash
npm install @truewatchtech/browser-rum
```
<<<% else %>>>
```bash
npm install @cloudcare/browser-rum
```
<<<% endif %>>>
````

Keep the opening `if`, optional `else`, and closing `endif` balanced. Put complete runnable examples in both branches when code differs.

## Browser package namespace mapping

Use the same `browser-*` package suffix for both brands:

| Guance | TrueWatch |
| --- | --- |
| `@cloudcare/browser-rum` | `@truewatchtech/browser-rum` |
| `@cloudcare/browser-logs` | `@truewatchtech/browser-logs` |
| `@cloudcare/browser-core` | `@truewatchtech/browser-core` |
| `@cloudcare/browser-worker` | `@truewatchtech/browser-worker` |
| `@cloudcare/browser-<package>` | `@truewatchtech/browser-<package>` |

Use `@truewatchtech` exactly. Do not write `@truewath` or `@truewatch`.

Whenever an installation command, import, inline package name, or NPM link contains either namespace, wrap the complete example or paragraph in one paired block:

````markdown
<<<% if custom_key.brand_key == "truewatch" %>>>
```javascript
import { datafluxRum } from '@truewatchtech/browser-rum'
```
<<<% else %>>>
```javascript
import { datafluxRum } from '@cloudcare/browser-rum'
```
<<<% endif %>>>
````

Keep matching package suffixes inside the same condition block. Do not leave a shared `@cloudcare/browser-*` example outside the template, because it renders incorrectly for TrueWatch.

## Brand neutrality

- Do not add fixed `观测云` prose.
- Do not add hard-coded `*.guance.com` or `*.guance.one` hosts.
- Do not assume that replacing the brand display name also replaces package names, globals, or stable filenames.
- Put literal package namespaces such as `@cloudcare` and `@truewatchtech` in their paired brand branches.
- Use a template variable for shared domains and a conditional only when the brands truly need different values.
- Keep stable published filenames such as `dataflux-rum.js` and `dataflux-logs.js` unless the SDK release changes the actual artifact contract.

## Writing and structure

- Use one H1 for the page title and increase heading levels one level at a time.
- Use `「」` for product UI labels and Chinese quotation marks for other quoted text.
- Give fenced code blocks a language.
- Follow adjacent documents for MkDocs tabs, admonitions, anchors, link attributes, and table formatting.
- Keep relative links valid from the edited file.
- Avoid a Markdown file and a same-named directory at the same level because it interferes with search.
- Keep images below 1 MB when practical, except GIFs, and follow neighboring image markup.
- State prerequisites, minimum SDK/DataKit versions, defaults, and behavior from verified source rather than assumptions.
- Use public, task-oriented language. Do not expose internal implementation variables or source-only concepts unless users must configure them.

## Review checklist

- The page is the correct owner for the SDK change.
- New pages appear in `.pages`.
- Examples match the current runtime API and published type declarations.
- Both brands render meaningful prose and runnable code.
- Every `@cloudcare/browser-*` reference has a same-suffix `@truewatchtech/browser-*` counterpart in the same template block.
- No fixed brand name or Guance domain was added.
- CDN URLs retain the `static.` subdomain and the actual published filename.
- Version claims are supported by package metadata or release evidence.
- Changed links, headings, tables, templates, and code fences are valid.
