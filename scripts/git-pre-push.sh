#!/bin/sh

# Judge the commit messages this push would publish. The commit-msg hook only
# sees a message as it is written, so a rebase, an amend, or a commit made with
# --no-verify reaches the remote unread. This is the last place to catch that
# while the history is still local and cheap to rewrite.
#
# It also refuses new work on the main branch of any other copy of this
# repository, which in practice is a fork a pull request is about to be opened
# from. The same rule runs in .github/workflows/check.yml for a contributor who
# never installed the hooks.

set -u

remote=${1:-}
url=${2:-}

# From the repository, not from $0: git invokes the hook through the wrapper in
# .git/hooks, so dirname of $0 names that directory and not scripts/. Hooks run
# with the working tree root as the working directory.
script_dir=$(git rev-parse --show-toplevel)/scripts
zero=0000000000000000000000000000000000000000
failed=0

# For a new branch the remote has no tip to diff against, so "new" means every
# commit not already published somewhere. Scoped to this remote when it has
# refs, because a commit already on another remote is not this push's to judge.
published="--remotes"
if [ -n "$remote" ] \
    && [ -n "$(git for-each-ref --count=1 --format='%(refname)' "refs/remotes/$remote/")" ]; then
    published="--remotes=$remote"
fi

# Known by its URL, because a clone names it origin or upstream depending on
# whether it was cloned from the fork or from here. Anchored at the host so a
# look-alike such as notgithub.com is not taken for it, with an optional port
# for GitHub's SSH fallback at ssh.github.com:443. Bracketed dots rather than
# escaped ones, since awk -v reads backslashes as string escapes.
upstream_url='(^|[@/.])github[.]com(:[0-9]+)?[:/]sysprog21/codetrial([.]git)?/?$'
upstream=$(git remote -v \
    | awk -v pattern="$upstream_url" 'tolower($2) ~ pattern { print $1; exit }')
to_upstream=0
printf '%s\n' "$url" | grep -Eiq "$upstream_url" && to_upstream=1

while read -r local_ref local_sha remote_ref remote_sha; do
    [ -n "${local_ref:-}" ] || continue
    [ "$local_sha" != "$zero" ] || continue
    git cat-file -e "${local_sha}^{commit}" 2> /dev/null || continue

    # A pull request follows its head branch, so one opened from a fork's main
    # takes in every later push there, and the contributor cannot start a second
    # change until it merges. Syncing that main with upstream is still allowed:
    # it carries only commits upstream already has. Without an upstream remote
    # there is nothing to tell the two apart, and the check in CI covers the
    # pull request instead.
    if [ "$remote_ref" = refs/heads/main ] && [ "$to_upstream" -eq 0 ] \
        && [ -n "$upstream" ] \
        && [ -n "$(git rev-list -n 1 "$local_sha" --not "--remotes=$upstream")" ]; then
        echo "Push rejected: main on $remote would carry commits $upstream does not have." >&2
        echo "Push a topic branch instead: git push $remote HEAD:refs/heads/<topic>" >&2
        echo "Only syncing? Run git fetch $upstream first." >&2
        failed=1
        continue
    fi

    # The remote tip is whatever the other side advertised, which a clone that
    # has not fetched since does not have. Judging what is unpublished anywhere
    # is the same question asked a wider way, and it beats refusing the push
    # over an object nobody here can read.
    if [ "$remote_sha" = "$zero" ] \
        || ! git cat-file -e "${remote_sha}^{commit}" 2> /dev/null; then
        commits=$(git rev-list --no-merges "$local_sha" --not "$published")
    else
        commits=$(git rev-list --no-merges "${remote_sha}..${local_sha}")
    fi || {
        echo "Push rejected: cannot list commits for $local_ref" >&2
        failed=1
        continue
    }

    [ -n "$commits" ] || continue
    printf '%s\n' "$commits" | "$script_dir/check-commit-log.sh" || {
        echo "Push rejected for $local_ref -> $remote_ref." >&2
        failed=1
    }
done

exit "$failed"
