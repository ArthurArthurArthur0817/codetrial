const fs = require("node:fs");
const path = require("node:path");

const webRoot = path.join(__dirname, "..", "web");
const problemPages = JSON.parse(
  fs.readFileSync(path.join(webRoot, "problem-pages.json"), "utf8"),
);

function judgeCaseCount(problemId) {
  const page = problemPages[problemId]?.page;
  if (!page) throw new Error(`no scenario page for ${problemId}`);
  const fixture = JSON.parse(
    fs.readFileSync(path.join(webRoot, "judges", `${page}.json`), "utf8"),
  );
  if (!Array.isArray(fixture.cases) || !fixture.cases.length)
    throw new Error(`${problemId}: judge has no cases`);
  return fixture.cases.length;
}

function validateJudgeCaseCounts() {
  const problemIds = Object.keys(problemPages);
  if (!problemIds.length) throw new Error("no judge fixtures to check");
  for (const problemId of problemIds) judgeCaseCount(problemId);
  return problemIds.length;
}

function reportCaseCounts(resultText) {
  const result =
    typeof resultText === "string"
      ? /^Test results · (\d+)\/(\d+)$/.exec(resultText)
      : null;
  const passed = Number(result?.[1]);
  const total = Number(result?.[2]);
  if (
    !result ||
    !Number.isSafeInteger(passed) ||
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    passed > total
  )
    throw new Error(`invalid report result ${JSON.stringify(resultText)}`);
  return { passed, total };
}

function validateReportCaseCount(resultText, problemId) {
  const result = reportCaseCounts(resultText);
  const actual = judgeCaseCount(problemId);
  if (result.total !== actual)
    throw new Error(
      `${problemId}: report result ${JSON.stringify(resultText)} does not match ${actual} judge cases`,
    );
  return result;
}

module.exports = {
  problemPages,
  judgeCaseCount,
  validateJudgeCaseCounts,
  reportCaseCounts,
  validateReportCaseCount,
};
