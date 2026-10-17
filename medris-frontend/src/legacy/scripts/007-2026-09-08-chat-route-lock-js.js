
(function(){
  const applyChatLock = () => {
    const on = document.body?.classList.contains("chat-full-page");
    document.documentElement.classList.toggle("chat-route-lock", !!on);
  };
  applyChatLock();
  const mo = new MutationObserver(applyChatLock);
  if (document.body) mo.observe(document.body, {attributes:true, attributeFilter:["class"]});
})();
