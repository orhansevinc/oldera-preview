(()=>{
const $=s=>document.querySelector(s);
const screens=['login','server','chars','create','world'];
const show=id=>screens.forEach(s=>$('#'+s).classList.toggle('active',s===id));
$('#loginBtn').onclick=()=>{
 if($('#id').value.trim()==='osevinc' && $('#pw').value==='osevinc') show('server');
 else alert('Test hesabı: osevinc / osevinc');
};
$('#serverBtn').onclick=()=>{refresh();show('chars')};
let selected='El Morad · Warrior';
document.querySelectorAll('.pick').forEach(b=>b.onclick=()=>{selected=b.dataset.v;$('#pickText').textContent=selected});
$('#createBtn').onclick=()=>show('create');
$('#cancelChar').onclick=()=>show('chars');
$('#saveChar').onclick=()=>{
 const name=$('#charName').value.trim()||'Orhan';
 localStorage.setItem('olderaCharacter',JSON.stringify({name,meta:selected}));
 refresh();show('chars');
};
function refresh(){
 let c=null;try{c=JSON.parse(localStorage.getItem('olderaCharacter')||'null')}catch{}
 if(c){$('#slot1').classList.add('filled');$('#slot1').innerHTML=`<span><b>${c.name}</b><br><span class="small">${c.meta} · Lv. 1</span></span>`}
 else{$('#slot1').classList.remove('filled');$('#slot1').innerHTML='<span>Empty Slot<br><span class="small">Create Character</span></span>'}
 $('#enterBtn').disabled=!c;
}
$('#enterBtn').onclick=()=>{
 let c=null;try{c=JSON.parse(localStorage.getItem('olderaCharacter')||'null')}catch{}
 if(!c)return;
 $('#worldText').textContent=`${c.name} · ${c.meta} · Lv. 1 — Moradon yükleme prototipi`;
 show('world');
};
$('#backBtn').onclick=()=>show('chars');
refresh();
})();