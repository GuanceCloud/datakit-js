#!/usr/bin/env python3
"""Validate a release-based Web RUM documentation change."""

import argparse
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Set, Tuple


TARGET_ROOT = Path("docs/zh/real-user-monitoring/web")
ALLOWED_SUFFIXES = {
    ".md",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
}
HARDCODED_PATTERNS = (
    ("fixed brand name", re.compile(r"观测云")),
    (
        "hard-coded Guance domain",
        re.compile(r"(?i)\b(?:[a-z0-9-]+\.)*guance\.(?:com|one)\b"),
    ),
)
HUNK_RE = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")
TEMPLATE_TAG_RE = re.compile(r"<<<%\s*(if|elif|else|endif)\b(.*?)%>>>")
BRAND_NAME_TEMPLATE_RE = re.compile(r"<<<\s*custom_key\.brand_name\s*>>>")
BRAND_DOMAIN_TEMPLATE_RE = re.compile(r"<<<\s*custom_key\.brand_main_domain\s*>>>")
SDK_DOMAIN_WITHOUT_STATIC_RE = re.compile(
    r"https://<<<\s*custom_key\.brand_main_domain\s*>>>/browser-sdk/"
)
CLOUDCARE_PACKAGE_RE = re.compile(r"@cloudcare/(browser-[a-z0-9-]+)")
TRUEWATCH_PACKAGE_RE = re.compile(r"@truewatchtech/(browser-[a-z0-9-]+)")
MISSPELLED_TRUEWATCH_PACKAGE_RE = re.compile(
    r"@(?:truewath|truewatch)/(browser-[a-z0-9-]+)"
)
TRUEWATCH_CONDITION_RE = re.compile(
    r"""custom_key\.brand_key\s*==\s*(['"])truewatch\1"""
)


class CheckFailure(Exception):
    """A validation failure that should be shown without a traceback."""


def run_git(repo: Path, args: Sequence[str], check: bool = True) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if check and result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise CheckFailure("git {} failed: {}".format(" ".join(args), detail))
    return result.stdout


def resolve_repo(value: str) -> Path:
    repo = Path(value).expanduser().resolve()
    if not repo.is_dir():
        raise CheckFailure("documentation repository does not exist: {}".format(repo))
    root = Path(run_git(repo, ["rev-parse", "--show-toplevel"]).strip()).resolve()
    if root != repo:
        raise CheckFailure("--repo must point to the documentation repository root: {}".format(root))
    return root


