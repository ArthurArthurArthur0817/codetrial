#!/bin/sh
# Read-only snapshot of the open issues for the triage sweep. Writes nothing to
# GitHub; SKILL.md says what each list asks of the maintainer and what it does
# not prove.
#
# Usage: issue-sweep.sh [repo] [wait-days] (default sysprog21/codetrial, 7)
#
# Prints one JSON object:
#   unanswered  issues no maintainer has commented on, oldest first
#   waiting     issues whose newest maintainer comment is newer than anything
#               the reporter did since, comment or body edit; overdue once it
#               is older than wait-days. Issues a maintainer opened are left out
#   linked      issues a pull request cross-referenced after the issue opened,
#               split into merged and still open; a PR from another
#               repository is left out, since its number means nothing here
#   lint        mechanical gaps per issue: empty_body, placeholder (template
#               text left in), empty_section, title_prefix, not_english (more
#               CJK than Latin letters; other scripts are not detected), and
#               no_revision on a Bug with no hex revision from the reporter;
#               a bare hash must mix digits and letters so a date or a word
#               does not pass, and a pasted --version line always does
#   truncated   issues with more than 100 comments or cross-references, whose
#               lists above may miss what was cut

set -eu

repo=${1:-sysprog21/codetrial}
days=${2:-7}

# shellcheck disable=SC2016
query='query($owner: String!, $name: String!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN, first: 50, after: $endCursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title body createdAt lastEditedAt authorAssociation
        author { login } editor { login } issueType { name }
        comments(last: 100) {
          totalCount
          nodes { author { __typename login } authorAssociation createdAt body }
        }
        timelineItems(last: 100, itemTypes: [CROSS_REFERENCED_EVENT]) {
          totalCount
          nodes { ... on CrossReferencedEvent { createdAt
            source { ... on PullRequest { number state mergedAt
              repository { nameWithOwner } } } } }
        }
      }
    }
  }
}'

pages=$(gh api graphql --paginate -F owner="${repo%/*}" -F name="${repo#*/}" \
    -f query="$query")

# A maintainer is whoever GitHub marks as a member, owner or collaborator; a
# bot's comment never asks the reporter for anything. The reporter answering by
# editing the body counts, since the bug form and maintainers both ask for that.
printf '%s\n' "$pages" | jq -s --argjson days "$days" --arg repo "$repo" '
def ts: if . == null then 0 else fromdateiso8601 end;
def age: (now - ts) / 86400 | floor;
def staff: IN("MEMBER", "OWNER", "COLLABORATOR");
def human: .author != null and .author.__typename != "Bot";
def cjk: [scan("[\\p{Han}\\p{Hiragana}\\p{Katakana}\\p{Hangul}]")] | length;
def latin: [scan("[A-Za-z]")] | length;
[.[].data.repository.issues.nodes[]] as $issues |
def maint: [.comments.nodes[] | select(human and (.authorAssociation | staff))];
def mine: .author.login as $a | [.comments.nodes[]
  | select($a != null and .author.login == $a) | .createdAt | ts]
  + [if .editor.login == $a then .lastEditedAt | ts else 0 end] | max;
def gaps: (.body // "") as $b
  | ($b + " " + ([.author.login as $a | .comments.nodes[]
      | select($a != null and .author.login == $a) | .body] | join(" "))) as $said
  | [ (select($b | gsub("(?m)^#+.*$|\\s"; "") | length < 40) | "empty_body"),
      (select($b | test("\\[([Pp]lease )?[Ff]ill in|<[A-Z][a-z][^<>\\n]{15,}>"))
        | "placeholder"),
      (select($b | test("(?m)^(#{1,6}) [^\\n]+\\n\\s*(^\\1 |\\z)"))
        | "empty_section"),
      (select(.title | test("^\\s*(\\[[^\\]]+\\]|[A-Za-z]+(\\([^)]*\\))?:)\\s"))
        | "title_prefix"),
      (select((.title | cjk > 0) or (($b | cjk) > ($b | latin)))
        | "not_english"),
      (select(.issueType.name == "Bug"
          and ($said | test("codetrial [0-9.]+ \\([0-9a-f]{7,40}\\)|\\b(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\\b") | not))
        | "no_revision") ];
{
  unanswered: [$issues[] | select(maint | length == 0)
    | {issue: .number, author: .author.login, age_days: (.createdAt | age)}]
    | sort_by(-.age_days),
  waiting: [$issues[] | select(.author != null
      and (.authorAssociation | staff | not))
    | (maint | max_by(.createdAt | ts)) as $ask
    | select($ask != null and ($ask.createdAt | ts) > mine)
    | {issue: .number, author: .author.login, asked_by: $ask.author.login,
       asked_at: $ask.createdAt, idle_days: ($ask.createdAt | age),
       overdue: (($ask.createdAt | age) >= $days)}]
    | sort_by(-.idle_days),
  linked: [$issues[] | (.createdAt | ts) as $born
    | [.timelineItems.nodes[] | select(.source.number != null
        and .source.repository.nameWithOwner == $repo
        and (.createdAt | ts) >= $born) | .source] as $prs
    | select($prs | length > 0)
    | {issue: .number,
       merged: [$prs[] | select(.mergedAt != null) | .number] | unique,
       open: [$prs[] | select(.state == "OPEN") | .number] | unique}],
  lint: [$issues[] | gaps as $g | select($g | length > 0)
    | {issue: .number, title, gaps: $g}],
  truncated: [$issues[] | select(.comments.totalCount > 100
      or .timelineItems.totalCount > 100) | .number]
}'
