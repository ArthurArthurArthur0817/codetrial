//! The `tests` module of `src/livekit/turn.rs`, which declares this file by
//! path.
//! Everything here reaches into `src/livekit/turn.rs` through `super`, so it is
//! a unit
//! test and not an integration test: private items are in scope.

use super::*;

/// A pause arms the discard so a turn already in flight cannot speak over
/// the resume. Arming it on a turn that has finished is the failure: its
/// completion event has already passed, so nothing disarms it and the first
/// reply after the resume is swallowed instead, which is silence exactly
/// where the candidate is waiting to be answered.
#[test]
fn only_a_turn_still_being_produced_leaves_output_to_discard() {
    assert!(pause_leaves_output_in_flight(Floor::Speaking));
    assert!(
        !pause_leaves_output_in_flight(Floor::AwaitingPlayout),
        "the turn is complete and draining, so no event is coming to disarm this"
    );
    assert!(!pause_leaves_output_in_flight(Floor::Listening));
}

#[test]
fn candidate_exit_skips_wrap_up_before_report() {
    assert!(!should_send_wrap_up("candidate_ended"));
    assert!(should_send_wrap_up("time_up"));

    // Jim is told not to say goodbye before calling the tool, so the wrap-up is
    // the only thing that speaks the closing on its route out.
    assert!(should_send_wrap_up("interview_complete"));
}

