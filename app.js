(function(){
'use strict';
const $=s=>document.querySelector(s), screens=['launcher','login','server','charsel','charcreate','world'];
const artAssets=[
  ['#launcher .board','assets/launcher-fixed.b64'],
  ['#login .board','assets/login-fixed.b64'],
  ['#server .board','assets/server-fixed.b64'],
  ['#charsel .board','assets/charsel-fixed.b64'],
  ['#charcreate .board','assets/charcreate-fixed.b64']
];
for(const [selector,url] of artAssets){
  fetch(url,{cache:'no-store'})
    .then(r=>{if(!r.ok)throw new Error(url+' '+r.status);return r.text();})
    .then(b64=>{$(selector).style.backgroundImage=`url("data:image/webp;base64,${b64.trim()}")`;})
    .catch(err=>console.error('OldERA asset load failed:',err));
}
function show(id){screens.forEach(x=>$('#'+x).classList.toggle('active',x===id));}
let toastTimer; function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),1800);}
$('#startHit').addEventListener('click',()=>show('login'));
$('#homeHit').addEventListener('click',()=>toast('Homepage test sürümünde bağlı değil.'));
$('#optionHit').addEventListener('click',()=>toast('Option menüsü sonraki buildde bağlanacak.'));
$('#exitHit').addEventListener('click',()=>show('launcher'));
$('#loginOptHit').addEventListener('click',()=>toast('Options test menüsü.'));
$('#loginHomeHit').addEventListener('click',()=>toast('Homepage test sürümünde bağlı değil.'));
$('#loginHit').addEventListener('click',()=>{const id=$('#idInput').value.trim(),pw=$('#pwInput').value;if(id==='osevinc'&&pw==='osevinc'){localStorage.setItem('olderaUser',id);show('server');}else toast('ID veya şifre yanlış. Test hesabı: osevinc / osevinc');});
$('#serverRowHit').addEventListener('click',()=>toast('OldERA seçildi · Doluluk: Normal'));
$('#connectHit').addEventListener('click',()=>show('charsel'));
const racePos=[10.2,17.0,23.9,30.8], races=['Arch Tuarek','Tuarek','Wrinkle Tuarek','Puri Tuarek'];
const jobPos=[40.2,46.7,53.3,59.8], jobs=['Warrior','Rogue','Magician','Priest'];
let create={race:0,job:0,bonus:10,stats:{str:0,hp:0,dex:0,int:0,mp:0}};
function addHit(left,top,w,h,cb){const b=document.createElement('button');b.className='hit';b.style.cssText=`left:${left}%;top:${top}%;width:${w}%;height:${h}%`;b.addEventListener('click',cb);$('#charcreate .board').appendChild(b);return b;}
racePos.forEach((top,i)=>addHit(6.0,top,19.5,4.7,()=>{create.race=i;$('#raceOutline').style.top=top+'%';}));
jobPos.forEach((top,i)=>addHit(6.0,top,19.5,4.7,()=>{create.job=i;$('#jobOutline').style.top=top+'%';}));
const statRows={str:13.1,hp:18.7,dex:24.3,int:30.0,mp:35.7};
Object.entries(statRows).forEach(([k,top])=>{addHit(78.5,top,3.5,3.5,()=>bump(k,-1));addHit(89.0,top,3.5,3.5,()=>bump(k,1));});
function bump(k,d){if(d>0&&create.bonus<=0)return;if(d<0&&create.stats[k]<=0)return;create.stats[k]+=d;create.bonus-=d;$('#bonusVal').textContent=create.bonus;$('#sv-'+k).textContent=create.stats[k];}
function loadCharacter(){try{return JSON.parse(localStorage.getItem('olderaCharacter')||'null')}catch{return null}}
function refreshCharacter(){const c=loadCharacter();if(c){$('#summaryName').textContent=c.name;$('#summaryMeta').textContent=`${c.race} · ${c.job} · Lv. 1`;$('#startCharacter').disabled=false;}else{$('#summaryName').textContent='Empty Slot';$('#summaryMeta').textContent="Karakter oluşturmak için Create Character'a bas.";$('#startCharacter').disabled=true;}}
$('#createShortcut').addEventListener('click',()=>show('charcreate'));
$('#cancelCreate').addEventListener('click',()=>show('charsel'));
$('#createFinal').addEventListener('click',()=>{const name=$('#charName').value.trim();if(!name){toast('Karakter adı gir.');return;}const c={name,race:races[create.race],job:jobs[create.job],stats:{...create.stats}};localStorage.setItem('olderaCharacter',JSON.stringify(c));refreshCharacter();show('charsel');toast(name+' oluşturuldu.');});
$('#startCharacter').addEventListener('click',()=>{const c=loadCharacter();if(!c)return;$('#worldName').textContent=c.name;$('#worldMeta').textContent=`${c.race} · ${c.job} · Lv. 1`;show('world');world.start();});
$('#worldExit').addEventListener('click',()=>{world.stop();show('charsel');});
refreshCharacter();
class MiniWorld{
 constructor(canvas){this.c=canvas;this.x=0;this.z=6;this.a=0;this.keys={};this.running=false;this.last=0;this.bind();this.resize();}
 bind(){addEventListener('resize',()=>this.resize());addEventListener('keydown',e=>this.keys[e.key.toLowerCase()]=true);addEventListener('keyup',e=>this.keys[e.key.toLowerCase()]=false);}
 resize(){this.c.width=innerWidth;this.c.height=innerHeight;this.ctx=this.c.getContext('2d');}
 start(){if(this.running)return;this.running=true;this.last=performance.now();requestAnimationFrame(t=>this.loop(t));}
 stop(){this.running=false;}
 loop(t){if(!this.running)return;const dt=Math.min(.04,(t-this.last)/1000);this.last=t;this.update(dt);this.draw();requestAnimationFrame(n=>this.loop(n));}
 update(dt){const s=(this.keys['shift']?7:4)*dt;if(this.keys['q'])this.a-=1.5*dt;if(this.keys['e'])this.a+=1.5*dt;const fx=Math.sin(this.a),fz=-Math.cos(this.a),rx=Math.cos(this.a),rz=Math.sin(this.a);let mx=0,mz=0;if(this.keys['w']){mx+=fx;mz+=fz}if(this.keys['s']){mx-=fx;mz-=fz}if(this.keys['a']){mx-=rx;mz-=rz}if(this.keys['d']){mx+=rx;mz+=rz}const l=Math.hypot(mx,mz)||1;this.x+=mx/l*s;this.z+=mz/l*s;}
 proj(x,y,z){let dx=x-this.x,dz=z-this.z,ca=Math.cos(-this.a),sa=Math.sin(-this.a),rx=dx*ca-dz*sa,rz=dx*sa+dz*ca+11;if(rz<.4)return null;const f=this.c.height*.82;return{x:this.c.width/2+rx/rz*f,y:this.c.height*.57-(y-2.3)/rz*f,s:f/rz};}
 draw(){const c=this.ctx,w=this.c.width,h=this.c.height;let g=c.createLinearGradient(0,0,0,h*.58);g.addColorStop(0,'#607887');g.addColorStop(.7,'#b6a578');g.addColorStop(1,'#d0b777');c.fillStyle=g;c.fillRect(0,0,w,h*.58);c.fillStyle='#9d8460';c.fillRect(0,h*.58,w,h*.42);c.fillStyle='#49483e';for(let i=-7;i<=7;i++){let p=this.proj(i*5,3,-18+(Math.abs(i)%3)*4);if(p){c.fillRect(p.x-p.s*.35,p.y-p.s*1.1,p.s*.7,p.s*1.1)}}const npcs=[[-5,-6,'Inn Hostess'],[5,-5,'Warehouse Keeper'],[-9,2,'Potion Merchant'],[9,3,'Armor Merchant']];for(const [x,z,n] of npcs){let p=this.proj(x,1.5,z);if(!p)continue;c.fillStyle='#25201a';c.fillRect(p.x-p.s*.12,p.y-p.s*.45,p.s*.24,p.s*.58);c.fillStyle='#c6a476';c.beginPath();c.arc(p.x,p.y-p.s*.52,p.s*.09,0,Math.PI*2);c.fill();c.font=Math.max(10,p.s*.05)+'px Arial';c.textAlign='center';c.fillStyle='#f2ce73';c.fillText(n,p.x,p.y-p.s*.67);}c.fillStyle='#151515';c.fillRect(w/2-12,h*.72-45,24,45);c.fillStyle='#9e795d';c.beginPath();c.arc(w/2,h*.72-54,10,0,Math.PI*2);c.fill();}
}
const world=new MiniWorld($('#worldCanvas'));
})();