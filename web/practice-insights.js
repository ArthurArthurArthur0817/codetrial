export function availableTopics(problems) {
  return [...new Set(problems.flatMap((problem) => problem.topics ?? []))].sort(
    (left, right) => left.localeCompare(right),
  );
}

export function filterProblems(
  problems,
  { difficulties = new Set(), topic = "" } = {},
) {
  return problems.filter(
    (problem) =>
      (!difficulties.size || difficulties.has(problem.difficulty)) &&
      (!topic || problem.topics.includes(topic)),
  );
}
