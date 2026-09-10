type QuestionIdentity = { id: string; slug: string };

/** IDs and slugs are aliases in the pricing answer map, so they share one namespace. */
export function ambiguousQuestionAnswerKeys(questions: readonly QuestionIdentity[]): string[] {
  const owners = new Map<string, number>(), collisions = new Set<string>();
  questions.forEach((question, index) => {
    for (const key of new Set([question.id, question.slug])) {
      if (owners.has(key) && owners.get(key) !== index) collisions.add(key);
      else owners.set(key, index);
    }
  });
  return [...collisions].sort();
}
