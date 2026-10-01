# Provider cost and degradation controls

What one interview costs upstream, what bounds it when a provider misbehaves,
and what the candidate sees when it does.

## What an interview spends

Each admitted interview spends one LiveKit and Gemini live-session open, plus
one open per Gemini socket close it survives. Gemini caps a single connection at
around ten minutes, so a long interview spends several on its normal path. A
`GoAway` moves to a replacement before that close, at the first moment nothing
is lost by it: no reply generating, no reply awaited, and nothing left in the
LiveKit playout queue. A candidate talking over the queued reply is such a
moment, so the advisory is spent then rather than held for a turn boundary that
Gemini will not send. The replacement resumes the same conversation when the
server issued a handle; if the handle is unavailable or refused, the restart is
logged as degraded and is grounded from the bounded local transcript tail,
editor, round and evidence state instead.

`GEMINI_RESTART_LIMIT` bounds a failing endpoint rather than a long interview.
It allows 8 opens in a row, and any socket that lived past a minute clears the
run. A project that cannot pay is not an endpoint that may recover: a 402, or a
close reason saying the prepaid credit is depleted or billing is not enabled,
takes that key off both the Live and the report surface and is retried only on
another configured key. With none left the interview ends at once instead of
spending the remaining opens, and its summary line says `outcome=billing`.

Every Live turn is billed on the whole context it runs in, retained audio and
images included, so what stays in the context costs again on every later turn.
Candidate video, off by default, therefore sends one frame in five seconds and
asks for the low media resolution; the camera is there for presence, and the
code reaches the model as text.

Final reporting has its own hard budget of six Gemini HTTP calls: initial
generation plus one semantic repair, each generation allowing its first call and
at most two transient retries. The counter is consumed immediately before the
network request, so no future loop change can exceed the budget by accident.
Authentication failures, bad models, malformed responses, and other permanent
failures get no transport retry.

Quiet-pause interim reviews use that same report model and quota. A review is
eligible after 8 seconds of candidate quiet and 150 seconds from interview start,
no more often than every 150 seconds, and only after six new candidate turns;
none starts once the interviewer has asked to close or the planned time would
run out before the call returned, and a review whose editor has not changed
since the last one is told so instead of being sent it again.
Before the cap, a 90-minute
interview can make at most 36 such calls; shorter interviews cannot exceed that
rate. `CODETRIAL_MAX_INTERIM_REVIEWS` defaults to 6, accepts `0` to disable
the reviews, and is capped at 72. This is a quota guard, not a completeness
limit: the final report still receives the complete transcript and editor state.

## What bounds concurrency

The server admits at most `CODETRIAL_MAX_CONCURRENT_INTERVIEWS` live local
agents, 16 by default. A reload of an already-live room reuses its slot;
completion and panic release it. Provider projects are rotated and their LiveKit
connection-minute quota is refreshed in the background, and known-exhausted
projects are skipped.

The token endpoint allows 30 starts per 60-second bucket. Signed-in buckets are
keyed by account and anonymous buckets by client address, so anonymous traffic
cannot spend an authenticated candidate's allowance.

Candidate-facing failures use bounded machine-owned categories such as
`at_capacity`, `livekit_quota_exhausted`, rate limit with retry-after, report
schema failure, and report timeout. Logs never include provider bodies, API
keys, prompts, transcripts, code, or grounding text.

## What may be cached

Checked-in and static problem-bank data, schemas, and vendored runtime metadata,
and nothing else. Never candidate prompts, transcript, code, profile, job
description or resume grounding, provider output, repair output, framework
evidence, or personalized feedback. Report requests are built from the current
session and each retry uses that same session's immutable prompt, so there is no
cross-session response cache.

## What the candidate sees

The browser exposes distinct accessible states for connecting, live,
reconnecting, offline practice, report generation, incomplete report, and
retry-ready. Reconnecting preserves the live session and resends current code.
Offline practice keeps the editor and local tests usable while explicitly
promising no personalized evaluation. An invalid or exhausted report says that
no scores or verdict were created. Browser fallback may summarize local test
progress only for a session that never reached an interviewer, and never
presents canned feedback as an agent evaluation.

## Operating it

Watch `codetrial dispatch_refused ... reason=at_capacity`, `livekit quota:`
transitions, token HTTP 429 with `Retry-After`, `gemini report
transport_failed call=... retry=...`, `codetrial live_usage ... outcome=billing`,
and the bounded incomplete-report categories.

Raise concurrency only after checking provider minutes, Gemini limits, CPU and
audio capacity, and the token burst policy. The deterministic dispatcher,
rate-isolation, resume-limit, report-budget, request-isolation, and browser-state
tests all run under `./scripts/test.sh`.

## Measuring token consumption

Google's [Live API billing guidance](https://ai.google.dev/gemini-api/docs/live-api/best-practices#pricing-and-billing)
bills each turn on the entire active context, retained raw audio included, and
adds a text-output charge for enabled audio transcription. The logs below are
what the provider reported to this server, not an invoice. Reconcile them with
an isolated project's billing before quoting a monetary figure, and do not
infer an account balance from them.

- `codetrial live_turn_usage` is one usage observation: room, `session` (the
  epoch millisecond the room loop started, so two runs sharing a room stay
  apart),
  interview clock, socket, event index, `cause`, and the provider's counters.
