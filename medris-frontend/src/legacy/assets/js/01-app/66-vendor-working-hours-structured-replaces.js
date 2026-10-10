// ---------- VENDOR WORKING HOURS (structured, replaces free-text opening_hours) ----------
const HOURS_DAYS = [
  { key: "mon", label: "Mon" }, { key: "tue", label: "Tue" }, { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" }, { key: "fri", label: "Fri" }, { key: "sat", label: "Sat" }, { key: "sun", label: "Sun" },
];
const HOURS_DAY_FULL_LABEL = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
function formatTime12(hhmm) {
  const [h, m] = (hhmm || "00:00").split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}
function hoursDayRowHtml(key, label, day) {
  const isOpen = !!(day && !day.closed);
  const open = day?.open || "09:00";
  const close = day?.close || "18:00";
  return `<div class="hours-day-row" data-day="${key}">
    <label class="hours-day-check"><input type="checkbox" class="hours-day-toggle" ${isOpen ? "checked" : ""} onchange="onHoursDayToggle(this)" /> ${label}</label>
    <div class="hours-day-times" style="${isOpen ? "" : "display:none;"}">
      <input type="time" class="hours-day-from" value="${esc(open)}" />
      <span class="muted">to</span>
      <input type="time" class="hours-day-to" value="${esc(close)}" />
    </div>
    <span class="hours-day-closed-label" style="${isOpen ? "display:none;" : ""}">Closed</span>
  </div>`;
}
function onHoursDayToggle(checkbox) {
  const row = checkbox.closest(".hours-day-row");
  const isOpen = checkbox.checked;
  row.querySelector(".hours-day-times").style.display = isOpen ? "" : "none";
  row.querySelector(".hours-day-closed-label").style.display = isOpen ? "none" : "";
}
function copyMondayHoursToAll() {
  const monRow = document.querySelector('.hours-day-row[data-day="mon"]');
  if (!monRow) return;
  const monOpen = monRow.querySelector(".hours-day-toggle").checked;
  const monFrom = monRow.querySelector(".hours-day-from").value;
  const monTo = monRow.querySelector(".hours-day-to").value;
  document.querySelectorAll(".hours-day-row").forEach((row) => {
    if (row.dataset.day === "mon") return;
    row.querySelector(".hours-day-toggle").checked = monOpen;
    row.querySelector(".hours-day-from").value = monFrom;
    row.querySelector(".hours-day-to").value = monTo;
    onHoursDayToggle(row.querySelector(".hours-day-toggle"));
  });
  showToast("Applied Monday's hours to every day.", "success");
}
function collectBusinessHoursFromForm() {
  const hours = {};
  document.querySelectorAll(".hours-day-row").forEach((row) => {
    const key = row.dataset.day;
    const isOpen = row.querySelector(".hours-day-toggle").checked;
    hours[key] = isOpen
      ? { closed: false, open: row.querySelector(".hours-day-from").value || "09:00", close: row.querySelector(".hours-day-to").value || "18:00" }
      : { closed: true };
  });
  return hours;
}
// Groups consecutive days sharing identical hours into one line (e.g. "Mon - Fri
// 8:00 AM - 9:00 PM") for the storefront/order-detail text summary, instead of
// listing all seven days out -- this is what keeps opening_hours readable.
function summarizeBusinessHours(hours) {
  if (!hours) return "";
  const segs = HOURS_DAYS.map(({ key, label }) => {
    const d = hours[key];
    return { label, text: d && !d.closed ? `${formatTime12(d.open)} - ${formatTime12(d.close)}` : "Closed" };
  });
  const groups = [];
  segs.forEach((seg) => {
    const last = groups[groups.length - 1];
    if (last && last.text === seg.text) last.labels.push(seg.label);
    else groups.push({ text: seg.text, labels: [seg.label] });
  });
  return groups.map((g) => `${g.labels.length > 1 ? `${g.labels[0]} - ${g.labels[g.labels.length - 1]}` : g.labels[0]} ${g.text}`).join(", ");
}
function nowInLagos() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Lagos", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const map = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  const weekdayMap = { Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun" };
  return { dayKey: weekdayMap[map.weekday], hhmm: `${map.hour === "24" ? "00" : map.hour}:${map.minute}` };
}
// No hours configured at all = treated as always reachable (a vendor who
// hasn't set this up yet shouldn't suddenly become unmessageable).
function vendorHoursStatus(v) {
  const hours = v?.business_hours;
  const { dayKey, hhmm } = nowInLagos();
  const todayLabel = HOURS_DAY_FULL_LABEL[dayKey];
  if (!hours) return { configured: false, isOpen: true, todayLabel, todayText: null };
  const today = hours[dayKey];
  if (!today || today.closed || !today.open || !today.close) {
    return { configured: true, isOpen: false, todayLabel, todayText: "Closed today" };
  }
  const isOpen = hhmm >= today.open && hhmm <= today.close;
  return { configured: true, isOpen, todayLabel, todayText: `${formatTime12(today.open)} - ${formatTime12(today.close)}` };
}
function canMessageVendorNow(v) {
  if (v?.allow_after_hours_messages !== false) return true;
  const status = vendorHoursStatus(v);
  if (!status.configured) return true;
  return status.isOpen;
}

