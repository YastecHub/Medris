from pathlib import Path
import re

p = Path('index.html')
s = p.read_text(encoding='utf-8')

# Patch every rendered admin vendor action button, regardless of the exact
# surrounding template used by the current index.html.
def add_direct_handler(match):
    tag = match.group(0)
    if 'onclick=' in tag:
        return tag
    return tag[:-1] + ' onclick="return window.__levroAdminVendorAction(this,event);">'

patched_buttons = re.sub(
    r'<button\b(?=[^>]*\bvendor-admin-action\b)[^>]*>',
    add_direct_handler,
    s,
    flags=re.I,
)

if patched_buttons == s:
    print('No unhandled vendor action buttons found; existing handlers may already be patched.')
s = patched_buttons

# Remove obsolete late document-level admin listeners that can compete with the
# authoritative dispatcher. Match by the stable script id used by prior builds.
s = re.sub(
    r'\s*<script\s+id=["\']levromart-admin-action-delegation-fix["\'][^>]*>.*?</script>\s*',
    '\n',
    s,
    flags=re.I | re.S,
)

# Install one robust dispatcher immediately before </body>. This is deliberately
# idempotent and self-contained; it calls the already-authoritative functions.
marker = 'window.__levromartAdminVendorActionHotfixV2'
dispatcher = r'''<script id="levromart-admin-action-dispatcher-v2">
(function(){
  if (window.__levromartAdminVendorActionHotfixV2) return;
  window.__levromartAdminVendorActionHotfixV2 = true;

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

    const originalText = button.innerHTML;
    button.dataset.busy = "1";
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Working...';

    try {
      if (status === "delete") {
        if (typeof window.adminDeleteVendor !== "function") {
          throw new Error("The vendor deletion handler is unavailable. Please reload Levromart.");
        }
        await window.adminDeleteVendor(id, filter);
      } else {
        if (typeof window.setVendorStatus !== "function") {
          throw new Error("The vendor status handler is unavailable. Please reload Levromart.");
        }
        await window.setVendorStatus(id, status, filter);
      }
    } catch (err) {
      console.error("[Levromart] Admin vendor action failed:", err);
      if (typeof window.showToast === "function") {
        window.showToast(err?.message || "Could not perform this vendor action.", "error");
      }
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.innerHTML = originalText;
      }
      delete button.dataset.busy;
    }

    return false;
  };

  // Fallback for any dynamically-created button that does not carry the inline
  // handler. This deliberately runs in bubble phase.
  document.addEventListener("click", function(event) {
    const button = event.target?.closest?.("#adminPanel .vendor-admin-action");
    if (!button || button.getAttribute("data-admin-handler-v2") === "1") return;
    button.setAttribute("data-admin-handler-v2", "1");
    window.__levroAdminVendorAction(button, event);
  }, false);
})();
</script>
'''

if marker not in s:
    body_end = re.search(r'</body>\s*</html>\s*$', s, flags=re.I)
    if body_end:
        insertion = dispatcher + '\n'
        start = body_end.start()
        s = s[:start] + insertion + s[start:]
    else:
        s += '\n' + dispatcher
else:
    print('Dispatcher already present; leaving it in place.')

css = '''<style id="levromart-admin-vendor-action-touch-fix-v2">
#adminPanel .vendor-admin-action{pointer-events:auto!important;touch-action:manipulation!important;position:relative;z-index:2;-webkit-tap-highlight-color:transparent;}
#adminPanel .vendor-admin-action:disabled{opacity:.72;cursor:wait;}
</style>
'''
if 'id="levromart-admin-vendor-action-touch-fix-v2"' not in s:
    s = s.replace('</head>', css + '</head>', 1)

p.write_text(s, encoding='utf-8')

count = len(re.findall(r'onclick="return window\.__levroAdminVendorAction\(this,event\);"', s))
if count < 3:
    raise SystemExit(f'Expected at least 3 direct admin vendor handlers, found {count}')
if marker not in s:
    raise SystemExit('Admin dispatcher was not installed')

print(f'Admin vendor action patch complete: {count} direct handlers')