def ensure_branch(repo: Path, base: str) -> str:
    branch = run_git(repo, ["branch", "--show-current"]).strip()
    if not branch:
        raise CheckFailure("documentation repository is in detached HEAD state")
    if branch == "release":
        raise CheckFailure("do not author documentation directly on release; create a fresh branch")

    run_git(repo, ["rev-parse", "--verify", "{}^{{commit}}".format(base)])
    ancestor = subprocess.run(
        ["git", "-C", str(repo), "merge-base", "--is-ancestor", base, "HEAD"],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    if ancestor.returncode != 0:
        raise CheckFailure(
            "{} is not an ancestor of HEAD; refresh from release before publishing".format(base)
        )
    return branch


def ensure_origin(repo: Path) -> None:
    origin = run_git(repo, ["remote", "get-url", "origin"]).strip()
    if "zy-docs/dataflux-doc" not in origin:
        raise CheckFailure("unexpected origin remote for dataflux-doc: {}".format(origin))


def changed_paths(repo: Path, base: str) -> Tuple[List[Path], Set[Path], Set[Path], Set[Path]]:
    diff_names = run_git(
        repo,
        ["diff", "--name-only", "--diff-filter=ACDMRTUXB", base, "--"],
    ).splitlines()
    untracked_names = run_git(
        repo,
        ["ls-files", "--others", "--exclude-standard"],
    ).splitlines()

    paths = sorted({Path(name) for name in diff_names + untracked_names if name})
    if not paths:
        raise CheckFailure("no documentation changes found relative to {}".format(base))

    added_output = run_git(
        repo,
        ["diff", "--name-only", "--diff-filter=A", base, "--"],
    ).splitlines()
    deleted_output = run_git(
        repo,
        ["diff", "--name-only", "--diff-filter=D", base, "--"],
    ).splitlines()
    committed_added = {Path(name) for name in added_output}
    untracked = {Path(name) for name in untracked_names if name}
    added = committed_added | untracked
    deleted = {Path(name) for name in deleted_output}
    return paths, added, deleted, untracked


def ensure_allowed_paths(paths: Iterable[Path]) -> None:
    errors = []
    root_prefix = TARGET_ROOT.as_posix() + "/"
    for path in paths:
        path_text = path.as_posix()
        if not path_text.startswith(root_prefix):
            errors.append("{} is outside {}".format(path, TARGET_ROOT))
            continue
        if path.name != ".pages" and path.suffix.lower() not in ALLOWED_SUFFIXES:
            errors.append("{} has an unsupported documentation file type".format(path))
    if errors:
        raise CheckFailure("\n".join(errors))


def parse_added_lines(diff_text: str) -> List[Tuple[int, str]]:
    lines: List[Tuple[int, str]] = []
    new_line = 0
    in_hunk = False
    for raw_line in diff_text.splitlines():
        match = HUNK_RE.match(raw_line)
        if match:
            new_line = int(match.group(1))
            in_hunk = True
            continue
        if not in_hunk:
            continue
        if raw_line.startswith("+") and not raw_line.startswith("+++"):
            lines.append((new_line, raw_line[1:]))
            new_line += 1
        elif raw_line.startswith("-") and not raw_line.startswith("---"):
            continue
        elif raw_line.startswith("\\"):
            continue
        else:
            new_line += 1
    return lines


def added_lines_by_file(
    repo: Path, base: str, paths: Sequence[Path], untracked: Set[Path]
) -> Dict[Path, List[Tuple[int, str]]]:
    result: Dict[Path, List[Tuple[int, str]]] = {}
    for path in paths:
        absolute = repo / path
        if path in untracked and absolute.is_file():
            result[path] = list(enumerate(absolute.read_text(encoding="utf-8").splitlines(), 1))
            continue
        diff_text = run_git(
            repo,
            ["diff", "--no-ext-diff", "--unified=0", "--no-color", base, "--", str(path)],
        )
        result[path] = parse_added_lines(diff_text)
    return result


def check_hardcoded_values(added_lines: Dict[Path, List[Tuple[int, str]]]) -> List[str]:
    errors = []
    for path, lines in added_lines.items():
        if path.suffix.lower() not in {".md", ".pages"}:
            continue
        for line_number, line in lines:
            for label, pattern in HARDCODED_PATTERNS:
                if pattern.search(line):
                    errors.append("{}:{}: {}: {}".format(path, line_number, label, line.strip()))
            if "custom_key.brand_name" in line and not BRAND_NAME_TEMPLATE_RE.search(line):
                errors.append(
                    "{}:{}: brand_name is not wrapped in a template: {}".format(
                        path, line_number, line.strip()
                    )
                )
            if "custom_key.brand_main_domain" in line and not BRAND_DOMAIN_TEMPLATE_RE.search(line):
                errors.append(
                    "{}:{}: brand_main_domain is not wrapped in a template: {}".format(
                        path, line_number, line.strip()
                    )
                )
            if SDK_DOMAIN_WITHOUT_STATIC_RE.search(line):
                errors.append(
                    "{}:{}: browser SDK CDN URL is missing the static subdomain: {}".format(
                        path, line_number, line.strip()
                    )
                )
    return errors


def check_brand_package_templates(
    repo: Path,
    paths: Sequence[Path],
    added_lines: Dict[Path, List[Tuple[int, str]]],
) -> List[str]:
    errors = []
    for path in paths:
        absolute = repo / path
        if path.suffix.lower() != ".md" or not absolute.is_file():
            continue

        added_line_numbers = {
            line_number for line_number, _line in added_lines.get(path, [])
        }
        if not added_line_numbers:
            continue

        stack = []
        blocks = {}
        added_occurrences = []
        next_block_id = 1

        for line_number, line in enumerate(
            absolute.read_text(encoding="utf-8").splitlines(), 1
        ):
            for match in TEMPLATE_TAG_RE.finditer(line):
                tag = match.group(1)
                expression = match.group(2)
                if tag == "if":
                    if TRUEWATCH_CONDITION_RE.search(expression):
                        block_id = next_block_id
                        next_block_id += 1
                        blocks[block_id] = {
                            "truewatch": set(),
                            "cloudcare": set(),
                        }
                        stack.append(
                            {
                                "brand_id": block_id,
                                "branch": "truewatch",
                            }
                        )
                    else:
                        stack.append({"brand_id": None, "branch": None})
                elif tag == "elif":
                    if stack and stack[-1]["brand_id"] is not None:
                        stack[-1]["branch"] = None
                elif tag == "else":
                    if stack and stack[-1]["brand_id"] is not None:
                        stack[-1]["branch"] = "cloudcare"
                elif tag == "endif" and stack:
                    stack.pop()

            brand_context = next(
                (frame for frame in reversed(stack) if frame["brand_id"] is not None),
                None,
            )
            block_id = brand_context["brand_id"] if brand_context else None
            branch = brand_context["branch"] if brand_context else None

            if line_number in added_line_numbers:
                for match in MISSPELLED_TRUEWATCH_PACKAGE_RE.finditer(line):
                    errors.append(
                        "{}:{}: use @truewatchtech/{} instead of {}".format(
                            path,
                            line_number,
                            match.group(1),
                            match.group(0),
                        )
                    )

            for namespace, pattern in (
                ("cloudcare", CLOUDCARE_PACKAGE_RE),
                ("truewatch", TRUEWATCH_PACKAGE_RE),
            ):
                for match in pattern.finditer(line):
                    package_suffix = match.group(1)
                    if block_id is not None and branch == namespace:
                        blocks[block_id][namespace].add(package_suffix)
                    if line_number in added_line_numbers:
                        added_occurrences.append(
                            (
                                line_number,
                                namespace,
                                package_suffix,
                                block_id,
                                branch,
                            )
                        )

        for line_number, namespace, package_suffix, block_id, branch in added_occurrences:
            expected_branch = namespace
            if block_id is None or branch != expected_branch:
                errors.append(
                    "{}:{}: @{} browser package must be inside the {} branch of "
                    "an if custom_key.brand_key == \"truewatch\" template".format(
                        path,
                        line_number,
                        "cloudcare" if namespace == "cloudcare" else "truewatchtech",
                        "else" if namespace == "cloudcare" else "truewatch",
                    )
                )
                continue

            counterpart_namespace = (
                "truewatch" if namespace == "cloudcare" else "cloudcare"
            )
            if package_suffix not in blocks[block_id][counterpart_namespace]:
                counterpart_prefix = (
                    "@truewatchtech/"
                    if namespace == "cloudcare"
                    else "@cloudcare/"
                )
                errors.append(
                    "{}:{}: missing {}{} counterpart in the same brand template block".format(
                        path,
                        line_number,
                        counterpart_prefix,
                        package_suffix,
                    )
                )
    return errors


def check_markdown_structure(repo: Path, paths: Sequence[Path]) -> List[str]:
    errors = []
    for path in paths:
        absolute = repo / path
        if path.suffix.lower() != ".md" or not absolute.is_file():
            continue
        text = absolute.read_text(encoding="utf-8")
        if text.count("<<<") != text.count(">>>"):
            errors.append("{}: unbalanced triple-angle template delimiters".format(path))
        if sum(1 for line in text.splitlines() if line.lstrip().startswith("```")) % 2:
            errors.append("{}: unbalanced fenced code blocks".format(path))
        if not any(line.startswith("# ") for line in text.splitlines()):
            errors.append("{}: missing H1 page title".format(path))

        stack: List[int] = []
        for line_number, line in enumerate(text.splitlines(), 1):
            for match in TEMPLATE_TAG_RE.finditer(line):
                tag = match.group(1)
                if tag == "if":
                    stack.append(line_number)
                elif tag in {"elif", "else"}:
                    if not stack:
                        errors.append(
                            "{}:{}: template {} has no matching if".format(path, line_number, tag)
                        )
                elif tag == "endif":
                    if not stack:
                        errors.append(
                            "{}:{}: template endif has no matching if".format(path, line_number)
                        )
                    else:
                        stack.pop()
        for line_number in stack:
            errors.append("{}:{}: template if has no matching endif".format(path, line_number))
    return errors


def closest_pages_file(repo: Path, document: Path) -> Path:
    current = document.parent
    target = repo / TARGET_ROOT
    while True:
        candidate = repo / current / ".pages"
        if candidate.is_file():
            return candidate
        if (repo / current).resolve() == target.resolve():
            break
        if current == current.parent:
            break
        current = current.parent
    raise CheckFailure("{} has no .pages navigation file in the Web RUM tree".format(document))


def check_navigation(repo: Path, added: Set[Path], deleted: Set[Path]) -> List[str]:
    errors = []
    for path in sorted(added):
        absolute = repo / path
        if path.suffix.lower() != ".md" or not absolute.is_file():
            continue
        pages_file = closest_pages_file(repo, path)
        pages_text = pages_file.read_text(encoding="utf-8")
        relative = path.relative_to(pages_file.parent.relative_to(repo)).as_posix()
        if relative not in pages_text and path.name not in pages_text:
            errors.append(
                "{}: new page is not registered in {}".format(
                    path, pages_file.relative_to(repo)
                )
            )
    for path in sorted(deleted):
        if path.suffix.lower() != ".md":
            continue
        pages_file = closest_pages_file(repo, path)
        pages_text = pages_file.read_text(encoding="utf-8")
        relative = path.relative_to(pages_file.parent.relative_to(repo)).as_posix()
        if relative in pages_text or path.name in pages_text:
            errors.append(
                "{}: deleted page is still registered in {}".format(
                    path, pages_file.relative_to(repo)
                )
            )
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check a dataflux-doc Web RUM change before an MR to release."
    )
    parser.add_argument(
        "--repo",
        default="../dataflux-doc",
        help="path to the dataflux-doc repository root",
    )
    parser.add_argument(
        "--base",
        default="origin/release",
        help="release base ref used for branch and diff checks",
    )
    args = parser.parse_args()

    try:
        repo = resolve_repo(args.repo)
        ensure_origin(repo)
        branch = ensure_branch(repo, args.base)
        paths, added, deleted, untracked = changed_paths(repo, args.base)
        ensure_allowed_paths(paths)
        added_lines = added_lines_by_file(repo, args.base, paths, untracked)

        errors = []
        errors.extend(check_hardcoded_values(added_lines))
        errors.extend(check_brand_package_templates(repo, paths, added_lines))
        errors.extend(check_markdown_structure(repo, paths))
        errors.extend(check_navigation(repo, added, deleted))
        if errors:
            raise CheckFailure("\n".join(errors))
    except (CheckFailure, OSError, UnicodeError) as error:
        print("FAIL: {}".format(error), file=sys.stderr)
        return 1

    print("PASS: {} file(s) on {} are ready for review against {}".format(
        len(paths), branch, args.base
    ))
    for path in paths:
        print("  - {}".format(path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
