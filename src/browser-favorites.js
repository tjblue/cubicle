const key = 'cubicle-browser-favorites';
export function getFavorites() {
  try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value.filter(item => item && typeof item.name === 'string' && typeof item.url === 'string' && /^https?:\/\//i.test(item.url)) : []; } catch { return []; }
}
export function setFavorite(url, name) {
  const favorites = getFavorites();
  if (!favorites.some(item => item.url === url)) favorites.push({ url, name: name || new URL(url).hostname });
  localStorage.setItem(key, JSON.stringify(favorites));
}
export function removeFavorite(url) { localStorage.setItem(key, JSON.stringify(getFavorites().filter(item => item.url !== url))); }
