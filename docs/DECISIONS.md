# Decisions

Each entry: date, decision, alternatives considered, reason.

## 2026-09-30: No open-source license

- **Decision:** the repository has no LICENSE file and stays all rights
  reserved by default.
- **Alternatives:** MIT, Apache-2.0.
- **Reason:** the owner has not chosen a license, and the project displays
  data owned by the NHL. Adding a license is a decision for the owner.

## 2026-09-30: Git hooks live only in `.git/hooks`

- **Decision:** the commit-msg and pre-commit hooks are installed locally and
  not committed; the em dash check script they call is committed and CI runs
  it with `--all`.
- **Alternatives:** a committed `.githooks/` directory with
  `core.hooksPath`, or the pre-commit framework.
- **Reason:** keeps the repo free of tooling that only matters to one
  machine, while CI enforces the same rule for every clone.
