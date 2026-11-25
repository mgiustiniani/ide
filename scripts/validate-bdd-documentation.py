#!/usr/bin/env python3
"""Validate bdd-ts Gherkin status, legacy PLAN.md absence, ARC42 traceability, and C4 stability."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import re
import sys

STATUS_TAGS = {
    "@implemented-and-validated",
    "@implemented-not-e2e-validated",
    "@partial",
    "@config-only",
    "@placeholder",
    "@absent",
    "@not-implemented",
}
CLASSIFICATION_TAGS = {"@functional-requirement", "@non-functional-requirement"}
REQ_RE = re.compile(r"^@REQ-[A-Za-z0-9][A-Za-z0-9._-]*$")
TAG_RE = re.compile(r"@[A-Za-z0-9][A-Za-z0-9._-]*")
FEATURE_RE = re.compile(r"^(?:Feature|Business Need|Ability)\s*:", re.IGNORECASE)
SCENARIO_RE = re.compile(r"^Scenario(?: Outline)?\s*:\s*(.*)$", re.IGNORECASE)
EXCLUDED_PARTS = {".git", "node_modules", "target", "dist", "build", "coverage", "test-results", ".turbo", ".vite"}


@dataclass(frozen=True)
class Scenario:
    path: Path
    line: int
    name: str
    tags: frozenset[str]


def discover_features(root: Path, explicit_roots: list[Path] | None = None) -> list[Path]:
    roots: list[Path] = []
    if explicit_roots:
        roots = [path if path.is_absolute() else root / path for path in explicit_roots]
    else:
        top = root / "features"
        if top.is_dir():
            roots.append(top)
        for candidate in root.rglob("features"):
            if candidate == top or not candidate.is_dir():
                continue
            relative_parts = candidate.relative_to(root).parts
            if any(part in EXCLUDED_PARTS for part in relative_parts):
                continue
            if candidate.parent.name == "resources" or candidate.parent.name in {"test", "tests"}:
                roots.append(candidate)

    found: set[Path] = set()
    for feature_root in roots:
        if not feature_root.is_dir():
            continue
        for path in feature_root.rglob("*.feature"):
            relative_parts = path.relative_to(root).parts if path.is_relative_to(root) else path.parts
            if not any(part in EXCLUDED_PARTS for part in relative_parts):
                found.add(path.resolve())
    return sorted(found)


def parse_feature(path: Path) -> list[Scenario]:
    feature_tags: set[str] = set()
    pending_tags: set[str] = set()
    scenarios: list[Scenario] = []
    docstring: str | None = None

    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        stripped = raw.strip()
        if docstring:
            if stripped.startswith(docstring):
                docstring = None
            continue
        if stripped.startswith(('"""', "```")):
            docstring = stripped[:3]
            continue
        stripped = stripped.split("#", 1)[0].strip()
        if not stripped:
            continue
        if stripped.startswith("@"):
            pending_tags.update(TAG_RE.findall(stripped))
            continue
        if FEATURE_RE.match(stripped):
            # Narrative headings may use Feature/Business Need/Ability aliases.
            # Preserve the one file-level declaration across that preamble.
            feature_tags.update(pending_tags)
            pending_tags.clear()
            continue
        scenario_match = SCENARIO_RE.match(stripped)
        if scenario_match:
            scenarios.append(Scenario(
                path=path,
                line=line_number,
                name=scenario_match.group(1).strip(),
                tags=frozenset(feature_tags | pending_tags),
            ))
            pending_tags.clear()
            continue
        pending_tags.clear()
    return scenarios


def structurizr_descriptions(text: str) -> list[tuple[int, str]]:
    descriptions: list[tuple[int, str]] = []
    for line_number, raw in enumerate(text.splitlines(), 1):
        line = raw.split("//", 1)[0].strip()
        if not line or line.startswith("#"):
            continue
        quoted = re.findall(r'"((?:\\.|[^"\\])*)"', line)
        if not quoted:
            continue
        if re.search(r"\bdescription\s+\"", line, re.IGNORECASE):
            descriptions.append((line_number, quoted[-1]))
        elif "->" in line:
            descriptions.append((line_number, quoted[0]))
        elif re.search(r"\b(person|softwareSystem|container|component|deploymentNode)\b", line, re.IGNORECASE) and len(quoted) >= 2:
            descriptions.append((line_number, quoted[1]))
    return descriptions


