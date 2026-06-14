/* Cloud sync via jsonstore.io — no account, no API key needed.
   Passphrase is hashed to a UUID-style key used as the store endpoint. */

const Sync = (() => {
  const BASE = "https://www.jsonstore.io";
  const PASSKEY = "mood_sync_passphrase";
  const LASTKEY = "mood_sync_last";

  // Simple non-cryptographic hash → deterministic UUID-style string
  function hashPassphrase(str) {
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
    // produce a stable 36-char key
    return `${u.slice(0,8)}-${v.slice(0,4)}-4${u.slice(5,8)}-${v.slice(4,8)}-${u}${v}`.slice(0, 36);
  }

  function endpoint(passphrase) {
    return `${BASE}/${hashPassphrase(passphrase)}/mood_entries`;
  }

  function getPassphrase() {
    return localStorage.getItem(PASSKEY) || null;
  }

  function savePassphrase(p) {
    localStorage.setItem(PASSKEY, p);
  }

  function clearPassphrase() {
    localStorage.removeItem(PASSKEY);
    localStorage.removeItem(LASTKEY);
  }

  function getLastSync() {
    return localStorage.getItem(LASTKEY) || null;
  }

  function setLastSync() {
    localStorage.setItem(LASTKEY, new Date().toLocaleString());
  }

  // Merge two entry arrays: deduplicate by date, keep most recent ts
  function mergeEntries(local, remote) {
    const map = new Map();
    for (const e of [...local, ...remote]) {
      const existing = map.get(e.date);
      if (!existing || (e.ts || 0) > (existing.ts || 0)) map.set(e.date, e);
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  async function push(passphrase, entries) {
    const res = await fetch(endpoint(passphrase), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entries)
    });
    if (!res.ok) throw new Error("Sync push failed: " + res.status);
    setLastSync();
  }

  async function pull(passphrase) {
    const res = await fetch(endpoint(passphrase));
    if (res.status === 404) return []; // no data yet
    if (!res.ok) throw new Error("Sync pull failed: " + res.status);
    const json = await res.json();
    // jsonstore wraps in { result: [...] }
    const data = json.result;
    if (!Array.isArray(data)) return [];
    return data;
  }

  // Full sync: pull remote, merge with local, push merged back
  async function syncEntries(passphrase, localEntries) {
    const remote = await pull(passphrase);
    const merged = mergeEntries(localEntries, remote);
    await push(passphrase, merged);
    return merged;
  }

  return { getPassphrase, savePassphrase, clearPassphrase, getLastSync, syncEntries, pull };
})();
