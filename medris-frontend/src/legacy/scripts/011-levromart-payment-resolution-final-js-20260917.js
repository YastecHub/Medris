
(function(){
  "use strict";
  let paymentReasonResolver=null;
  function openReasonModal(){
    const modal=document.getElementById('levroPaymentReasonModal');
    const input=document.getElementById('levroPaymentReasonInput');
    const err=document.getElementById('levroPaymentReasonError');
    if(!modal||!input)return Promise.resolve(null);
    input.value=''; err?.classList.add('hidden'); modal.classList.remove('hidden');
    setTimeout(()=>input.focus(),30);
    return new Promise(resolve=>{paymentReasonResolver=resolve;});
  }
  function closeReasonModal(value){
    const modal=document.getElementById('levroPaymentReasonModal'); if(modal)modal.classList.add('hidden');
    const r=paymentReasonResolver; paymentReasonResolver=null; if(r)r(value);
  }
  document.getElementById('levroPaymentReasonCancel')?.addEventListener('click',()=>closeReasonModal(null));
  document.getElementById('levroPaymentReasonConfirm')?.addEventListener('click',()=>{
    const input=document.getElementById('levroPaymentReasonInput'),err=document.getElementById('levroPaymentReasonError');
    const reason=String(input?.value||'').trim();
    if(!reason){err.textContent='Please explain why you are disputing the payment.';err.classList.remove('hidden');input?.focus();return;}
    closeReasonModal(reason);
  });
  document.getElementById('levroPaymentReasonModal')?.addEventListener('click',e=>{if(e.target.id==='levroPaymentReasonModal')closeReasonModal(null);});

  window.confirmBuyerReportedPayment=async function(orderId){
    if(!(await showConfirmDialog('Only confirm after you have checked your bank account and actually received this transfer. This will mark the payment as verified and may complete the order and create the applicable commission charge.',{title:'Confirm payment received',okLabel:'Yes, confirm payment'})))return;
    try{
      const {data,error}=await sb.rpc('vendor_confirm_reported_payment',{p_order_id:orderId});
      if(error)throw error;
      showToast(data?.order_completed?'Payment confirmed. Order completed.':'Payment confirmed.','success');
      await navigate('orderDetail',{orderId},false);
    }catch(e){showToast(e?.message||'Could not confirm this payment.','error');}
  };

  window.openBuyerPaymentDispute=async function(orderId){
    if(!(await showConfirmDialog('Raise a payment dispute only if you have checked your account and cannot verify the transfer. The order will be marked Payment unresolved and sent to the admin review queue.',{title:'Raise payment dispute',okLabel:'Continue'})))return;
    const reason=await openReasonModal();
    if(!reason)return;
    try{
      const {data,error}=await sb.rpc('vendor_dispute_reported_payment',{p_order_id:orderId,p_reason:reason});
      if(error)throw error;
      showToast('Payment unresolved. The claim has been sent to admin for review.','success');
      await navigate('orderDetail',{orderId},false);
    }catch(e){showToast(e?.message||'Could not raise the payment dispute.','error');}
  };

  window.adminConfirmReportedPayment=async function(orderId){
    if(!(await showConfirmDialog('Verify this buyer payment claim? This will mark the transfer as paid and, where applicable, complete the order and create the commission charge.',{title:'Verify payment claim',okLabel:'Verify payment'})))return;
    try{
      const {data,error}=await sb.rpc('admin_confirm_reported_payment',{p_order_id:orderId,p_admin_notes:'Payment claim verified by admin.'});
      if(error)throw error;
      showToast(data?.order_completed?'Payment verified and order completed.':'Payment verified.','success');
      await navigate('adminDisputes',{},false);
    }catch(e){showToast(e?.message||'Could not verify the payment claim.','error');}
  };

  window.adminRejectReportedPayment=async function(orderId){
    const notes=window.prompt('Resolution notes (required):','Payment claim could not be verified.');
    if(notes===null)return;
    if(!String(notes).trim()){showToast('Resolution notes are required.','error');return;}
    if(!(await showConfirmDialog('Reject this payment claim and cancel the order? The reported transfer will not be treated as a verified Levromart payment.',{title:'Reject payment claim',okLabel:'Reject claim',danger:true})))return;
    try{
      const {error}=await sb.rpc('admin_reject_reported_payment',{p_order_id:orderId,p_admin_notes:String(notes).trim()});
      if(error)throw error;
      showToast('Payment claim rejected and order cancelled.','success');
      await navigate('adminDisputes',{},false);
    }catch(e){showToast(e?.message||'Could not reject the payment claim.','error');}
  };
})();
