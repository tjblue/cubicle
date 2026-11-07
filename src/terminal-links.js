export function findFileLinks(text) {
  const pattern = /file:\/\/[^\s<>"'`|]+|(?:[A-Za-z]:[\\/]|\.\.?[\\/]|\/)(?:[^\s<>"'`|]+[\\/])*[^\s<>"'`|]+|\b[\w.-]+(?:[\\/][\w. -]+)*\.[A-Za-z0-9]{1,12}(?::\d+(?::\d+)?)?/g;
  const links = [];
  for (const match of text.matchAll(pattern)) {
    const value = match[0].replace(/[),;]+$/, '');
    if (!value || /https?:\/\/[^\s]*$/i.test(text.slice(0, match.index + value.length))) continue;
    links.push({ value, index: match.index });
  }
  return links;
}
