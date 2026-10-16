/** Removes every [tag] marker (delivery tags like [hype] and stray ones like [NEWS]) so they never reach the screen or the voice. */
export function stripTags(t: string): string {
  return t.replace(/\[\s*[A-Za-z][A-Za-z _-]{0,20}\s*\]/g, " ").replace(/\s{2,}/g, " ").replace(/\s+([,.!?;:])/g, "$1").trim();
}

