export function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/\u200B/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeIdentity(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

export function textOf(node: Element | null | undefined): string {
  return normalizeText(node?.textContent ?? '');
}

export function cloneText(node: Element | null | undefined, removals: string[] = []): string {
  if (!node) return '';
  const clone = node.cloneNode(true) as Element;
  removals.forEach((selector) => clone.querySelectorAll(selector).forEach((item) => item.remove()));
  return normalizeText(clone.textContent ?? '');
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
