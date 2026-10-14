(async()=>{
  const parts=[
    'assets/hero-v20-p01.txt',
    'assets/hero-v20-p02.txt',
    'assets/hero-v20-p03.txt',
    'assets/hero-v20-p04.txt',
    'assets/hero-v20-p05.txt',
    'assets/hero-v20-p06.txt',
    'assets/hero-v20-p07.txt',
    'assets/hero-v20-p08.txt',
    'assets/hero-v20-p09.txt'
  ];
  const base64=(await Promise.all(parts.map(p=>fetch(p+'?v=20',{cache:'no-store'}).then(r=>{
    if(!r.ok) throw new Error('Hero part failed: '+p);
    return r.text();
  })))).join('');
  if(base64.length!==128928) throw new Error('Hero data length mismatch: '+base64.length);
  const hero=document.querySelector('.hero');
  if(hero){
    hero.style.setProperty('background-image',`url("data:image/webp;base64,${base64}")`,'important');
    hero.style.setProperty('background-size','cover','important');
    hero.style.setProperty('background-position','center center','important');
    hero.style.setProperty('background-repeat','no-repeat','important');
  }
})().catch(err=>console.error('OldKOWeb hero load error',err));
