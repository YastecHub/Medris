from pathlib import Path
import re

p = Path("index.html")
s = p.read_text(encoding="utf-8")

button_replacements = [
    (
        '${v.verification_status !== "verified" ? `<button type="button" class="btn btn-sm vendor-admin-action" data-vendor-id="${esc(v.id)}" data-status="verified" data-filter-status="${esc(status)}">Approve</button>` : ""}',
        '${v.verification_status !== "verified" ? `<button type="button" class="btn btn-sm vendor-admin-action" data-vendor-id="${esc(v.id)}" data-status="verified" data-filter-status="${esc(status)}" onclick="return window.__levroAdminVendorAction(this,event);">Approve</button>` : ""}'
    ),
    (
        '${v.verification_status !== "rejected" ? `<button type="button" class="btn btn-sm btn-danger vendor-admin-action" data-vendor-id="${esc(v.id)}" data-status="rejected" data-filter-status="${esc(status)}">Reject</button>` : ""}',
        '${v.verification_status !== "rejected" ? `<button type="button" class="btn btn-sm btn-danger vendor-admin-action" data-vendor-id="${esc(v.id)}" data-status="rejected" data-filter-status="${esc(status)}" onclick="return window.__levroAdminVendorAction(this,event);">Reject</button>` : ""}'
    ),
    (
        '${profile?.email === SUPER_ADMIN_EMAIL ? `<button type="button" class="btn btn-sm btn-danger vendor-admin-action" style="background:#7f1d1d;" data-vendor-id="${esc(v.id)}" data-status="delete" data-filter-status="${esc(status)}"><i class="fa-solid fa-trash"></i> Delete vendor</button>` : ""}',
        '${profile?.email === SUPER_ADMIN_EMAIL ? `<button type="button" class="btn btn-sm btn-danger vendor-admin-action" style="background:#7f1d1d;" data-vendor-id="${esc(v.id)}" data-status="delete" data-filter-status="${esc(status)}" onclick="return window.__levroAdminVendorAction(this,event);"><i class="fa-solid fa-trash"></i> Delete vendor</button>` : ""}'
    )
]

for old, new in button_replacements:
    if old in s:
        s = s.replace(old, new, 1)

old_listener = '''window.setVendorStatus = setVendorStatus;
window.adminDeleteVendor = adminDeleteVendor;
// One authoritative admin vendor-action listener. Buttons are rendered dynamically,
// so delegation is used instead of per-render inline handlers.
if (!window.__levroAdminActionListenerInstalled) {
  window.__levroAdminActionListenerInstalled = true;
  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.("#adminPanel .vendor-admin-action");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const id = button.dataset.vendorId;
    const status = button.dataset.status;
    const filter = button.dataset.filterStatus || "pending";
    if (!id || !status) return;
    if (status === "delete") {
      adminDeleteVendor(id, filter).catch((err) => {
        console.error("[Levromart] Admin delete vendor handler failed:", err);
        showToast(err?.message || "Could not delete this vendor.", "error");
      });
    } else {
      setVendorStatus(id, status, filter).catch((err) => {
        console.error("[Levromart] Admin vendor status handler failed:", err);
        showToast(err?.message || "Could not update this vendor.", "error");
      });
    }
  });
}'''

new_listener = '''window.setVendorStatus = setVendorStatus;
window.adminDeleteVendor = adminDeleteVendor;

window.__levroAdminVendorAction = async function(button, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (!button || button.dataset.busy === "1") return false;
  const id = button.dataset.vendorId;
  const status = button.dataset.status;
  const filter = button.dataset.filterStatus || "pending";
  if (!id || !status) return false;

  button.dataset.busy = "1";
  button.dataset.directHandled = "1";
  const originalText = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Working…';

  try {
    if (status === "delete") await adminDeleteVendor(id, filter);
    else await setVendorStatus(id, status, filter);
  } catch (err) {
    console.error("[Levromart] Admin vendor action failed:", err);
    showToast(err?.message || "Could not perform this vendor action.", "error");
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.innerHTML = originalText;
    }
    delete button.dataset.busy;
    delete button.dataset.directHandled;
  }
  return false;
};

if (!window.__levroAdminActionListenerInstalled) {
  window.__levroAdminActionListenerInstalled = true;
  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.("#adminPanel .vendor-admin-action");
    if (!button || button.dataset.directHandled === "1") return;
    event.preventDefault();
    event.stopPropagation();
    window.__levroAdminVendorAction(button, event);
  });
}'''

if old_listener in s:
    s = s.replace(old_listener, new_listener, 1)
elif "window.__levroAdminVendorAction = async function" not in s:
    raise SystemExit("Existing admin vendor listener was not found; refusing to make an unsafe blind edit")

css = '''<style id="levromart-admin-vendor-action-touch-fix">
#adminPanel .vendor-admin-action{pointer-events:auto!important;touch-action:manipulation!important;position:relative;z-index:2;}
#adminPanel .vendor-admin-action:disabled{opacity:.72;cursor:wait;}
</style>
'''
if 'id="levromart-admin-vendor-action-touch-fix"' not in s:
    s = s.replace('</head>', css + '</head>', 1)

s = re.sub(r'\n?<script id="levromart-admin-action-delegation-fix">.*?</script>\s*', '\n', s, flags=re.S)
p.write_text(s, encoding="utf-8")

if s.count('onclick="return window.__levroAdminVendorAction(this,event);"') < 3:
    raise SystemExit("Admin buttons were not patched correctly")
if 'window.__levroAdminVendorAction = async function' not in s:
    raise SystemExit("Admin action dispatcher missing after patch")
print("Admin vendor actions patched successfully")
