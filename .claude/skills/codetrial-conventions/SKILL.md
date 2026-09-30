---
name: codetrial-conventions
description: The CodeTrial conventions the gate does not settle on its own, several of them enforced by the git hooks instead - the register a comment, a commit message, an issue or PR title and a PR reply are written in, what stays out of a public issue or PR, the untracked working docs at the repo root, where multi-byte characters are allowed and where they are not, deleting a redundant surface instead of deprecating it, the contracts in docs/ that refuse a change, and the repository layout. Use when drafting a commit message, choosing an issue or PR title, pushing a branch to open a pull request from, adding a file or a public surface, removing a flag or a subcommand, proposing a change to how an interview spends, caches, records or reports, drafting or editing any public issue, PR or comment, or writing a comment longer than a line.
---

# CodeTrial conventions

The gate settles formatting and correctness. `cargo fmt`, Prettier, ESLint,
`ruff` and `shellcheck` run in `scripts/test.sh`, so none of that is here. What
is here is what a reviewer would otherwise have to say out loud, plus the rules
the git hooks enforce, so an agent knows them before a hook refuses: the commit
message, the staged-content checks, and the branch a pull request is opened
from. Install them with `make hooks`.

`README.md` is the tracked half and this file does not restate it. Where the
two speak to the same thing, `README.md` wins.

## Commit messages

The house style is Chris Beams' seven rules, and `scripts/git-commit-msg.sh`
enforces the mechanical ones: subject within 50 characters, capitalized,
imperative, no trailing period, no backticks, no conventional-commit prefix,
body wrapped at 72, printable ASCII throughout. Run
`git log --no-merges --format=%s | awk '{print length}' | sort -n` if you want
the calibration set rather than a number here that drifts with every commit.

The rule the hook cannot check is what the body says. This tree keeps its
detailed reasoning in the comment next to the code, often several paragraphs
per decision. A body that retells the mechanics duplicates that comment and
then goes stale on its own. Write the premise and the trade, once, usually a
single paragraph:

```
Bound a video frame by the memory it will take
Refuse a permission listing that may be truncated
Prove an empty test run is not a pass
```

## Prose register

Source comments and commit messages are ASCII: no em dash, no typographic
quote, no arrow character, no CJK. Markdown files are exempt and use ordinary
GitHub Markdown, so a backtick belongs in `docs/` and not in a commit subject.

Chinese, and CJK generally, stays out of `src/`, `web/` and `tests/` even when
the conversation that produced the change was in Chinese. The product's
surfaces are English. A test that genuinely needs multi-byte input to pin a
character-boundary rule should use characters that read as a fixture rather
than as prose in any language: Greek letters, accented Latin, an emoji. Say in
the comment that the byte width is the point.

## Comments

Brevity is part of correctness, but the bar here is rationale rather than
length: this tree carries long comments where the reasoning is long, and the
rule is that every line of one says something the code cannot. Delete anything
restating the statement below it.

- Bad: `let deadline = start + duration; // add the duration`
- Good: `let deadline = start + duration; // truncated to whole minutes above,
  so the page and the interviewer end at the same number`

Never point a comment, a docstring or a `docs/` page at `TODO.md`. It is
untracked and per-developer, so the reference dangles for everyone else. Code
may name the path where it genuinely reads the file, and a runtime diagnostic
may print it so the reader can navigate.

## Working docs at the repo root

`TODO.md`, `DONE.md` and `CLAUDE.md` are excluded through `.git/info/exclude`,
not through `.gitignore`, because the exclusion is one person's habit and
`.gitignore` would push it onto everybody. Never `git add`, stage, commit or
delete them, and never assume a clone has them. Reports and analyses stay out
of the tree the same way: a scratch directory, not a new tracked file.

## Contracts that refuse a change

`docs/` holds decisions already made, and some of them refuse a change that
looks obviously right. Find the owning document and read the rule there before
proposing work in its area. Never restate one of these rules from memory or
from this file: a paraphrase drifts, and the document is what binds.

`docs/provider-cost-and-degradation.md` owns what an interview may spend, what
bounds a misbehaving provider, what may be cached, and what the candidate sees
when a provider fails. `docs/observable-delivery-policy.md` owns what a report
may say about a person, `docs/recording-contract.md` owns what happens to
candidate media, and the rest of `docs/` owns its area the same way. The
compatibility promise is below, under deleting a surface.

A document that refuses your change is the answer, not an oversight waiting to
be fixed. "Persist the finished session and regenerate the report later" reads
as an obvious improvement, and the caching rule refuses it. The move is to
propose changing that document on purpose, with the reason, or to leave it
alone.

## Deleting a surface

A subcommand, flag or helper that turns out to be redundant gets deleted,
along with its call sites in the Makefile, the scripts, the README and the
tests. It does not become an alias and it does not get a deprecation warning.
"Never break userspace" here means the compatibility contract the golden
fixtures in `tests/golden/` and the versions recorded in
`docs/interview-contract-versions.md` describe, not the convenience surface of
the CLI.

## GitHub issues and pull requests

