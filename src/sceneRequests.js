export function sceneQuestions(scene = {}) {
  return Array.isArray(scene.source_payload?.questions) ? scene.source_payload.questions : [];
}
export function sceneAdminRequests(scene = {}) {
  const special = scene.source_payload?.specialRequest || scene.source_payload?.options?.specialRequest || scene.options?.specialRequest;
  const rows = (typeof special === 'string' ? special.trim() : special?.text?.trim()) ? [scene] : [];
  return [...rows, ...sceneQuestions(scene).map((question) => ({ ...scene, requestQuestionId: question.id }))];
}
export function questionAsRequest(question = {}) {
  return {
    ...question,
    text: [question.subject, question.message].filter(Boolean).join('\n\n'),
    tags: [question.category, question.urgency].filter(Boolean),
    status: question.status || 'pending',
    updatedAt: question.createdAt || '',
    resolvedAt: question.resolvedAt || '',
  };
}
