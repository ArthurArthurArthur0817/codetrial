//! The byte arithmetic behind compression checkpoints, pinned exactly: a cut
//! that is off by a byte either overruns the budget the checkpoint promises or
//! numbers a line the candidate did not write there.

use super::*;

/// The body of the first `BEGIN UNTRUSTED {open}` ... `END UNTRUSTED {close}`
/// block in `text`.
fn fenced<'a>(text: &'a str, open: &str, close: &str) -> &'a str {
    text.split(&format!("BEGIN UNTRUSTED {open}\n"))
        .nth(1)
        .unwrap()
        .split(&format!("\nEND UNTRUSTED {close}"))
        .next()
        .unwrap()
}

#[test]
fn an_excerpt_that_fits_is_whole_and_numbered_from_its_first_line() {
    assert_eq!(
        numbered_compression_excerpt("a\nb", 7, 100),
        ("7| a\n8| b".to_string(), true)
    );
    // A line that fills the budget to the byte still fits.
    assert_eq!(
        numbered_compression_excerpt("abcd", 1, 7),
        ("1| abcd".to_string(), true)
    );
}

#[test]
fn a_cut_excerpt_fills_its_budget_to_the_byte() {
    let long = "x".repeat(100);
    let (first, whole) = numbered_compression_excerpt(&long, 1, 40);
    assert!(!whole);
    assert_eq!(first, format!("1| {} ...", "x".repeat(33)));
    assert_eq!(first.len(), 40);

    // The same on a later line, where the separator is spent too.
    let (second, whole) = numbered_compression_excerpt(&format!("short\n{long}"), 1, 40);
    assert!(!whole);
    assert_eq!(second, format!("1| short\n2| {} ...", "x".repeat(24)));
    assert_eq!(second.len(), 40);

    // No room for a line number and the marker: nothing rather than a stub.
    assert_eq!(
        numbered_compression_excerpt(&long, 1, 6),
        (String::new(), false)
    );
    // A line that would fit only without its number is cut, not kept whole.
    assert_eq!(
        numbered_compression_excerpt("abcde", 1, 7),
        ("1|  ...".to_string(), false)
    );
    // Room for exactly those and three characters of the line.
    assert_eq!(
        numbered_compression_excerpt(&long, 1, 10),
        ("1| xxx ...".to_string(), false)
    );
}

/// The ending starts on a line boundary when one fits, and the line number it
/// claims is the line its first text is actually on.
#[test]
fn the_ending_excerpt_names_the_line_it_starts_on() {
    for trailing in ["", "\n"] {
        let code = (1..=300)
            .map(|n| format!("let value_{n:03} = {n};"))
            .collect::<Vec<_>>()
            .join("\n")
            + trailing;
        let text = compression_editor("rust", &code);
        let line = text
            .split("ending starts at line ")
            .nth(1)
            .unwrap()
            .split(',')
            .next()
            .unwrap()
            .parse::<usize>()
            .unwrap();
        let ending = fenced(&text, "EDITOR ENDING SUFFIX (rust)", "EDITOR ENDING SUFFIX");
        assert!(
            ending.starts_with(&format!("{line}| let value_{line:03} = {line};")),
            "{ending}"
        );
        assert!(ending.ends_with("300| let value_300 = 300;"), "{ending}");
        assert!(ending.len() <= COMPRESSION_EDITOR_BYTES / 2);
        // As many whole lines as fit: one more would not.
        let previous = format!("{}| let value_{:03} = {};\n", line - 1, line - 1, line - 1);
        assert!(previous.len() + ending.len() > COMPRESSION_EDITOR_BYTES / 2);
    }
}

