import { test } from "node:test";
import assert from "node:assert/strict";

import {
  availableTopics,
  filterProblems,
  recentPerformance,
} from "../../web/practice-insights.js";

const problems = [
  { id: "a", difficulty: "Easy", topics: ["Array", "Hash Table"] },
  { id: "b", difficulty: "Medium", topics: ["Array", "Sorting"] },
  { id: "c", difficulty: "Hard", topics: ["Graph"] },
];

const report = (problemId, at, decision) => ({
  problemId,
  at,
  report: {
    decision,
    topics: problems.find((problem) => problem.id === problemId)?.topics ?? [],
  },
});

test("topics are unique and sorted", () => {
  assert.deepEqual(availableTopics(problems), [
    "Array",
    "Graph",
    "Hash Table",
    "Sorting",
  ]);
});

test("difficulty and topic filters combine", () => {
  assert.deepEqual(
    filterProblems(problems, {
      difficulties: new Set(["Medium", "Hard"]),
      topic: "Array",
    }).map((problem) => problem.id),
    ["b"],
  );
});

test("recent performance summarizes assessed reports newest first", () => {
  const reports = [
    report("a", 10, "NO_HIRE"),
    report("b", 30, "HIRE"),
    report("a", 20, "NO_HIRE"),
    report("c", 40, "HIRE"),
  ];

  assert.deepEqual(recentPerformance(reports, 3), {
    attempts: 3,
    passes: 2,
    misses: 1,
    passRate: 67,
    streak: 2,
    latestDecision: "HIRE",
    weakTopics: ["Hash Table"],
  });
});

test("recent performance ignores unscored and undated entries", () => {
  assert.equal(
    recentPerformance([
      { problemId: "a", at: null, report: { decision: "NO_HIRE" } },
      { problemId: "b", at: 20, report: { decision: "PENDING" } },
    ]),
    null,
  );
});

test("recent performance ignores incomplete reports with a decision", () => {
  assert.equal(
    recentPerformance([
      {
        problemId: "a",
        at: 20,
        report: { incomplete: true, decision: "HIRE", topics: ["Array"] },
      },
    ]),
    null,
  );
});

test("topics with more misses than passes are highlighted", () => {
  const snapshot = recentPerformance([
    report("a", 30, "NO_HIRE"),
    report("a", 20, "NO_HIRE"),
    report("b", 10, "HIRE"),
  ]);

  assert.deepEqual(snapshot.weakTopics, ["Hash Table", "Array"]);
});

test("recent performance ignores malformed report topics", () => {
  const malformed = report("a", 20, "NO_HIRE");
  malformed.report.topics = 5;

  assert.deepEqual(recentPerformance([malformed]).weakTopics, []);
});

test("recent performance counts each normalized topic once per report", () => {
  const first = report("a", 20, "NO_HIRE");
  first.report.topics = ["Array", "Array", 5, "Hash Table"];
  const second = report("b", 10, "NO_HIRE");
  second.report.topics = ["Array"];

  assert.deepEqual(recentPerformance([first, second]).weakTopics, [
    "Array",
    "Hash Table",
  ]);
});
