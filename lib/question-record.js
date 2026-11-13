'use strict';

// Keep the user's answer in history, without retaining option lists or upload paths.
const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
function clean(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const requestId = String(record.requestId ?? '').slice(0, 256);
  if (!requestId) return null;
  const answers = (Array.isArray(record.answers) ? record.answers : []).slice(0, 32).map(row => ({
    header: text(row?.header, 200),
    question: text(row?.question, 2000),
    answer: text(row?.answer, 20000),
  }));
  const attachments = (Array.isArray(record.attachments) ? record.attachments : [])
    .filter(name => typeof name === 'string').slice(0, 8).map(name => name.slice(0, 120));
  return { requestId, answers, attachments };
}
function fromReply(card, reply) {
  if (!card?.question || reply?.action && reply.action !== 'allow') return null;
  const questions = (Array.isArray(card.questions) ? card.questions
    : Array.isArray(card.input?.questions) ? card.input.questions : [])
    .filter(q => q && typeof q === 'object' && !Array.isArray(q));
  const answers = questions.length ? questions.slice(0, 32).map((q, index) => {
    const selection = reply.selections?.[q.question] ?? reply.selections?.[q.id]
      ?? (index === 0 ? reply.freeText : '');
    return {
      header: q.header, question: q.question,
      answer: Array.isArray(selection) ? selection.filter(v => typeof v === 'string').join('、') : selection,
    };
  }) : (reply.freeText ? [{ question: '回复', answer: reply.freeText }] : []);
  return clean({ requestId: card.pid, answers, attachments: reply.attachments });
}
module.exports = { clean, fromReply };
