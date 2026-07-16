# Local secret scan evidence — 2026-07-16

- Tool: official Gitleaks `v8.30.1` Windows x64 release
- Git history: `18` commits, approximately `1.06 MB`, no leaks found
- Committable working set: `324` tracked or untracked-but-not-ignored files, approximately `1.75 MB`, no leaks found
- Redaction: enabled for every scan

An initial raw-directory scan also inspected ignored tool caches and reported 40 pattern matches, all below `.firecrawl/`. That directory is excluded by `.gitignore` and `git check-ignore`, and `git ls-files .firecrawl` returned no tracked files. No matched value was copied into this record.

This evidence proves the current local history and committable working set pass Gitleaks. It does not replace the first successful remote `Secret scan / gitleaks` workflow run after the workflow is pushed.
