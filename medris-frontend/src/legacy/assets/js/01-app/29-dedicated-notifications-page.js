// ---------- DEDICATED NOTIFICATIONS PAGE ----------
function renderNotificationsPage() {
  return `<div class="notifications-page-shell"><div class="notifications-page-heading"><button type="button" class="icon-btn notifications-page-back" onclick="navigate(lastNotificationReturnView || 'home', lastNotificationReturnParams || {})" aria-label="Back"><i class="fa-solid fa-arrow-left"></i></button><div class="notifications-page-heading-copy"><h2><i class="fa-solid fa-bell"></i> Notifications</h2><p class="muted">Stay up to date with activity on Levromart.</p></div><div id="notificationsPageHeaderActions" class="notifications-page-heading-actions"></div></div><div id="notificationsPage" class="notifications-page-host" aria-live="polite"></div></div>`;
}

