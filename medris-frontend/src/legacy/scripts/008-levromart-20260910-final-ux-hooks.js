
(function(){
  'use strict';
  /* Keep the dedicated chat shell stable if Safari/iOS changes the visual viewport. */
  function refresh(){ try{ window.__levromartSyncChatViewport?.(); }catch(_){} }
  window.addEventListener('pageshow', refresh, {passive:true});
  window.addEventListener('orientationchange', function(){ setTimeout(refresh,120); }, {passive:true});
})();