/// Lines that fill the ending's budget to the byte are all kept, and the
/// separators between them are counted: seventeen numbered lines of 52 bytes
/// and their sixteen newlines are exactly 900.
#[test]
fn an_ending_that_fills_its_budget_exactly_keeps_every_line() {
    let code = (1..=300)
        .map(|n| format!("{n:0>47}"))
        .collect::<Vec<_>>()
        .join("\n");
    let (ending, line) = numbered_ending(&code, COMPRESSION_EDITOR_BYTES / 2);
    assert_eq!(ending.len(), COMPRESSION_EDITOR_BYTES / 2);
    assert_eq!(line, 284);
    assert!(ending.starts_with(&format!("284| {:0>47}", 284)));
}

/// A line is measured with its own number, which is one byte longer at line
/// 100 than at line 99: here the last line fits and the one before it does not.
#[test]
fn an_ending_is_measured_with_each_lines_own_number() {
    let code = vec!["x"; 100].join("\n");
    assert_eq!(numbered_ending(&code, 11), ("100| x".to_string(), 100));
    assert_eq!(
        numbered_ending(&code, 12),
        ("99| x\n100| x".to_string(), 99)
    );
}

/// A final line longer than the ending's budget is cut from its start, and
/// still named as the line it is, with or without a newline after it.
#[test]
fn a_long_final_line_is_cut_from_its_start() {
    for trailing in ["", "\n"] {
        let code = format!("fn head() {{}}\n{}{trailing}", "x".repeat(2_000));
        let text = compression_editor("rust", &code);
        assert!(text.contains("ending starts at line 2, possibly partway through it"));
        let ending = fenced(&text, "EDITOR ENDING SUFFIX (rust)", "EDITOR ENDING SUFFIX");
        assert_eq!(
            ending,
            format!("2| {}", "x".repeat(COMPRESSION_EDITOR_BYTES / 2 - 3)),
            "{trailing:?}"
        );
    }
}

/// The test report is cut only past its budget; one that fills it exactly is
/// whole and says nothing was left out.
#[test]
fn a_report_that_fills_its_budget_is_not_cut() {
    let report_of = |length: usize| {
        let state = RuntimeState {
            last_test_run: Some(serde_json::json!({ "setupError": "e".repeat(length) })),
            ..RuntimeState::default()
        };
        format_test_run(state.last_test_run.as_ref(), state.test_runs).len()
    };

    // An empty error renders differently, so the fixed part is measured on a
    // non-empty one.
    let base = report_of(10) - 10;
    let exact = COMPRESSION_TEST_REPORT_BYTES - base;
    assert_eq!(report_of(exact), COMPRESSION_TEST_REPORT_BYTES);
    let checkpoint = |length: usize| {
        compressed_editor_and_test_report(&RuntimeState {
            last_test_run: Some(serde_json::json!({ "setupError": "e".repeat(length) })),
            ..RuntimeState::default()
        })
    };
    assert!(!checkpoint(exact).contains("Remaining test details were omitted"));
    assert!(checkpoint(exact + 1).contains("Remaining test details were omitted"));
}

/// An opening cut inside a multi-byte character stops there; it does not go on
/// to start the next line with nothing in it.
#[test]
fn a_cut_behavioral_opening_ends_where_it_was_cut() {
    let lines = vec![
        // 35 bytes, so the three-byte characters below cannot fill the rest of
        // the budget exactly and the cut lands one byte short of it.
        "Interviewer: Tell me about one bug.".to_string(),
        format!("Candidate: {}", "\u{2603}".repeat(400)),
        "Candidate: and then it passed.".to_string(),
        format!("Candidate: {}", "y".repeat(3_000)),
    ];
    let text = compressed_split_transcript(&lines, 0);
    let opening = fenced(
        &text,
        "BEHAVIORAL ROUND OPENING PREFIX",
        "BEHAVIORAL ROUND OPENING PREFIX",
    );

    // 35 bytes, the newline, then the cut: 714 bytes are left for the second
    // line, and its last whole character ends at 713.
    assert_eq!(opening.len(), COMPRESSION_OPENING_BYTES - 1);
    assert!(!opening.ends_with('\n'), "{opening:?}");
    assert!(!opening.contains("and then it passed"));
}
