"""MkDocs hook: keep the repository's Markdown files readable on GitHub *and* on the docs site.

The files in docs/ and the CHANGELOG are written with links that work on GitHub
(``../CHANGELOG.md``, ``docs/SECURITY-AUDIT.md``). On the site those paths do not exist, so the
links are rewritten while the page is built. The files on disk are not changed.
"""

import re
from pathlib import Path

REPO_BLOB = "https://github.com/thepizzatech/ribbon/blob/main/"

# Files that live next to README.md and have a page on the site.
SITE_PAGES = {
    "CHANGELOG.md": "changelog.md",
    "CONTRIBUTING.md": "contributing.md",
}

PARENT_LINK = re.compile(r"\]\(\.\./([A-Za-z0-9_.-]+)(#[^)]*)?\)")


def on_page_markdown(markdown, page, config, files):
    def parent(match):
        name, anchor = match.group(1), match.group(2) or ""
        target = SITE_PAGES.get(name)
        if target:
            return f"]({target}{anchor})"
        return f"]({REPO_BLOB}{name}{anchor})"

    if page.file.src_uri == "changelog.md" and "<!-- CHANGELOG -->" in markdown:
        # The CHANGELOG sits at the repository root, so it is pulled in here, minus its own title,
        # and its "docs/..." links are made relative to the site.
        changelog = Path(config["docs_dir"]).parent / "CHANGELOG.md"
        text = changelog.read_text(encoding="utf-8")
        text = re.sub(r"\A# Changelog\s*", "", text)
        text = text.replace("](docs/", "](")
        markdown = markdown.replace("<!-- CHANGELOG -->", text)
    return PARENT_LINK.sub(parent, markdown)
