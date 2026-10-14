(()=>{
  const config=window.OLDKOWEB_CONFIG||{};
  const API=config.accountApiBase||'/api/account';
  const $=(s,root=document)=>root.querySelector(s);
  const $$=(s,root=document)=>[...root.querySelectorAll(s)];
  const auth=$('#auth'),portal=$('#portal');
  const authViews=['login','register','forgot','verify','reset'];
  let session=null;

  function message(id,text,type='info'){
    const el=$(`#${id}`); if(!el) return; el.textContent=text||''; el.dataset.type=type; el.hidden=!text;
  }
  async function api(path,{method='GET',body}={}){
    const options={method,credentials:'same-origin',headers:{accept:'application/json'}};
    if(body!==undefined){options.headers['content-type']='application/json';options.body=JSON.stringify(body);}
    const res=await fetch(`${API}${path}`,options);
    let data={}; try{data=await res.json();}catch{}
    if(!res.ok){const err=new Error(data?.error?.message||'İşlem tamamlanamadı.');err.status=res.status;err.code=data?.error?.code||'REQUEST_FAILED';throw err;}
    return data;
  }
  function errorText(error){
    const map={INVALID_CREDENTIALS:'Kullanıcı adı/e-posta veya şifre hatalı.',USERNAME_TAKEN:'Bu kullanıcı adı zaten kullanılıyor.',EMAIL_TAKEN:'Bu e-posta zaten kullanılıyor.',ACCOUNT_UNVERIFIED:'Hesabını doğrulaman gerekiyor.',ACCOUNT_BANNED:'Hesap erişimi askıya alınmış.',WEAK_PASSWORD:'Şifre en az 10 karakter olmalı ve en az üç karakter türü içermeli.',INVALID_OR_EXPIRED_TOKEN:'Kod geçersiz veya süresi dolmuş.',RATE_LIMITED:'Çok fazla deneme yapıldı. Bir süre sonra tekrar dene.'};
    return map[error?.code]||error?.message||'İşlem tamamlanamadı.';
  }
  function showAuth(id='login'){
    auth.style.display='block'; portal.classList.remove('active');
    authViews.forEach((v)=>{const view=$(`#${v}`);if(view)view.classList.toggle('active',v===id);const tab=$(`#t-${v}`);if(tab)tab.classList.toggle('active',v===id);});
  }
  function fmtDate(value){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('tr-TR',{dateStyle:'medium',timeStyle:'short'}).format(d);}
  function nationName(v){return Number(v)===1?'Karus':Number(v)===2?'El Morad':'—';}
  function renderSession(data){
    session=data;
    $('#who').textContent=data.user.username;
    $('#accountStatus').textContent=data.user.status==='active'?'Aktif':data.user.status||'—';
    $('#createdAt').textContent=fmtDate(data.user.createdAt);
    $('#lastLoginAt').textContent=fmtDate(data.user.lastLoginAt);
    $('#accountEmail').textContent=data.user.email||'—';
    const list=$('#characterList'); list.innerHTML='';
    if(!data.characters?.length){list.innerHTML='<div class="box"><h3>Henüz karakter yok</h3><p>Oyunda oluşturduğun karakterler burada görünecek.</p></div>';}
    else data.characters.forEach((c)=>{const el=document.createElement('div');el.className='box character-card';el.innerHTML=`<h3>${escapeHtml(c.name)}</h3><p>${nationName(c.nation)} • Level ${Number(c.level)||1} • Class ${Number(c.classId)||'—'}</p><p>Clan: ${escapeHtml(c.clan?.name||'—')} • NP: ${Number(c.np)||0}</p>`;list.appendChild(el);});
  }
  function escapeHtml(value){const span=document.createElement('span');span.textContent=String(value??'');return span.innerHTML;}
  async function openDashboard(){
    try{const data=await api('/v1/session/current');renderSession(data);auth.style.display='none';portal.classList.add('active');if(location.hash!=='#dashboard')history.replaceState(null,'','#dashboard');return true;}
    catch(error){session=null;showAuth('login');if(location.hash==='#dashboard')history.replaceState(null,'','#login');if(error.status!==401)message('loginMessage',errorText(error),'error');return false;}
  }
  async function route(){const id=location.hash.slice(1)||'login';if(id==='dashboard'){await openDashboard();return;}showAuth(authViews.includes(id)?id:'login');}
  window.addEventListener('hashchange',route);

  $('#loginForm').addEventListener('submit',async(e)=>{e.preventDefault();message('loginMessage','');const button=e.submitter;button.disabled=true;try{await api('/v1/session/login',{method:'POST',body:{identifier:$('#loginUser').value.trim(),password:$('#loginPassword').value}});await openDashboard();}catch(error){message('loginMessage',errorText(error),'error');if(error.code==='ACCOUNT_UNVERIFIED')$('#verifyShortcut').hidden=false;}finally{button.disabled=false;}});
  $('#registerForm').addEventListener('submit',async(e)=>{e.preventDefault();message('registerMessage','');if($('#p1').value!==$('#p2').value){message('registerMessage','Şifreler eşleşmiyor.','error');return;}const button=e.submitter;button.disabled=true;try{await api('/v1/accounts/register',{method:'POST',body:{username:$('#regUser').value.trim(),email:$('#regEmail').value.trim(),password:$('#p1').value}});$('#verifyEmail').value=$('#regEmail').value.trim();message('verifyMessage','Hesap oluşturuldu. E-postana gönderilen doğrulama kodunu gir.','success');location.hash='verify';}catch(error){message('registerMessage',errorText(error),'error');}finally{button.disabled=false;}});
  $('#forgotForm').addEventListener('submit',async(e)=>{e.preventDefault();const email=$('#forgotEmail').value.trim();const button=e.submitter;button.disabled=true;try{await api('/v1/accounts/password-reset/request',{method:'POST',body:{email}});message('forgotMessage','Hesap eşleşiyorsa sıfırlama kodu gönderildi.','success');location.hash='reset';}catch(error){message('forgotMessage',errorText(error),'error');}finally{button.disabled=false;}});
  $('#verifyRequestForm').addEventListener('submit',async(e)=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{await api('/v1/accounts/verification/request',{method:'POST',body:{email:$('#verifyEmail').value.trim()}});message('verifyMessage','Hesap eşleşiyorsa yeni doğrulama kodu gönderildi.','success');}catch(error){message('verifyMessage',errorText(error),'error');}finally{button.disabled=false;}});
  $('#verifyForm').addEventListener('submit',async(e)=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{await api('/v1/accounts/verification/confirm',{method:'POST',body:{token:$('#verifyToken').value.trim()}});message('verifyMessage','Hesap doğrulandı. Şimdi giriş yapabilirsin.','success');setTimeout(()=>{location.hash='login';},600);}catch(error){message('verifyMessage',errorText(error),'error');}finally{button.disabled=false;}});
  $('#resetForm').addEventListener('submit',async(e)=>{e.preventDefault();if($('#resetP1').value!==$('#resetP2').value){message('resetMessage','Şifreler eşleşmiyor.','error');return;}const button=e.submitter;button.disabled=true;try{await api('/v1/accounts/password-reset/confirm',{method:'POST',body:{token:$('#resetToken').value.trim(),newPassword:$('#resetP1').value}});message('resetMessage','Şifren değiştirildi. Yeni şifrenle giriş yapabilirsin.','success');setTimeout(()=>{location.hash='login';},600);}catch(error){message('resetMessage',errorText(error),'error');}finally{button.disabled=false;}});
  $('#passwordForm').addEventListener('submit',async(e)=>{e.preventDefault();if(!session)return;if($('#newPassword').value!==$('#newPassword2').value){message('securityMessage','Yeni şifreler eşleşmiyor.','error');return;}const button=e.submitter;button.disabled=true;try{await api('/v1/accounts/password/change',{method:'POST',body:{username:session.user.username,currentPassword:$('#currentPassword').value,newPassword:$('#newPassword').value}});message('securityMessage','Şifren değiştirildi. Güvenlik için yeniden giriş yap.','success');setTimeout(async()=>{try{await api('/v1/session/logout',{method:'POST',body:{}});}catch{}session=null;location.hash='login';},700);}catch(error){message('securityMessage',errorText(error),'error');}finally{button.disabled=false;}});

  $$('.menu button[data-section]').forEach((b)=>b.addEventListener('click',()=>{$$('.menu button').forEach((x)=>x.classList.remove('active'));b.classList.add('active');$$('.main .section').forEach((x)=>x.classList.remove('active'));$(`#${b.dataset.section}`).classList.add('active');}));
  $$('[data-go]').forEach((a)=>a.addEventListener('click',(e)=>{e.preventDefault();const b=$(`.menu button[data-section="${a.dataset.go}"]`);if(b)b.click();}));
  $$('[data-unavailable]').forEach((b)=>b.addEventListener('click',()=>alert('Bu işlem henüz backend desteğine sahip değil; herhangi bir değişiklik yapılmadı.')));
  $('#logout').addEventListener('click',async()=>{const b=$('#logout');b.disabled=true;try{await api('/v1/session/logout',{method:'POST',body:{}});session=null;portal.classList.remove('active');location.hash='login';}catch(error){alert(errorText(error));}finally{b.disabled=false;}});
  $$('.play-link').forEach((a)=>a.href=config.playUrl||'https://play.oldkoweb.com/');
  route();
})();
