// ---------- LONG-PRESS BATCH SELECTION ----------
// One lightweight delegated controller covers both conversation rows and
// notification rows. It deliberately does not use swipe, touchmove animation,
// network calls, or per-row listeners. A long press simply enters/toggles the
// existing batch-selection mode; normal taps continue to use the existing
// handlers once selection mode is active.
(function setupBatchLongPressSelection(){
  if (window.__levroBatchLongPressBound) return;
  window.__levroBatchLongPressBound = true;
  const HOLD_MS = 430;
  const MOVE_CANCEL_PX = 10;
  let state = null;

  function rowFromTarget(target) {
    const row = target?.closest?.('.conv-list-item, #notifPanel .notif-item');
    if (!row) return null;
    // Do not steal presses from actual controls nested in message rows.
    if (target.closest?.('a, input, textarea, select, .icon-btn, .msg-react, .msg-speak, .reaction-picker')) return null;
    if (row.closest('#notifPanel') && !row.classList.contains('notif-item')) return null;
    return row;
  }
  function cancel(){ if (state?.timer) clearTimeout(state.timer); state=null; }
  function trigger(){
    if (!state?.row) return;
    const row=state.row;
    const isNotif=row.matches('#notifPanel .notif-item');
    const id=isNotif ? String(row.dataset.id||'') : String(row.dataset.conversationId||'');
    if (!id) { cancel(); return; }
    if (navigator.vibrate) navigator.vibrate(12);
    if (isNotif) {
      if (notifSelectMode) toggleNotifSelect(id); else enterNotifSelectMode(id);
    } else {
      if (msgSelectMode) toggleMsgSelected(id); else enterMsgSelectMode(id);
    }
    row.dataset.longPressConsumed='1';
    state=null;
  }
  document.addEventListener('pointerdown',(e)=>{
    if (e.pointerType==='mouse' && e.button!==0) return;
    const row=rowFromTarget(e.target);
    if(!row) return;
    cancel();
    state={row,id:e.pointerId,x:e.clientX,y:e.clientY,timer:null};
    state.timer=setTimeout(trigger,HOLD_MS);
  },{passive:true});
  document.addEventListener('pointermove',(e)=>{
    if(!state || e.pointerId!==state.id) return;
    if(Math.hypot(e.clientX-state.x,e.clientY-state.y)>MOVE_CANCEL_PX) cancel();
  },{passive:true});
  document.addEventListener('pointerup',(e)=>{
    if(state && e.pointerId===state.id) cancel();
  },{passive:true});
  document.addEventListener('pointercancel',(e)=>{
    if(state && e.pointerId===state.id) cancel();
  },{passive:true});
  document.addEventListener('contextmenu',(e)=>{
    const row=rowFromTarget(e.target);
    if(row){ e.preventDefault(); trigger(); }
  },{capture:true});
})();

