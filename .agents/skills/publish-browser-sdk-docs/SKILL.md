---
name: publish-browser-sdk-docs
description: Synchronize user-visible Guance browser SDK changes into the sibling dataflux-doc repository and deliver the documentation through a GitLab merge request targeting release. Use after changing browser RUM behavior, public APIs, configuration, framework integrations, package usage, CDN examples, sampling, replay, actions, resources, errors, data fields, or release notes when the corresponding Chinese Web RUM documentation under docs/zh/real-user-monitoring/web must be added or updated for both Guance and TrueWatch.
---

# Publish Browser SDK Docs

Publish each user-visible SDK update through the matching documentation change. Keep the SDK repository and documentation repository as separate Git workflows.

## Resolve the repositories

1. Resolve the current SDK repository with `git rev-parse --show-toplevel`.
2. Resolve the documentation repository as `../../dataflux-doc` relative to the SDK repository by default.
3. Confirm the documentation remote is the intended `zy-docs/dataflux-doc` repository.
4. Stop and ask for the correct path if the repository is missing. Do not silently clone another copy.

Use task-specific variables such as `SDK_REPO`, `DOCS_REPO`, `DOC_BRANCH`, and `DOC_SLUG` in shell commands.

## Assess documentation impact

Inspect the SDK branch diff, public entry points, type declarations, tests, package metadata, and changelog before editing documentation.

- Document every externally observable addition, removal, default change, version requirement, integration change, or usage change.
- Do not infer behavior from a commit title alone. Verify it from source and tests.
- If an SDK change has no user-visible documentation impact, report the inspected evidence and do not create an empty documentation commit or MR.
- Keep generated SDK build outputs out of this workflow.

Read [references/dataflux-doc-conventions.md](references/dataflux-doc-conventions.md) before choosing or writing a document.

## Prepare a clean release-based branch

Treat a dirty documentation worktree as a blocker. Never stash, discard, commit, or overwrite pre-existing documentation changes.

Run the following sequence in the documentation repository:

```bash
git -C "$DOCS_REPO" status --short --branch
git -C "$DOCS_REPO" switch release
git -C "$DOCS_REPO" pull --ff-only origin release
git -C "$DOCS_REPO" switch -c "codex/docs-browser-sdk-$DOC_SLUG"
```

Requirements:

- Start every documentation task from the latest remote `release`.
- Use a fresh, single-purpose branch.
- Use a concise lowercase hyphenated slug.
- Stop if `release` cannot fast-forward or if the new branch name already exists.
- Do not work directly on `release`.

## Author the documentation

Limit documentation changes to:

```text
docs/zh/real-user-monitoring/web/
```

Follow the existing directory design:

1. Read the nearest `.pages` file and adjacent documents.
2. Update the most specific existing page when it already owns the topic.
3. Add a new page only when the topic does not fit an existing page.
4. Register every new page in the nearest `.pages` file and preserve its navigation style.
5. Store any new images below the same Web RUM subtree and remove obsolete images only when the current task makes them unused.

Preserve the current public SDK package names, globals, and emitted CDN filenames. Do not invent migration or compatibility prose unless the SDK change requires it.

## Enforce brand-neutral templates

Apply these rules to prose, headings, links, examples, and code comments:

- Use `<<< custom_key.brand_name >>>` instead of a fixed brand name such as `观测云`.
- Build brand domains with `<<< custom_key.brand_main_domain >>>`.
- Write the browser SDK CDN host as `https://static.<<< custom_key.brand_main_domain >>>/...`; never write `static.guance.com`.
- Map every `@cloudcare/browser-<package>` reference to `@truewatchtech/browser-<package>` for TrueWatch, preserving the package suffix. The published namespace is `@truewatchtech`, not `@truewath` or `@truewatch`.
- Wrap brand-specific package installation commands, imports, prose, and links in a complete `custom_key.brand_key` condition block. Put `@truewatchtech/browser-*` in the `truewatch` branch and `@cloudcare/browser-*` in the `else` branch.
- Use `custom_key.brand_key` condition blocks when globals or other literal values also differ by brand.
- Keep Guance-only and TrueWatch-only literals inside their matching condition branch.
- Verify that both condition branches are complete and usable.

Do not replace stable artifact names such as `dataflux-rum.js` merely because surrounding brand text changes.

## Validate before committing

Run the bundled checker from this Skill directory:

```bash
python3 "$SKILL_DIR/scripts/check_dataflux_doc.py" \
  --repo "$DOCS_REPO" \
  --base origin/release
```

The checker must pass. It verifies the branch base, allowed path, new navigation entries, template balance, code-fence balance, newly added hard-coded brand/domain text, and paired `@cloudcare`/`@truewatchtech` browser package references.

Then:

1. Run `git -C "$DOCS_REPO" diff --check`.
2. Review `git diff --stat`, `git diff`, and `git status --short`.
3. Run Markdown and spelling checks on the changed Markdown files when the repository tools are installed:

```bash
markdownlint -c "$DOCS_REPO/checking/markdownlint.yml" <changed-markdown-files>
cspell lint -c "$DOCS_REPO/checking/cspell.json" --no-progress <changed-markdown-files>
```

4. Build or preview the relevant Chinese documentation when practical.
5. Check rendered template output for both Guance and TrueWatch whenever the change contains brand conditionals.

Do not weaken a check or add a blanket ignore to make the change pass. Report unavailable tooling separately from completed checks.

## Commit and publish the merge request

Stage only the documentation files for this task. Use a documentation-focused commit message, then confirm the staged diff before committing.

Push the branch and create a GitLab merge request targeting `release` with GitLab push options:

```bash
git -C "$DOCS_REPO" push --set-upstream origin "$DOC_BRANCH" \
  -o merge_request.create \
  -o merge_request.target=release \
  -o merge_request.title="$MR_TITLE"
```

After the push:

- Verify the remote branch SHA.
- Capture and report the GitLab MR URL and its source/target branches.
- Do not claim the MR exists if the push output or a remote read-back does not confirm it.
- If the push result is ambiguous, inspect remote state before any retry.
- Do not merge the MR unless the user explicitly asks.

## Handoff

Report:

- SDK behavior that required documentation
- documentation repository and branch
- changed pages and navigation entries
- brand-template decisions
- checker, lint, build, and preview results
- commit SHA, remote branch, and MR URL
