export function extractRecommendedReply(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+推荐回复\s*$/.test(line.trim()));
  if (start < 0) return '';

  const collected: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,2}\s+/.test(lines[index].trim())) break;
    collected.push(lines[index]);
  }

  return collected.join('\n').trim();
}