- `cause` names the last platform input that asked for a reply before the
  observation: `watch`, `turn` (greeting, test reaction, wrap-up and similar
  stage directions), `tool` or `recovery`, or `candidate` when the platform
  asked for nothing since the previous completed turn. Silent context, such as
  a compression checkpoint, asks for nothing and is billed inside whichever
  turn follows; `codetrial context_refresh` lines count it. The label says where
  turns come from, not a causal record: speech overlapping a platform input is
  credited to the input.
- `codetrial live_usage` sums a session's observations across its sockets, with
  the model, elapsed seconds, socket count and an `outcome` of `ok`, `error`,
  `gemini_unreachable` or `billing`. It is written on every exit of the room
  loop, and once with `phase=startup` and no socket count when the interview
  failed before its first turn, a first open that was refused included.
- `gemini report` and `gemini interim` lines carry the room, call number and
  retry count of each HTTP call. A failed call has no usage line; every one is
  counted from `gemini report transport_failed` (with `final=true` when it was
  not retried) and `interim review skipped`, and none is assumed free.

The counters keep prompt, response, cached, thought, tool-use prompt and total
counts, plus modality details for prompt, response, tool-use and cached tokens.
Response aliases are alternatives, not additive counters. A scalar the provider
omits is logged as zero. Each `*_detail_samples` counts valid detail arrays, so
zero samples means the breakdown is unknown and fewer than `usage_samples`
means it is partial; details may also sum to less than their scalar. The
analyzer reports a direction with a zero total and no breakdown, such as tool
use in a session without tools, as `none_reported`, never as complete: an
unused direction and one the provider left out look the same. Never add
cached tokens to the prompt total.

`turn_complete_samples` counts observations that shared a frame with
`turnComplete`. Usage is recorded when its frame is decoded, before that frame's
content is queued, so a room that stops reading does not lose what it had
received. If a session's `usage_samples` exceeds its `turn_complete_samples`,
some observations arrived on frames of their own, and a sum may include
periodic snapshots of the same turn; treat it as an upper bound until the
provider's event semantics are confirmed. A process kill or task cancellation
can still leave a session without its summary.

`codetrial model_input_bytes` measures what this server constructed, by kind.
It is not billed tokens: it cannot see the retained context a turn is billed on.

## Comparing captured logs

`python3 scripts/analyze-gemini-usage.py interview.log` prints the counters above
as JSON, grouped by room and by Live session, and ignores everything else in
the log, including prefixes a log collector adds. `--room ROOM` selects one
room; stdin is read when no file is given, and the exit status is 2 when no
usage record matches.

A summarized session is reported from its summary; a session with events but
no summary is reported from them and marked incomplete. For each session with
events it also reports the prompt count of each completed turn in order, its
growth per turn, and counts by `cause`. The output makes no price or quality
claim.

Compare one change at a time, on the same synthetic interview, model, speech,
editor events and planned turns, with repeated runs. Record prompt and modality
counts, usage coverage, completed turns, reconnects, first-audio latency,
completion, and whether the interview still recalled the evidence it needed. A
projection is not an observed saving, and a smaller context must preserve the
interview's evidence before it becomes a default.

## Configuring a compression experiment

`GEMINI_CONTEXT_TRIGGER_TOKENS` and `GEMINI_CONTEXT_TARGET_TOKENS` are an
optional pair. Both must be positive integers, target strictly below trigger,
or config loading fails. Unset, setup still sends `slidingWindow: {}` and
leaves the thresholds to the provider. The pair is sent on every socket,
resumed ones included. Only the provider knows the model's context limit, so
run `codetrial check-gemini`, which opens a session with the same setup, before
an interview does.

With a pair configured, the room watches for a cut context and then sends a
silent checkpoint rebuilt from local state. A turn is taken to have run on a cut
context when its prompt count, judged at completion against the largest count
since the previous completed turn, fell by half the trigger-target gap (limited
to 1 to 2048 tokens), or fell at all from a context that had reached the
trigger. Both are heuristics, not an API compression event.

The checkpoint waits until the candidate is not mid-turn by transcript or by
microphone level, no reply, tool continuation or queued audio is outstanding,
and the interview is not paused; the room retries after Gemini events, at the
playout boundary and on the watch tick. It carries the platform timer, the
chosen language, the current round, the evidenced phases, a 2,500-byte
transcript budget (a long behavioral round keeps up to 750 bytes of its opening
beside the recent dialogue), the test report up to 1,000 bytes, and in the
coding round up to 1,800 bytes of the editor's opening and ending. Omitted
lines are named as omitted and remain available through `read_editor`; omission
is not evidence that a follow-up was unused or that no refusal occurred. A
replacement socket drops a pending checkpoint, because its recovery already
carries local state, and socket recovery keeps its own larger budgets.

Only while a pair is configured do `read_editor`, `log_hint` and
`record_framework_evidence` answers also carry the latest unanswered candidate
utterance, as quoted data, so a reply owed across a cut is not lost. Without a
pair nothing leaves the context during a tool call, and the text would only be
billed again on every later turn.

A lower threshold reduces the history retained for later turns, and may remove
information a follow-up needs or add compression latency. Final reporting still
uses the full local transcript and editor. The credentialed probes that compare
arms and check recall are the ignored tests in `tests/unit/livekit/cost.rs`,
outside the credential-free gate; their file header lists the environment they
need.
