#!/bin/sh

# Use the compiler that built LiveKit's Linux WebRTC archive. Chromium's
# hermetic libc++ requires Clang 21+, including on the Bullseye release image.
set -eu

if [ "$#" -ne 1 ]; then
    echo "usage: $0 DESTINATION" >&2
    exit 2
fi

destination=$1
revision=llvmorg-23-init-10931-g20b6ec66-11
checksum=de584381536aa5ba2403033c4f8b70f3c39c2e5d7fa87c953b7fd8bfbba0ee2a

# Chromium publishes this revision for one host; anything else would fail later
# at exec with a message that names neither the script nor the reason.
if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then
    echo "fetch-clang: only Linux x86_64 is published; set CXX to a Clang 21+ instead" >&2
    exit 1
fi

parent=$(dirname "$destination")
mkdir -p "$parent"

# Two builds starting on a fresh checkout would otherwise both miss the stamp,
# and the second would delete the compiler the first is already running. The
# lock is held until exit, so the stamp is read only by whoever owns it.
exec 9> "$parent/.clang.lock"
flock 9

# The stamp is written last, so a present stamp means a complete unpack of this
# revision and a rerun costs nothing.
stamp=$destination/.revision
if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$revision" ]; then
    "$destination/bin/clang++" --version
    exit 0
fi

archive=$(mktemp)
staging=$(mktemp -d "$parent/.clang.XXXXXX")
trap 'rm -rf "$archive" "$staging"' EXIT HUP INT TERM

# --retry does not bound a connection that stays open and sends nothing; the
# speed floor turns such a stall into a retried failure.
curl --fail --location --silent --show-error \
    --connect-timeout 30 --speed-limit 10240 --speed-time 60 \
    --retry 3 --output "$archive" \
    "https://commondatastorage.googleapis.com/chromium-browser-clang/Linux_x64/clang-$revision.tar.xz"
if ! printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status; then
    echo "fetch-clang: clang-$revision.tar.xz does not match its pinned SHA-256" >&2
    exit 1
fi

# Unpack beside the destination, on the same file system, and rename it into
# place, so an interrupted run leaves no stamp and the next one starts over.
tar -xJf "$archive" -C "$staging"
printf '%s\n' "$revision" > "$staging/.revision"
chmod 755 "$staging"
rm -rf "$destination"
mv "$staging" "$destination"
"$destination/bin/clang++" --version
