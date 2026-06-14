/* Cloud sync via jsonstore.io — no account, no API key needed.
   Username is hashed to a unique storage key. */

const Sync = (() => {
  const BASE = "https://www.jsonstore.io";
  const USERKEY = "mood_sync_username";
  const LASTKEY = "mood_sync_last";

  // Simple non-cryptographic hash → stable hex string
  function hashUsername(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const u = (h1 >>> 0).toString(16).padStart(8, "0");
    const v = (h2 >>> 0).toString(16).padStart(8, "0");
    return `${u}${v}mood`;
  }

  function endpoint(username) {
    return `${BASE}/${hashUsername(username.toLowerCase().trim())}/mood_entries`;
  }

  function getUsername() {
    return localStorage.getItem(USERKEY) || "";
  }

  function saveUsername(u) {
    localStorage.setItem(USERKEY, u.trim());
  }

  function getLastSync() {
    return localStorage.getItem(LASTKEY) || null;
  }

  function setLastSync(action) {
    localStorage.setItem(LASTKEY, action + " at " + new Date().toLocaleTimeString());
  }

  // Merge two arrays: deduplicate by date, keep most recent ts
  function mergeEntries(local, remote) {
    const map = new Map();
    for (const e of [...local, ...remote]) {
      const existing = map.get(e.date);
      if (!existing || (e.ts || 0) > (existing.ts || 0)) map.set(e.date, e);
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  // Push: upload local entries to cloud (overwrites remote)
  async function push(username, entries) {
    const res = await fetch(endpoint(username), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entries)
    });
    if (!res.ok) throw new Error("Push failed (" + res.status + ")");
    setLastSync("Pushed");
    return entries;
  }

  // Pull: download cloud entries and merge into local (never deletes local data)
  async function pull(username, localEntries) {
    let res;
    try {
      res = await fetch(endpoint(username));
    } catch (e) {
      throw new Error("Network error — are you online?");
    }
    if (res.status === 404) {
      setLastSync("Pulled (no cloud data yet)");
      return localEntries; // nothing on cloud yet, keep local
    }
    if (!res.ok) throw new Error("Pull failed (" + res.status + ")");
    const json = await res.json();
    const remote = Array.isArray(json.result) ? json.result : [];
    const merged = mergeEntries(localEntries, remote);
    setLastSync("Pulled");
    return merged;
  }

  return { getUsername, saveUsername, getLastSync, push, pull, mergeEntries };
})();
