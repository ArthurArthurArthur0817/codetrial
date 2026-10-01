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
    { problemId: "a", at: 10, report: { decision: "NO_HIRE" } },
    { problemId: "b", at: 30, report: { decision: "HIRE" } },
    { problemId: "a", at: 20, report: { decision: "NO_HIRE" } },
    { problemId: "c", at: 40, report: { decision: "HIRE" } },
  ];

  assert.deepEqual(recentPerformance(problems, reports, 3), {
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
    recentPerformance(problems, [
      { problemId: "a", at: null, report: { decision: "NO_HIRE" } },
      { problemId: "b", at: 20, report: { decision: "PENDING" } },
    ]),
    null,
  );
});

test("topics with more misses than passes are highlighted", () => {
  const snapshot = recentPerformance(problems, [
    { problemId: "a", at: 30, report: { decision: "NO_HIRE" } },
    { problemId: "a", at: 20, report: { decision: "NO_HIRE" } },
    { problemId: "b", at: 10, report: { decision: "HIRE" } },
  ]);

  assert.deepEqual(snapshot.weakTopics, ["Hash Table", "Array"]);
});
