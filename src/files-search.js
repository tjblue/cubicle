// Search folder names without following the same canonical directory twice.
export async function searchFileTree(root, query, list, isCurrent = () => true, limit = 5000) {
  const pending = [root], visited = new Set(), results = [];
  let scanned = 0, skipped = 0, truncated = false;
  const needle = query.toLocaleLowerCase();
  while (pending.length && isCurrent()) {
    const batch = pending.splice(0, 4);
    const listings = await Promise.all(batch.map(async path => { try { return await list(path); } catch { skipped++; return null; } }));
    for (const listing of listings) {
      if (!isCurrent()) return { results: [], cancelled: true };
      if (!listing) continue;
      const normalized = listing.path.replace(/\\/g, '/');
      const canonical = /^(?:[a-z]:|\/\/)/i.test(normalized) ? normalized.toLocaleLowerCase() : normalized;
      if (visited.has(canonical)) continue;
      visited.add(canonical);
      for (const entry of listing.entries) {
        if (++scanned > limit) { truncated = true; break; }
        if (!entry.directory && entry.name.toLocaleLowerCase().includes(needle)) results.push(entry);
        if (entry.directory) pending.push(entry.path);
      }
      if (truncated) break;
    }
    if (truncated) break;
  }
  results.sort((a, b) => a.path.localeCompare(b.path));
  return { results, skipped, truncated, cancelled: !isCurrent() };
}
