(()=>{
  const uiStyle=document.createElement('style');
  uiStyle.textContent=`
    @media (min-width:1121px){
      :root{--shell:1650px}
      .nav{height:104px!important;gap:28px!important}
      .crest{width:60px!important;height:72px!important}
      .brand{gap:15px!important}
      .brand strong{font-size:36px!important}
      .brand small{font-size:10px!important;margin-top:8px!important}
      .navlinks a{font-size:16px!important;padding:18px 15px!important}
      .actions{gap:10px!important}
      .btn{min-height:52px!important;padding:0 22px!important;font-size:13px!important}
      .hero{height:calc(100vh - 104px)!important;min-height:760px!important;max-height:980px!important}
      .hero-grid{width:min(1650px,calc(100% - 42px))!important;grid-template-columns:1.08fr .92fr!important;gap:72px!important;padding:72px 0 132px!important}
      .hero-grid>div:first-child{max-width:860px!important}
      .kicker{font-size:14px!important}
      .title{font-size:clamp(94px,9vw,154px)!important}
      .slogan{font-size:48px!important;margin:26px 0 22px!important}
      .lead{font-size:19px!important;line-height:1.7!important;max-width:790px!important}
      .play-stage{min-height:430px!important}
      .playdisc{width:300px!important;height:300px!important}
      .playicon{width:76px!important;height:76px!important;font-size:28px!important}
      .playcopy strong{font-size:26px!important}
      .playcopy small{font-size:10px!important}
      .countdown{margin-top:-86px!important}
      .count-card{min-height:204px!important}
      .count-intro{padding:34px 44px!important}
      .count-intro small{font-size:11px!important}
      .count-intro h2{font-size:47px!important}
      .count-intro b{font-size:19px!important}
      .count-intro p{font-size:11px!important}
      .time b{font-size:76px!important}
      .time span{font-size:10px!important}
      .section{padding-top:64px!important;padding-bottom:64px!important}
      .section-head h2{font-size:39px!important}
      .section-head p{font-size:13px!important}
      .panel-head h3{font-size:23px!important}
      .world-copy h3{font-size:34px!important}
      .world-copy p{font-size:13px!important}
    }
  `;
  document.head.appendChild(uiStyle);

  const hero=document.querySelector('.hero');
  if(hero){
    hero.style.setProperty('background-image','url("https://s3.eu-central-1.amazonaws.com/images.gamesatis.com/app/public/content/705/content_knight-online-castle-siege-war-csw.jpg")','important');
    hero.style.setProperty('background-size','cover','important');
    hero.style.setProperty('background-position','center 48%','important');
    hero.style.setProperty('background-repeat','no-repeat','important');
  }

  const target=new Date('2026-11-01T00:00:00+03:00').getTime(),pad=n=>String(Math.max(0,n)).padStart(2,'0');
  function tick(){let q=Math.max(0,target-Date.now());const d=Math.floor(q/86400000);q%=86400000;const h=Math.floor(q/3600000);q%=3600000;const m=Math.floor(q/60000),s=Math.floor((q%60000)/1000);for(const [id,v] of [['d',d],['h',h],['m',m],['s',s]]){const el=document.getElementById(id);if(el)el.textContent=pad(v)}}
  tick();setInterval(tick,1000);
  const toast=document.getElementById('toast');let tt;
  function say(t){if(!toast)return;toast.textContent=t;toast.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>toast.classList.remove('show'),2600)}
  document.querySelectorAll('.guide-item').forEach(x=>x.onclick=()=>say('Bu bölüm hazırlandı; canlı database/API entegrasyonu sonraki aşamada bağlanacak.'));
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');say(b.textContent+' sıralaması için API entegrasyonu bekleniyor.');});
})();