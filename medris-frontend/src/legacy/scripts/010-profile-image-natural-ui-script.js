
(function(){
  function preventNativeImageMenu(e){const img=e.target?.closest?.('#profilePanel img, header .brand-logo-circle, .chat-header-avatar, .conv-list-item img.avatar-circle, .storefront-avatar-button img');if(img)e.preventDefault();}
  document.addEventListener('contextmenu',preventNativeImageMenu,{capture:true});
  document.addEventListener('dragstart',function(e){const img=e.target?.closest?.('#profilePanel img, header .brand-logo-circle, .chat-header-avatar, .conv-list-item img.avatar-circle, .storefront-avatar-button img');if(img)e.preventDefault();},{capture:true});
  window.openProfileImageLightbox=function(url,name){const box=document.getElementById('vendorProfileImageLightbox'),img=document.getElementById('vendorProfileImageLightboxImg'),fallback=document.getElementById('vendorProfileImageLightboxFallback');if(!box)return;const safeName=String(name||'Profile');if(url){img.src=url;img.alt=safeName;img.classList.remove('hidden');fallback.classList.add('hidden');}else{img.removeAttribute('src');img.alt='';img.classList.add('hidden');fallback.innerHTML='<i class="fa-solid fa-user" aria-hidden="true"></i>';fallback.classList.remove('hidden');}box.setAttribute('aria-label',safeName);box.classList.remove('hidden');};
  window.openVendorProfileImageLightbox=window.openProfileImageLightbox;
  window.closeVendorProfileImageLightbox=function(e){if(e&&e.target?.closest?.('.vendor-profile-image-close')===null&&e.target?.id!=='vendorProfileImageLightbox')return;document.getElementById('vendorProfileImageLightbox')?.classList.add('hidden');};
  document.addEventListener('keydown',function(e){if(e.key==='Escape')window.closeVendorProfileImageLightbox();});
})();