def mutable_c4_reason(description: str) -> str | None:
    checks = (
        ("coverage percentage", r"(?:coverage.{0,30}\d+(?:\.\d+)?%|\d+(?:\.\d+)?%.{0,30}coverage)"),
        ("requirement count", r"(?:requirements?\s*(?::|=)?\s*\d+|\d+\s+requirements?)"),
        ("implementation status", r"(?:implemented-and-validated|implemented-not-e2e-validated|not[- ]implemented|config-only|placeholder|\bpartial\b)"),
        ("evidence date", r"(?:evidence|validated|verified|as\s+of).{0,40}\d{4}-\d{2}-\d{2}"),
    )
    for reason, pattern in checks:
        if re.search(pattern, description, re.IGNORECASE):
            return reason
    return None


def validate(
    root: Path,
    *,
    feature_roots: list[Path] | None = None,
    appendix: Path | None = None,
) -> list[str]:
    failures: list[str] = []

    plan = root / "PLAN.md"
    if plan.exists():
        failures.append("legacy PLAN.md remains; classify its content and remove it before bdd-ts admission")

    feature_paths = discover_features(root, feature_roots)
    scenarios: list[Scenario] = []
    requirement_ids: dict[str, Scenario] = {}

    for feature_path in feature_paths:
        for scenario in parse_feature(feature_path):
            if "@protocol-smoke" in scenario.tags:
                continue
            scenarios.append(scenario)
            location = f"{scenario.path.relative_to(root).as_posix()}:{scenario.line}"
            req_tags = sorted(tag for tag in scenario.tags if REQ_RE.fullmatch(tag))
            classes = sorted(scenario.tags & CLASSIFICATION_TAGS)
            statuses = sorted(scenario.tags & STATUS_TAGS)
            if len(req_tags) != 1:
                failures.append(f"{location} {scenario.name!r}: expected exactly one @REQ-* tag, found {req_tags}")
            else:
                req_id = req_tags[0]
                if req_id in requirement_ids and requirement_ids[req_id].path != scenario.path:
                    first = requirement_ids[req_id]
                    failures.append(
                        f"{location} {scenario.name!r}: duplicate {req_id}; first used at "
                        f"{first.path.relative_to(root).as_posix()}:{first.line}"
                    )
                elif req_id not in requirement_ids:
                    requirement_ids[req_id] = scenario
            if not classes:
                failures.append(f"{location} {scenario.name!r}: missing functional/non-functional classification")
            if len(statuses) != 1:
                failures.append(f"{location} {scenario.name!r}: expected one effective status, found {statuses}")

    arc42 = root / "docs/arc42"
    appendix_path = appendix or arc42 / "appendix-requirements.adoc"
    if not appendix_path.is_absolute():
        appendix_path = root / appendix_path

    if arc42.is_dir() and feature_paths:
        if not appendix_path.is_file():
            failures.append(f"missing ARC42 requirements appendix: {appendix_path.relative_to(root)}")
        else:
            appendix_text = appendix_path.read_text(encoding="utf-8")
            for path in feature_paths:
                relative = path.relative_to(root).as_posix()
                if relative not in appendix_text:
                    failures.append(f"ARC42 requirements appendix omits feature path: {relative}")
            for req_id in sorted(requirement_ids):
                bare = req_id[1:]
                if not re.search(rf"(?<![A-Za-z0-9._-]){re.escape(bare)}(?![A-Za-z0-9._-])", appendix_text):
                    failures.append(f"ARC42 requirements appendix omits requirement ID: {req_id}")

    c4 = root / "docs/c4/workspace.dsl"
    if c4.is_file():
        for line_number, description in structurizr_descriptions(c4.read_text(encoding="utf-8")):
            reason = mutable_c4_reason(description)
            if reason:
                failures.append(f"docs/c4/workspace.dsl:{line_number}: mutable {reason} in description: {description!r}")

    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--feature-root", type=Path, action="append", default=[])
    parser.add_argument("--appendix", type=Path)
    args = parser.parse_args()

    root = args.root.resolve()
    failures = validate(
        root,
        feature_roots=args.feature_root or None,
        appendix=args.appendix,
    )
    if failures:
        print("validate-bdd-documentation: FAIL")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print("validate-bdd-documentation: PASS")
    print(f"project_root: {root}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