Conversation may use the contributor's language; everything posted to GitHub is
clear English, with identifiers and error messages kept verbatim. The target is
`sysprog21/codetrial`; pass `--repo sysprog21/codetrial` to `gh`, because on a
fork or a copy the checkout's default resolves elsewhere.

A title carries no category, type or area prefix: no `[Bug]`, `[Feature]`,
`Bug:`, `feat:`, `fix(web):` or `web:`. Labels do the classifying. Brackets that
are part of the text, such as `argv[0]`, stay. An issue title names the symptom
or the desired outcome:

- `[Bug] Interview broken` becomes `Interview does not resume after reconnecting`.
- `[Feature] Add export` becomes `Allow candidates to download interview feedback`.

A PR title follows the commit subject rules above; a single-commit PR reuses
its subject.

Issue and PR bodies are read in a browser, so write each paragraph as one line;
the 72-column wrap is for commit messages only. A PR that finishes an issue ends
with `Closes #N` alone on the last line; one that only touches it ends with
`Refs #N` there instead.

Nothing public carries credentials, session tokens, candidate recordings or
personal interview content; redact logs before pasting them. The repository has
no private security channel, so a vulnerability report goes to the user to hand
to a maintainer, never into a public issue.

Nothing is written to GitHub until the user has approved the exact text, by
saying yes to it or by dictating it and asking for it to be posted. The approval
covers the writes shown. Approving a PR submission also covers later fix pushes
to that branch and the review replies gh-submit makes while getting its checks
green; any other comment, edit, close or merge needs its own.

Never paste drafted text into shell source, where backticks and `$()` in a
quoted error would run. Write the body to a UTF-8 file in a scratch directory
with a file tool and pass `--body-file`; put the title in a file too and pass
`--title "$(cat "$SCRATCH/title.txt")"`. Read the result back, and after a
timeout check whether the write landed before retrying.

Drafting an issue or PR body, or planning a first contribution, is
[codetrial-contribute](../codetrial-contribute/SKILL.md). Reviewing the backlog
for duplicates and incomplete reports is
[codetrial-issue-triage](../codetrial-issue-triage/SKILL.md).

## Pull request branches and review replies

Open a pull request from a topic branch, never from `main`, and that includes
the `main` of a fork. A pull request follows its head branch rather than a set
of commits, so one opened from `main` takes in every later push there, and the
next change cannot start until it merges. Branch from an up-to-date `main`, keep
one change per branch, and update the pull request by pushing to that same
branch, force-pushing after a rebase. The pre-push hook refuses new work on a
fork's `main`, and CI fails a pull request opened from one; syncing a fork's
`main` with upstream is still allowed.

The commit body carries what and why. A review thread carries a correction, a
measurement or nothing: no pasted agent walkthroughs, no severity tables, no
re-summarizing a diff git already shows. Close an addressed thread with
"Resolve conversation".

## Layout

`README.md` has the tree under "Repository layout" and wins on it. Two
directories it does not name matter as soon as you add a test:

```text
tests/unit/     Unit test bodies, compiled into src/ by `#[path]`
tests/common/   What the integration tests share
```

## No test bodies under src/

`src/` holds implementation. A file there may declare a test module, and may
carry a `#[cfg(test)]` item that a test needs to reach, but must not contain a
test body. `grep -rn '#\[test\]' src/` returns nothing, and that is the check
that keeps being true.

```rust
#[cfg(test)]
#[path = "../tests/unit/gemini.rs"]
mod tests;
```

Three lines, and the body lives in `tests/unit/`, mirroring the path under
`src/`. `tests/unit/web/pool.rs` holds what `src/web/pool.rs` declares.

The indirection is what keeps both halves of the promise. A test under
`tests/*.rs` is an integration test: it links the plain rlib and can reach only
the public API, so moving these outright would have meant publishing internals
for the tests' benefit. Declared this way they are still unit tests -- same
module path, `super::` still the containing module, private and `pub(crate)`
items still in reach -- and none of it is visible to a dependent. The two halves
cannot share a module, which is why `tests/common/` exists and why the credential
predicate is deliberately written twice.

Four rules follow, and each of them cost something to learn:

- **Never name a file `tests/<dir>/main.rs`.** Cargo reads that as an
  integration-test target and compiles it a second time as a crate root, where
  every `super::` in it fails. `src/main.rs` declares `tests/unit/bin.rs` for
  this reason. Any other name under `tests/unit/` is inert to autodiscovery.
- **`include_str!` and `include_bytes!` resolve against the file that writes
  them**, so a test reading its own production source needs the path rewritten
  when it moves. Two such tests failed loudly on the move and two more kept
  passing while reading the test file instead of the source, which is worse.
- A second test module in one file keeps its name:
  `src/accounts/schema.rs` declares `tests/unit/accounts/schema.migration_tests.rs`.
- `tests/unit/` is not scanned by the gate's browser or Python lanes and has no
  `main.rs`, so nothing under it becomes a target on its own. It compiles only
  because something in `src/` names it.

Generated files live under `web/` but are owned by `problem-bank/` and by the
generators in `scripts/`; editing one by hand is a drift the gate catches.
codetrial-verify names the generators.