/// An idle-window review runs in a pause and only in a pause.
///
/// Every condition is a way the room is busy, and each costs something
/// different if it is dropped: reviewing while Jim holds the floor spends a
/// call on a stretch still being said, reviewing with a tool response owed
/// races the turn it belongs to, and reviewing a stretch with nothing new in it
/// pays for a second reading of the same silence.
#[test]
fn a_pause_is_read_only_when_the_room_is_actually_idle() {
    let start = Instant::now();
    let idle = start + INTERIM_COOLDOWN + INTERIM_IDLE;
    let quiet = || RuntimeState {
        transcript: (0..INTERIM_MIN_NEW_TURNS)
            .map(|index| format!("Candidate: line {index}"))
            .collect(),
        ..RuntimeState::default()
    };
    let mut activity = RuntimeActivity::new(start);
    assert!(activity.interim_review_due(&quiet(), idle));

    // Each case is the idle room with one thing wrong with it.
    /// One way the room is busy: the thing to break, and why it disqualifies
    /// the pause.
    type Busy = (&'static str, fn(&mut RuntimeActivity, &mut RuntimeState));
    let busy: [Busy; 8] = [
        (
            "Jim is mid-sentence, so the stretch is not finished",
            |activity, _| {
                activity.mark_speaking();
            },
        ),
        (
            "a generation is already owed on this socket",
            |activity, _| {
                activity.tool_response_outstanding = true;
            },
        ),
        (
            "the candidate is waiting on a reply, so the pause is Jim's",
            |activity, _| {
                activity.awaiting_reply_since = Some(Instant::now());
            },
        ),
        // Expressed as "spoke a second ago", not as an instant in the future: a
        // stamp ahead of `now` fails this too, but only because
        // `duration_since` saturates to zero, which is not the rule being
        // pinned.
        (
            "the candidate has only just stopped talking",
            |activity, _| {
                activity.last_user_speech +=
                    INTERIM_COOLDOWN + INTERIM_IDLE - Duration::from_secs(1);
            },
        ),
        (
            "a paused interview is not idle, it is stopped",
            |_, state| {
                state.paused = true;
            },
        ),
        ("a stretch already read is not read again", |_, state| {
            state.interim_transcript_lines = state.transcript.len();
        }),
        (
            "the interviewer asked to close, and the end aborts a running review",
            |_, state| {
                state.end_requested = true;
            },
        ),
        (
            "the planned time runs out before the call could return",
            |_, state| {
                let planned = u64::from(state.coding_minutes + state.behavioral_minutes) * 60;
                state.started_at -= Duration::from_secs(planned - 5);
            },
        ),
    ];
    for (why, break_it) in busy {
        let mut activity = RuntimeActivity::new(start);
        let mut state = quiet();
        break_it(&mut activity, &mut state);
        assert!(!activity.interim_review_due(&state, idle), "{why}");
    }

    assert!(
        !activity.interim_review_due(&quiet(), start + INTERIM_IDLE),
        "two reviews in one interview are not two reviews in one minute"
    );
    assert!(
        !activity.interim_review_due(
            &RuntimeState {
                transcript: (0..INTERIM_MIN_NEW_TURNS * 2)
                    .map(|index| format!("Interviewer: line {index}"))
                    .collect(),
                ..RuntimeState::default()
            },
            idle
        ),
        "the interviewer talking to itself is not new evidence about the candidate"
    );

    // Claiming the pause is what spends it: the cooldown is stamped where it is
    // read, so the next tick cannot start a second review.
    assert!(activity.claim_interim_review(&quiet(), idle));
    assert!(!activity.claim_interim_review(&quiet(), idle));
}

#[test]
fn interim_review_stops_at_the_cap() {
    let start = Instant::now();
    let state = RuntimeState {
        transcript: (0..INTERIM_MIN_NEW_TURNS)
            .map(|index| format!("Candidate: line {index}"))
            .collect(),
        ..RuntimeState::default()
    };
    let mut activity = RuntimeActivity::with_interim_review_cap(start, 2);
    let first = start + INTERIM_COOLDOWN + INTERIM_IDLE;

    assert!(activity.claim_interim_review(&state, first));
    assert!(activity.claim_interim_review(&state, first + INTERIM_COOLDOWN));
    assert!(!activity.claim_interim_review(&state, first + INTERIM_COOLDOWN * 2));
}

#[test]
fn interim_review_cap_of_zero_claims_none() {
    let start = Instant::now();
    let state = RuntimeState {
        transcript: (0..INTERIM_MIN_NEW_TURNS)
            .map(|index| format!("Candidate: line {index}"))
            .collect(),
        ..RuntimeState::default()
    };
    let mut activity = RuntimeActivity::with_interim_review_cap(start, 0);

    assert!(!activity.claim_interim_review(&state, start + INTERIM_COOLDOWN + INTERIM_IDLE));
}

/// The idle-window review's constants are eleven numbers in three modules, and
/// three pairs of them are load-bearing on each other. Written down here in the
/// shape `report_network_budget_covers_every_repair_and_retry_per_generation`
/// established: the arithmetic a design depends on is asserted, not described,
/// because a comment saying two numbers must relate is checked by nobody.
///
/// One relationship is missing from this list on purpose. The reserve being
/// smaller than the store is asserted at the declaration, where whoever changes
/// either number is already standing; restating it here would be a second copy
/// of the fact, which is what this test exists to prevent.
#[test]
fn one_review_at_a_time_is_arithmetic_and_not_a_hope() {
    use crate::agent::{INTERIM_CONTEXT_NOTES, MAX_INTERIM_LINES_PER_REVIEW, MAX_INTERIM_NOTES};
    use crate::config::DEFAULT_MAX_INTERIM_REVIEWS;
    use crate::gemini::INTERIM_ATTEMPT_TIMEOUT;

    // A call cannot outlive the wait for the next chance to start one. This is
    // what makes the slot in `InterimReview` unable to be occupied when a pause
    // comes due, so the two mechanisms cannot disagree about whether a review
    // is running.
    const { assert!(INTERIM_ATTEMPT_TIMEOUT.as_secs() < INTERIM_COOLDOWN.as_secs()) };

    // What a later review is shown has to leave room for what it may add, or
    // every review is handed a context it cannot help repeating.
    const { assert!(INTERIM_CONTEXT_NOTES + MAX_INTERIM_LINES_PER_REVIEW < MAX_INTERIM_NOTES) };

    // The default quota fits the retained note budget, so no review evicts a
    // previous one before the interview ends. It uses half: the budget is sized
    // for an operator who sets twelve.
    const { assert!(DEFAULT_MAX_INTERIM_REVIEWS * MAX_INTERIM_LINES_PER_REVIEW <= MAX_INTERIM_NOTES) };

    // A pause has to be long enough to be worth reading and short enough to
    // happen; a threshold at or above the cooldown would mean the cooldown
    // never decided anything.
    const { assert!(INTERIM_IDLE.as_secs() < INTERIM_COOLDOWN.as_secs()) };

    // What one call is asked to read, against the seconds it has to read it.
    // Not a throughput claim -- it is the ceiling that keeps the deadline
    // meaningful rather than a coin flip on a long backlog. A review that
    // cannot finish inside INTERIM_ATTEMPT_TIMEOUT spends its prefill and
    // returns nothing, and the window is marked read either way.
    const { assert!(INTERIM_WINDOW_BYTES + INTERIM_CODE_BYTES <= 16 * 1024) };

    // Floored as well as capped. A budget of a couple of kilobytes reads a
    // stretch of interview as a fragment, and a review of a fragment is a note
    // about nothing -- the failure a ceiling on its own cannot see.
    const { assert!(INTERIM_WINDOW_BYTES >= 4 * 1024) };
    const { assert!(INTERIM_CODE_BYTES >= 2 * 1024) };
}

/// A line the model was shown and that has since gone is retracted in so many
/// words; left out, the model keeps holding the stale one.
#[test]
fn an_evidence_line_that_goes_away_is_retracted() {
    let lines = |items: &[&str]| {
        items
            .iter()
            .map(|line| line.to_string())
            .collect::<Vec<_>>()
    };
    let shown = lines(&["tests: not run", "session: paused"]);
    assert_eq!(
        evidence_delta(Some(&shown), &lines(&["tests: not run"])),
        "session: none"
    );
    assert_eq!(
        evidence_delta(
            Some(&shown),
            &lines(&["tests: 1 of 2 passing", "session: paused"])
        ),
        "tests: 1 of 2 passing"
    );
    assert_eq!(evidence_delta(Some(&shown), &shown), "");
    assert_eq!(
        evidence_delta(None, &lines(&["tests: not run"])),
        "tests: not run"
    );
}

/// A review has to be able to return before the planned end: one whose call
/// would run into it is not started, and one a second earlier is.
#[test]
fn no_interim_review_starts_that_the_end_would_abort() {
    let state = RuntimeState {
        transcript: (0..INTERIM_MIN_NEW_TURNS)
            .map(|index| format!("Candidate: line {index}"))
            .collect(),
        ..RuntimeState::default()
    };
    let planned =
        Duration::from_secs(u64::from(state.coding_minutes + state.behavioral_minutes) * 60);
    let last_call = state.started_at + planned - crate::gemini::INTERIM_ATTEMPT_TIMEOUT;
    let activity = RuntimeActivity::new(state.started_at);
    assert!(!activity.interim_review_due(&state, last_call));
    assert!(activity.interim_review_due(&state, last_call - Duration::from_secs(1)));
}

#[test]
fn a_tool_continuation_stays_owed_after_prompt_output() {
    let start = Instant::now();
    let mut activity = RuntimeActivity::new(start);
    activity.mark_prompted(start, None, false);
    activity.note_output();
    activity.tool_response_outstanding = true;

    assert!(activity.prompted_at.is_none());
    assert!(activity.awaiting_reply_since.is_none());
    assert!(activity.owes_reply());

    activity.tool_response_outstanding = false;
    activity.mark_listening();
    assert!(!activity.owes_reply());
}

/// A prompt Gemini never answers must not hold the floor forever: a held floor
/// silences every nudge and keeps a `GoAway` waiting until the server drops the
/// socket from an older checkpoint. Releasing it keeps the reply owed, so the
/// replacement socket still answers.
#[test]
fn a_prompt_with_no_output_returns_the_floor_but_stays_owed() {
    let quiet = Stalls {
        prompt_released: false,
        spend_restart: false,
    };
    let start = Instant::now();
    let mut activity = RuntimeActivity::new(start);
    assert!(!activity.owes_reply());

    activity.mark_prompted(start, None, false);
    assert!(activity.owes_reply());
    assert_eq!(
        activity.settle_stalls(start + PROMPT_STALL - Duration::from_millis(1), false),
        quiet
    );
    assert_eq!(activity.floor, Floor::Speaking);

    assert_eq!(
        activity.settle_stalls(start + PROMPT_STALL, false),
        Stalls {
            prompt_released: true,
            spend_restart: true,
        }
    );
    assert_eq!(activity.floor, Floor::Listening);
    assert!(activity.owes_reply(), "the reply was never given");
    assert_eq!(
        activity.settle_stalls(start + PROMPT_STALL * 2, false),
        quiet,
        "a floor already returned is not returned again"
    );

    activity.mark_prompted(start, None, false);
    activity.note_output();
    assert!(!activity.owes_reply());
    assert_eq!(
        activity.settle_stalls(start + PROMPT_STALL, false),
        quiet,
        "a prompt that produced output is being answered, however slowly it plays"
    );
}

/// The candidate's own turn stalls too: they finish, Gemini sends nothing, and
/// a held `GoAway` has no later event to be spent on. The floor is already
/// theirs, so only the restart is released.
#[test]
fn an_unanswered_candidate_turn_lets_a_held_restart_go() {
    let start = Instant::now();
    let mut activity = RuntimeActivity::new(start);
    activity.note_candidate_finished(start);
    assert!(
        !activity
            .settle_stalls(start + PROMPT_STALL - Duration::from_millis(1), false)
            .spend_restart
    );
    assert_eq!(
        activity.settle_stalls(start + PROMPT_STALL, false),
        Stalls {
            prompt_released: false,
            spend_restart: true,
        }
    );
    assert!(activity.owes_reply(), "their turn is still unanswered");
}

/// A candidate who speaks after a prompt went unanswered has moved on: their
/// turn is what is owed, not the stale prompt.
#[test]
fn speaking_again_retires_an_unanswered_prompt() {
    let start = Instant::now();
    let mut activity = RuntimeActivity::new(start);
    activity.mark_prompted(start, None, false);
    activity.settle_stalls(start + PROMPT_STALL, false);
    activity.note_candidate_finished(start + PROMPT_STALL * 2);
    assert!(activity.prompted_at.is_none());
    assert!(activity.reply_in_flight());

    // A prompt that has produced nothing yet is not a reply under way, so the
    // candidate speaking over it is their turn to answer.
    let mut waiting = RuntimeActivity::new(start);
    waiting.mark_prompted(start, None, false);
    waiting.note_candidate_finished(start + Duration::from_secs(1));
    assert!(waiting.prompted_at.is_none());
    assert!(waiting.reply_in_flight());

    // While Gemini is producing, a lagging transcript fragment retires nothing:
    // the prompt went out behind that turn, and its answer may still be on its
    // way.
    let mut speaking = RuntimeActivity::new(start);
    speaking.note_output();
    speaking.mark_prompted(start, None, false);
    speaking.note_candidate_finished(start + Duration::from_secs(1));
    assert!(speaking.prompted_at.is_some());
    assert!(!speaking.reply_in_flight());
}

/// Output that follows a prompt sent mid-generation is the earlier
/// generation's tail until that turn ends, so it cannot settle the prompt.
#[test]
fn output_behind_a_prompt_belongs_to_the_earlier_turn() {
    let start = Instant::now();
    let mut activity = RuntimeActivity::new(start);
    activity.note_output();
    activity.mark_prompted(start, None, false);
    activity.note_output();
    assert!(
        activity.owes_reply(),
        "the old sentence's tail answers nothing"
    );
    activity.note_turn_boundary();
    assert!(
        activity.owes_reply(),
        "the old turn ending is not the answer"
    );
    activity.note_output();
    assert!(!activity.owes_reply());
}

/// A prompt's own turn ending with nothing said is Gemini answering with
/// silence, and replaying it later would ask what it chose not to.
#[test]
fn a_prompt_answered_with_silence_is_not_owed() {
    let start = Instant::now();
    let mut activity = RuntimeActivity::new(start);
    activity.mark_prompted(start, None, false);
    activity.note_turn_boundary();
    assert!(!activity.owes_reply());
}

/// A briefing that never reached the socket is still owed, without taking
/// the floor from a watcher that has nothing generating to wait for.
#[test]
fn an_owed_briefing_leaves_the_floor_alone() {
    let start = Instant::now();
    let mut activity = RuntimeActivity::new(start);
    activity.owe_prompt(start, None);
    assert!(activity.owes_reply());
    assert_eq!(activity.floor, Floor::Listening);
}

fn window(
    trigger_tokens: u32,
    target_tokens: u32,
) -> Option<crate::config::GeminiContextCompression> {
    Some(crate::config::GeminiContextCompression {
        trigger_tokens,
        target_tokens,
    })
}

/// One completed turn whose usage arrived as `observations`, the last on the
/// completing frame.
fn complete_turn(
    activity: &mut RuntimeActivity,
    pair: Option<crate::config::GeminiContextCompression>,
    observations: &[u64],
) {
    for prompt in observations {
        activity.observe_prompt_tokens(pair, *prompt);
    }
    activity.observe_turn_complete(pair);
}

#[test]
fn context_refresh_tracks_a_significant_prompt_drop_and_ignores_missing_counts() {
    let pair = window(30_000, 8_000);
    let mut activity = RuntimeActivity::new(Instant::now());
    complete_turn(&mut activity, pair, &[20_000]);
    complete_turn(&mut activity, pair, &[0]);
    assert_eq!(activity.peak_prompt_tokens, 20_000);
    assert!(!activity.context_refresh_pending);
    complete_turn(&mut activity, pair, &[19_000]);
    assert!(!activity.context_refresh_pending);
    complete_turn(&mut activity, pair, &[8_000]);
    assert!(activity.context_refresh_pending);
    complete_turn(&mut activity, pair, &[9_000]);
    assert!(activity.context_refresh_pending);
}

/// The input of the turn that was cut can make up most of the cut. A context
/// that had reached the trigger and then shrank at all was cut regardless.
#[test]
fn a_cut_hidden_by_new_input_is_still_seen_at_the_trigger() {
    let pair = window(20_000, 8_000);
    let mut activity = RuntimeActivity::new(Instant::now());
    complete_turn(&mut activity, pair, &[20_100]);
    complete_turn(&mut activity, pair, &[19_500]);
    assert!(activity.context_refresh_pending);

    // At the trigger, a context that did not shrink was not cut.
    let pair = window(20_000, 8_000);
    let mut activity = RuntimeActivity::new(Instant::now());
    complete_turn(&mut activity, pair, &[20_100]);
    complete_turn(&mut activity, pair, &[20_100]);
    assert!(!activity.context_refresh_pending);

    // Below the trigger the same small drop is noise.
    let pair = window(20_000, 8_000);
    let mut activity = RuntimeActivity::new(Instant::now());
    complete_turn(&mut activity, pair, &[18_000]);
    complete_turn(&mut activity, pair, &[17_500]);
    assert!(!activity.context_refresh_pending);
}

#[test]
fn context_refresh_waits_for_candidate_output_tools_and_owed_replies() {
    let now = Instant::now();
    let mut activity = RuntimeActivity::new(now);
    assert!(!activity.can_refresh_context(false, false, false, now));
    activity.context_refresh_pending = true;
    assert!(activity.can_refresh_context(false, false, false, now));
    assert!(!activity.can_refresh_context(true, false, false, now));
    assert!(!activity.can_refresh_context(false, true, false, now));
    assert!(!activity.can_refresh_context(false, false, true, now));
    activity.generating = true;
    assert!(!activity.can_refresh_context(false, false, false, now));
    activity.generating = false;
    activity.tool_response_outstanding = true;
    assert!(!activity.can_refresh_context(false, false, false, now));
    activity.tool_response_outstanding = false;
    activity.floor = Floor::Speaking;
    assert!(!activity.can_refresh_context(false, false, false, now));
    activity.floor = Floor::Listening;
    activity.awaiting_reply_since = Some(now);
    assert!(!activity.can_refresh_context(false, false, false, now));
    activity.awaiting_reply_since = None;
    activity.owe_prompt(now, None);
    assert!(!activity.can_refresh_context(false, false, false, now));
}

/// Speech reaches Gemini before its transcript reaches the room, so a turn
/// the transcript has not opened yet can already be under way. The microphone
/// is what says so.
#[test]
fn context_refresh_waits_for_the_microphone_to_go_quiet() {
    let now = Instant::now();
    let mut activity = RuntimeActivity::new(Instant::now());
    activity.context_refresh_pending = true;
    activity.candidate_voice_at = Some(now);
    assert!(!activity.can_refresh_context(false, false, false, now));
    assert!(!activity.can_refresh_context(
        false,
        false,
        false,
        now + CHECKPOINT_VOICE_QUIET - Duration::from_millis(1)
    ));
    assert!(activity.can_refresh_context(false, false, false, now + CHECKPOINT_VOICE_QUIET));
}

#[test]
fn context_refresh_is_opt_in_and_tracks_small_configured_windows() {
    let pair = None;
    let mut activity = RuntimeActivity::new(Instant::now());
    complete_turn(&mut activity, pair, &[20_000]);
    complete_turn(&mut activity, pair, &[8_000]);
    assert_eq!(activity.peak_prompt_tokens, 0);
    assert!(!activity.context_refresh_pending);
    let pair = window(9_000, 8_000);
    let mut activity = RuntimeActivity::new(Instant::now());
    complete_turn(&mut activity, pair, &[8_900]);
    complete_turn(&mut activity, pair, &[8_300]);
    assert!(activity.context_refresh_pending);
}

/// A turn's usage may arrive on a frame of its own, before the one that
/// completes it. The drop is judged at completion, against the largest count
/// seen since the last one.
#[test]
fn usage_on_a_separate_frame_is_judged_at_completion() {
    let pair = window(30_000, 8_000);
    let mut activity = RuntimeActivity::new(Instant::now());
    complete_turn(&mut activity, pair, &[20_000]);
    activity.observe_prompt_tokens(pair, 8_000);
    assert!(!activity.context_refresh_pending);
    activity.observe_turn_complete(pair);
    assert!(activity.context_refresh_pending);

    // A periodic count higher than the completed one is the reference.
    let pair = window(30_000, 8_000);
    let mut activity = RuntimeActivity::new(Instant::now());
    complete_turn(&mut activity, pair, &[5_000]);
    complete_turn(&mut activity, pair, &[21_000, 9_000]);
    assert!(activity.context_refresh_pending);
}

#[test]
fn a_cold_replacement_forgets_the_old_context() {
    let pair = window(20_000, 8_000);
    let mut activity = RuntimeActivity::new(Instant::now());
    complete_turn(&mut activity, pair, &[19_000]);
    activity.context_refresh_pending = true;
    activity.reset_context_observations(false);
    assert!(!activity.context_refresh_pending);
    complete_turn(&mut activity, pair, &[6_000]);
    assert!(!activity.context_refresh_pending);
}

/// A resumed socket still holds the provider's context, so a cut in its first
/// turn is measured against the turn before the replacement.
#[test]
fn a_resumed_replacement_keeps_the_baseline() {
    let pair = window(30_000, 8_000);
    let mut activity = RuntimeActivity::new(Instant::now());
    complete_turn(&mut activity, pair, &[19_000]);
    activity.observe_prompt_tokens(pair, 19_500);
    activity.context_refresh_pending = true;
    activity.reset_context_observations(true);
    assert!(!activity.context_refresh_pending);
    assert_eq!(activity.latest_prompt_tokens, None);
    complete_turn(&mut activity, pair, &[6_000]);
    assert!(activity.context_refresh_pending);
}

#[test]
fn usage_is_summed_numbered_and_labelled_by_what_asked_for_it() {
    let mut activity = RuntimeActivity::new(Instant::now());
    activity.live_session_id = 1_700_000_000;
    activity.live_socket = 2;
    let pair = window(30_000, 8_000);
    let observation = |prompt| crate::gemini::TokenUsage {
        prompt,
        response: 5,
        samples: 1,
        ..Default::default()
    };
    let first = activity.account_live_usage("room-a", "01:02.003", None, pair, observation(100));
    assert!(
        first.starts_with(
            "codetrial live_turn_usage room=room-a session=1700000000 at=01:02.003 socket=2 usage_event=1 cause=candidate prompt_tokens=100 response_tokens=5"
        ),
        "{first}"
    );
    let second =
        activity.account_live_usage("room-a", "01:05.000", Some("watch"), pair, observation(250));
    assert!(
        second.contains(" usage_event=2 cause=watch prompt_tokens=250"),
        "{second}"
    );
    assert_eq!(activity.live_usage.prompt, 350);
    assert_eq!(activity.live_usage.response, 10);
    assert_eq!(activity.live_usage.samples, 2);
    // The compression watch saw both.
    assert_eq!(activity.peak_prompt_tokens, 250);
    assert_eq!(activity.latest_prompt_tokens, Some(250));
}

#[test]
fn an_interview_names_its_session_from_the_start() {
    let activity = RuntimeActivity::for_interview(Instant::now(), 3, 1_700_000_000_123);
    assert_eq!(activity.live_session_id, 1_700_000_000_123);
    assert_eq!(activity.max_interim_reviews, 3);
}

/// An interview that has ended, or asked to, owes the model no checkpoint,
/// whatever else would let one go out.
#[test]
fn a_checkpoint_is_due_only_while_the_interview_runs() {
    let now = Instant::now();
    let mut activity = RuntimeActivity::new(now);
    activity.context_refresh_pending = true;
    let running = RuntimeState::default();
    assert!(activity.checkpoint_due(&running, false, false, now));
    for state in [
        RuntimeState {
            ended: true,
            ..RuntimeState::default()
        },
        RuntimeState {
            end_requested: true,
            ..RuntimeState::default()
        },
        RuntimeState {
            paused: true,
            ..RuntimeState::default()
        },
    ] {
        assert!(!activity.checkpoint_due(&state, false, false, now));
    }
    assert!(!activity.checkpoint_due(&running, true, false, now));
    assert!(!activity.checkpoint_due(&running, false, true, now));
}
