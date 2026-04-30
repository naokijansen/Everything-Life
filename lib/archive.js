function archiveState(s, dateKey) {
  const count = s.done.length;
  if (count === 0) return 0;
  if (!s.history[dateKey]) s.history[dateKey] = [];
  s.done.forEach(t => s.history[dateKey].push({ text: t.text, q: t.q }));
  s.done = [];
  return count;
}

module.exports = { archiveState };
