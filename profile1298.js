/* Local test profiles. This is not a server authentication service. */
(()=>{'use strict';
const ids=new Set(['osevinc','osevinc1']);
const key=id=>'oldera1298.profile.v2.'+id;
const slots=value=>Array.from({length:3},(_,i)=>value?.[i]||null);
const seed=()=>({name:'Osevinc',race:'btn_race_el_rm',job:'btn_class_warrior',face:0,hair:0,stats:[70,60,70,50,50]});
let storage=null;
try{storage=window.localStorage}catch{}
const memory=new Map();
function read(id){
  if(!ids.has(id))throw Error('Unknown test profile');
  let p=memory.get(id);
  try{p=JSON.parse(storage?.getItem(key(id))||'null')||p}catch{}
  if(!p){
    let nation=0,character=null;
    try{nation=Number(storage?.getItem('oldera1298.nation.'+id));character=JSON.parse(storage?.getItem('oldera1298.character.'+id)||'null')}catch{}
    if(nation!==1&&nation!==2)nation=id==='osevinc'?2:0;
    if(id==='osevinc'&&!character){character=seed();if(nation===1){character.race='btn_race_ka_at';character.stats=[75,65,60,50,50]}}
    p={nation,characters:slots([character]),selectedIndex:0};
  }
  return{nation:[1,2].includes(p.nation)?p.nation:0,characters:slots(p.characters),selectedIndex:Math.max(0,Math.min(2,p.selectedIndex|0))};
}
function save(id,p){
  const value=JSON.stringify({nation:p.nation,characters:slots(p.characters),selectedIndex:p.selectedIndex|0});
  memory.set(id,JSON.parse(value));
  try{storage?.setItem(key(id),value)}catch(e){console.warn('Profile saved for this session only',e)}
}
window.OldERAProfiles={login:(id,password)=>ids.has(id)&&id===password?read(id):null,read,save};
})();
