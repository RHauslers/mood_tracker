/* Cloud sync via GitHub Gist API.
   Requires a GitHub Personal Access Token with 'gist' scope.
   Token + Gist ID stored in localStorage only. */

const Sync = (() => {
  const USERKEY  = "mood_sync_username";
  const TOKENKEY = "mood_sync_token";
  const GISTKEY  = "mood_sync_gist_id";
  const LASTKEY  = "mood_sync_last";
  function filename(username) { return "mood_" + username.toLowerCase().trim().replace(/[^a-z0-9]/g, "_") + ".json"; }
  const API      = "https://api.github.com";

  function getUsername()  { return localStorage.getItem(USERKEY)  || ""; }
  function getToken()     { return localStorage.getItem(TOKENKEY) || ""; }
  function getGistId(u)   { return localStorage.getItem(GISTKEY + "_" + u.toLowerCase().trim()) || ""; }
  function saveUsername(u){ localStorage.setItem(USERKEY,  u.trim()); }
  function saveToken(t)   { localStorage.setItem(TOKENKEY, t.trim()); }
  function saveGistId(u, id) { localStorage.setItem(GISTKEY + "_" + u.toLowerCase().trim(), id); }
  function getLastSync()  { return localStorage.getItem(LASTKEY)  || null; }
  function setLastSync(a) { localStorage.setItem(LASTKEY, a + " at " + new Date().toLocaleTimeString()); }

  function headers(token) {
    return {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json"
    };
  }

  // Merge: deduplicate by date, keep most recent ts
  function mergeEntries(local, remote) {
    const map = new Map();
    for (const e of [...local, ...remote]) {
      const existing = map.get(e.date);
      if (!existing || (e.ts || 0) > (existing.ts || 0)) map.set(e.date, e);
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  // Find existing mood gist or create one; returns gist ID
  async function getOrCreateGist(token, username) {
    const fn = filename(username);
    const stored = getGistId(username);
    if (stored) return stored;

    // Search existing gists for one with our username-specific filename
    const listRes = await fetch(`${API}/gists`, { headers: headers(token) });
    if (!listRes.ok) throw new Error("Token invalid or no gist access (" + listRes.status + ")");
    const gists = await listRes.json();
    const existing = gists.find((g) => g.files && g.files[fn]);
    if (existing) { saveGistId(username, existing.id); return existing.id; }

    // Create a new private gist
    const createRes = await fetch(`${API}/gists`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        description: "Mood & Weather data for " + username,
        public: false,
        files: { [fn]: { content: JSON.stringify([]) } }
      })
    });
    if (!createRes.ok) throw new Error("Could not create gist (" + createRes.status + ")");
    const created = await createRes.json();
    saveGistId(username, created.id);
    return created.id;
  }

  // Push: overwrite gist with local entries
  async function push(token, username, entries) {
    const fn = filename(username);
    const gistId = await getOrCreateGist(token, username);
    const res = await fetch(`${API}/gists/${gistId}`, {
      method: "PATCH",
      headers: headers(token),
      body: JSON.stringify({ files: { [fn]: { content: JSON.stringify(entries) } } })
    });
    if (!res.ok) throw new Error("Push failed (" + res.status + ")");
    setLastSync("Pushed");
  }

  // Pull: download gist entries and merge into local
  async function pull(token, username, localEntries) {
    const fn = filename(username);
    const gistId = await getOrCreateGist(token, username);
    const res = await fetch(`${API}/gists/${gistId}`, { headers: headers(token) });
    if (!res.ok) throw new Error("Pull failed (" + res.status + ")");
    const gist = await res.json();
    const raw = gist.files?.[fn]?.content || "[]";
    let remote;
    try { remote = JSON.parse(raw); } catch { remote = []; }
    if (!Array.isArray(remote)) remote = [];
    const merged = mergeEntries(localEntries, remote);
    setLastSync("Pulled");
    return merged;
  }

  return { getUsername, getToken, getGistId, saveUsername, saveToken, saveGistId, getLastSync, push, pull };
})();
