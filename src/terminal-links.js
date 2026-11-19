const filePath = /^(?:file:\/\/|[a-z]:[\\/]|\\\\|\.{1,2}[\\/]|\/)|(?:^|[\\/])[^\\/]+\.[a-z0-9]{1,12}(?::\d+(?::\d+)?)?$/i;
const absoluteStart = String.raw`(?:[A-Za-z]:[\\/]|\\\\|\.{1,2}[\\/]|\/)`;
const location = String.raw`(?::\d+(?::\d+)?)?`;
const fileEnd = String.raw`\.[A-Za-z0-9]{1,12}(?=:\d|[\s),;\]}]|$)${location}`;
// Prefer an extension/location boundary to trailing stack-trace or diagnostic
// text. The fallback still recognizes extensionless files such as /etc/hosts.
const spacedAbsolute = String.raw`${absoluteStart}[^\r\n\t<>"'\x60|:]*?${fileEnd}`;
const absolute = String.raw`${absoluteStart}(?:[^\r\n\t<>"'\x60|:\\/]+[\\/])*[^\s<>"'\x60|:\\/]+${location}`;
const relative = String.raw`\b[\w.-]+(?:[\\/][\w. -]+?)*?${fileEnd}`;
const patternSource = String.raw`(?<url>[a-z][a-z\d+.-]*:\/\/[^\s<>"'\x60|]+)|(?<quote>["'\x60])(?<quoted>[^\r\n]*?)\k<quote>|${spacedAbsolute}|${absolute}|${relative}`;

export function findFileLinks(text) {
  const pattern = new RegExp(patternSource, 'gi');
  const links = [];
  for (const match of text.matchAll(pattern)) {
    if (match.groups.url && !/^file:\/\//i.test(match.groups.url)) continue;
    const quoted = match.groups.quoted;
    if (quoted !== undefined && (!filePath.test(quoted) || /^[a-z][a-z\d+.-]*:\/\//i.test(quoted) && !/^file:\/\//i.test(quoted))) continue;
    const value = quoted ?? match[0].replace(/[),;]+$/, '');
    if (!value) continue;
    links.push({ value, index: match.index + (quoted !== undefined ? 1 : 0) });
  }
  return links;
}
