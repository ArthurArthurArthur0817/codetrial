---
name: codetrial-contribute
description: Help CodeTrial contributors turn observations into clear English GitHub issues, small contribution plans, and pull request descriptions. Use to draft, improve or file a CodeTrial issue, prepare a PR description, ask a focused maintainer question, or choose a bounded first contribution with an AI agent. The deliverable is copy-ready text; judging an existing backlog for duplicates is codetrial-issue-triage. Opening a PR goes through gh-submit when it is installed; this skill covers it otherwise.
---

# Contribute to CodeTrial

CodeTrial is a mock interview platform, and contributing with an AI agent is a
supported way to learn. Start from the contributor's observation or intended
outcome. Explain unfamiliar terms briefly in their language, then produce an
English issue or PR draft they can understand and check. Never make a
questionnaire, skills survey or quiz a prerequisite for help.

Titles, body formatting, issue references and redaction follow
[CONTRIBUTING.md](../../../CONTRIBUTING.md); the rules for writing to GitHub,
approval included, are in the GitHub section of
[codetrial-conventions](../codetrial-conventions/SKILL.md). Keep technical
identifiers and quoted errors exact.

Example requests: "Turn these notes into an issue", "Help me make my first
CodeTrial contribution", or "Write a PR description from this diff". Produce
the artifact the user asked for.

## Draft or improve an issue

Check existing open and closed issues and related PRs first, using the retrieval
and comparison workflow in
[codetrial-issue-triage](../codetrial-issue-triage/SKILL.md). If a report already
covers the problem, offer a focused addition to that thread with new evidence.
When the deliverable is instead a verdict on someone else's thread, that comment
is codetrial-issue-triage's. If GitHub access is unavailable, still prepare the
draft and explicitly mark the duplicate search as unverified.

Use the information already available in notes, logs and the checkout. Ask only
for missing facts that change the report's meaning. Never invent reproduction
steps, versions, root causes or successful tests. A plausible explanation is a
hypothesis; observed behavior is evidence.

Choose the smallest useful structure:

- **Bug**: concrete symptom, expected and actual results, numbered minimal
  reproduction steps, relevant version/environment, and a short sanitized error
  or other evidence. Identify the build by revision rather than by date, since
  published binaries move under a rolling tag (`docs/install.md`); triage has why
  that makes a date one-directional. Ask first what the binary reports about
  itself; when it reports nothing, say the revision is unknown and give the exact
  download timestamp, which still bounds the build from above.
  For an interview failure, `.github/ISSUE_TEMPLATE/bug.yml` is the field list;
  ask only for the ones that matter. The problem language matters because Python
  and JavaScript run in the browser while C, C++ and Java run remotely, so one
  symptom means two different things across that split. Record frequency or
  regression range when known.
  Unknown details can stay explicitly unknown; a useful report need not
  diagnose a fix.
- **Feature**: who is affected (candidate, operator or contributor) and in which
  workflow, desired outcome, present workaround, scope and observable acceptance
  criteria. Keep a suggested implementation separate from the need it serves.
- **Documentation**: page or section, what is missing or misleading, and the
  intended correction or reader outcome. Do not demand runtime logs for prose.

Do not split a single problem across multiple issues just to fill categories.

Return a copy-ready title and body, followed by any remaining questions outside
the draft. Link related work and explain whether it overlaps or differs. For a
maintainer question, give the context, what was inspected or attempted, and one
specific decision needed to continue.

## Make a first contribution manageable

Offer one bounded task matched to the contributor's stated experience and time,
or a small first step when neither is given. Inspect current code and tests
before naming likely files; a `good first issue` label alone is not proof of
suitable scope.

Give the contributor:

- a visible result, such as a minimal reproduction, focused docs correction or
  regression test and fix;
- likely entry points and a concrete acceptance check;
- a stopping condition and fallback, such as drafting the exact maintainer
  question if the expected behavior is still undecided.

Keep unrelated refactoring out of the task. Do not require filing an issue for
every small, well-understood fix. For uncertain product direction, establish
the desired behavior before investing in a large implementation. When coaching,
help the contributor explain what fails before and succeeds after the change.

## Prepare a pull request people can review

Read the full branch diff against its intended base, relevant commits and linked
issues. Check that the branch contains the intended work only, and use a topic
branch as described in conventions. Preserve unrelated working-tree edits.
AI-generated summaries are starting points: validate every claim against the
diff and actual test results. Do not paste a conversation transcript.

Use [codetrial-verify](../codetrial-verify/SKILL.md) for the appropriate validation
and [codetrial-web](../codetrial-web/SKILL.md) when browser or wire behavior is
involved. Report commands and outcomes, including failures and skipped or unrun
checks with reasons. Local success is not evidence that remote CI passed.

The description should cover:

- the concrete problem and resulting behavior, with a before/after example
  when it clarifies the change;
- the essential implementation choice or tradeoff a reviewer needs to assess;
- validation evidence and material limitations; include screenshots or sanitized
  logs only when they help verify the result;
- relevant compatibility or follow-up work, then the issue reference line.

For a simple PR, one or two paragraphs plus validation is enough. Rewrite the
title and body when scope changes.

## Publish only after the user sees the text

A request to file an issue or open a PR authorizes preparing it; posting still
waits for the approval described in conventions. Show the target repository and
the title and body verbatim. Feedback that changes the draft without saying to
post it gets the revised draft shown again; "change the title to X and submit"
approves the result and needs no second round.

To open a PR, pass the drafted title and body to gh-submit when it is
installed, and tell it the base is `sysprog21/codetrial`, since on a fork its
`origin` is the contributor's copy. Its single confirmation of repository,
branches, commits, title and body is the approval; do not ask separately first.
Without gh-submit, show the same five things, create the PR with
`--repo sysprog21/codetrial --head <fork-owner>:<branch>` after the yes, and
follow with `gh pr checks <N> --repo sysprog21/codetrial --watch` so the
contributor learns whether CI passed rather than just receiving a URL.

For an issue, repeat a narrow search on the title terms just before creating it,
in case someone filed it meanwhile:

```sh
gh issue list --repo sysprog21/codetrial --state all --search '<title terms>' --limit 5 --json number,title
gh issue create --repo sysprog21/codetrial --title "$(cat "$SCRATCH/title.txt")" \
  --body-file "$SCRATCH/issue.md"
```

Finish with the verified URL and the next concrete step, including any
outstanding evidence the contributor can supply.
