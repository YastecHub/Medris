// ---------- ADMIN: one-time R2 migration ----------
// Walks every file already sitting in the four public Supabase Storage
// buckets and copies each one over to R2 via /api/vendor-payments' r2-migrate-file
// action. Does not
// touch the database or delete anything from Supabase -- rewriting
// products/vendors/users rows to point at the new R2 URLs is a deliberately
// separate step, run once every file has actually landed.
async function listAllStorageFiles(bucket, prefix = "", depth = 0) {
  if (depth > 6) return [];
  const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (error || !data) return [];
  let files = [];
  for (const entry of data) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) {
      // A folder placeholder entry has no object metadata -- recurse into it.
      files = files.concat(await listAllStorageFiles(bucket, fullPath, depth + 1));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}
async function migrateOneR2File(bucket, key) {
  // Transient network blips (a dropped connection, a slow cold start) are
  // normal at this file count and shouldn't need a human to notice and
  // re-click a button -- retry a few times with a short growing pause
  // before actually giving up on this one file.
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch("/api/vendor-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "r2-migrate-file", accessToken: session.access_token, bucket, key }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return j;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((res) => setTimeout(res, attempt * 600));
    }
  }
  throw lastErr;
}
const R2_MIGRATION_DONE_KEY = "levromart_r2_migrated_keys_v1";
function loadR2MigrationDoneSet() {
  try { return new Set(JSON.parse(localStorage.getItem(R2_MIGRATION_DONE_KEY) || "[]")); }
  catch (e) { return new Set(); }
}
function saveR2MigrationDoneSet(doneSet) {
  try { localStorage.setItem(R2_MIGRATION_DONE_KEY, JSON.stringify([...doneSet])); }
  catch (e) { /* storage full or unavailable -- resuming just re-checks from scratch, not fatal */ }
}
async function runR2Migration() {
  const btn = byId("r2MigrateBtn");
  const log = byId("r2MigrateLog");
  if (!log || !btn) return;
  btn.disabled = true;
  const buckets = ["product-photos", "homepage-carousel", "avatars", "vendor-logos"];
  // Remember every file already confirmed done (migrated or already-there)
  // across runs, so re-clicking "Start migration" after a stop skips
  // straight past everything already handled instead of re-checking each
  // one with the server again.
  const doneSet = loadR2MigrationDoneSet();
  let totalMigrated = 0, totalSkipped = 0, totalFailed = 0, consecutiveFailed = 0, lastError = "";
  let sinceSave = 0;
  const setStatus = (msg) => { log.textContent = msg; };
  try {
    for (const bucket of buckets) {
      setStatus(`Listing files in ${bucket}…`);
      const files = await listAllStorageFiles(bucket);
      for (let i = 0; i < files.length; i++) {
        const doneKey = `${bucket}/${files[i]}`;
        if (doneSet.has(doneKey)) {
          totalSkipped++;
          continue;
        }
        setStatus(`${bucket}: ${i + 1}/${files.length}, migrated ${totalMigrated}, already there ${totalSkipped}, failed ${totalFailed}${lastError ? `\nLast error: ${lastError}` : ""}`);
        try {
          const j = await migrateOneR2File(bucket, files[i]);
          if (j.migrated) totalMigrated++; else totalSkipped++;
          consecutiveFailed = 0;
          doneSet.add(doneKey);
          if (++sinceSave >= 20) { saveR2MigrationDoneSet(doneSet); sinceSave = 0; }
        } catch (e) {
          totalFailed++;
          consecutiveFailed++;
          lastError = `${bucket}/${files[i]}: ${e.message}`;
          console.warn(`[R2 migration] ${bucket}/${files[i]} failed after 3 attempts:`, e.message);
          // One file failing three times in a row is a fluke, worth noting
          // and moving past. Several IN A ROW failing three times each is a
          // real, shared problem again (same shape as the earlier env-var
          // issues) -- stop and surface it rather than grinding through the
          // rest of the list the same way.
          if (consecutiveFailed >= 3) {
            saveR2MigrationDoneSet(doneSet);
            setStatus(`Stopped after ${consecutiveFailed} failures in a row so this is easy to read:\n${lastError}`);
            showToast("Migration stopped, several files in a row failed the same way. Screenshot the log and send it over.", "error");
            return;
          }
        }
      }
      saveR2MigrationDoneSet(doneSet);
    }
    setStatus(`Done. Migrated ${totalMigrated}, already there ${totalSkipped}, failed ${totalFailed}.${lastError ? `\nLast error: ${lastError}` : ""}`);
    showToast("R2 migration finished, see the log on this page for the count.", totalFailed ? "warning" : "success");
  } catch (e) {
    setStatus(`Stopped early: ${e.message}`);
    showToast(`Migration stopped early: ${e.message}`, "error");
  } finally {
    saveR2MigrationDoneSet(doneSet);
    btn.disabled = false;
  }
}
window.runR2Migration = runR2Migration;
function renderAdminR2Migration() {
  if (!session || !isSuperAdmin()) return '<div class="empty-state">Access denied.</div>';
  let html = `<h2><i class="fa-solid fa-cloud-arrow-up"></i> Migrate images to R2</h2>`;
  html += adminNavHtml("adminR2Migration");
  html += `<div class="card" style="max-width:560px;">
    <p class="muted">Copies every existing file in product-photos, homepage-carousel, avatars and vendor-logos over to Cloudflare R2. Doesn't touch the database or delete anything from Supabase, and it's safe to run more than once, anything already copied is skipped, not re-uploaded.</p>
    <button class="btn" id="r2MigrateBtn" onclick="runR2Migration()"><i class="fa-solid fa-play"></i> Start migration</button>
    <p id="r2MigrateLog" class="muted" style="margin-top:.8rem;white-space:pre-wrap;font-size:.85rem;"></p>
  </div>`;
  return html;
}

