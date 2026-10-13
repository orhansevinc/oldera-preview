(()=>{
  'use strict';

  const admin=window.OldERAAdmin;
  const host=document.getElementById('characters');
  if(!host||!admin)return;

  const equipmentNames=['Right Earring','Left Earring','Helmet','Pauldron','Pads','Gloves','Boots','Right Hand','Left Hand','Necklace','Belt','Right Ring','Left Ring','Extra'];
  const sampleItems={
    2:{name:'Chitin Shell Helmet',short:'CSH',upgrade:'+7',serial:'OE-DEMO-000002',durability:'9800 / 9800',source:'Drop / Upgrade history hook'},
    3:{name:'Chitin Shell Pauldron',short:'CSP',upgrade:'+7',serial:'OE-DEMO-000003',durability:'11000 / 11000',source:'Drop / Upgrade history hook'},
    4:{name:'Chitin Shell Pads',short:'CSP',upgrade:'+7',serial:'OE-DEMO-000004',durability:'10500 / 10500',source:'Drop / Upgrade history hook'},
    5:{name:'Chitin Shell Gauntlets',short:'CSG',upgrade:'+7',serial:'OE-DEMO-000005',durability:'7600 / 7600',source:'Drop / Upgrade history hook'},
    6:{name:'Chitin Shell Boots',short:'CSB',upgrade:'+7',serial:'OE-DEMO-000006',durability:'7600 / 7600',source:'Drop / Upgrade history hook'},
    7:{name:'Raptor',short:'RAP',upgrade:'+8',serial:'OE-DEMO-000007',durability:'12000 / 12000',source:'Admin preview item'},
    9:{name:'Iron Necklace',short:'IN',upgrade:'',serial:'OE-DEMO-000009',durability:'—',source:'Admin preview item'},
    10:{name:'Iron Belt',short:'IB',upgrade:'',serial:'OE-DEMO-000010',durability:'—',source:'Admin preview item'},
    11:{name:'Ring',short:'R1',upgrade:'',serial:'OE-DEMO-000011',durability:'—',source:'Admin preview item'},
    12:{name:'Ring',short:'R2',upgrade:'',serial:'OE-DEMO-000012',durability:'—',source:'Admin preview item'}
  };

  const bagItems={
    0:{name:'HP Potion',short:'HP',count:'9999',serial:'STACK-DEMO-01',durability:'—',source:'Inventory'},
    1:{name:'MP Potion',short:'MP',count:'9999',serial:'STACK-DEMO-02',durability:'—',source:'Inventory'},
    2:{name:'Scroll',short:'SCR',count:'20',serial:'STACK-DEMO-03',durability:'—',source:'Inventory'},
    7:{name:'Upgrade Scroll',short:'BUS',count:'4',serial:'STACK-DEMO-08',durability:'—',source:'Inventory'},
    10:{name:'Raptor',short:'RAP',upgrade:'+1',serial:'OE-DEMO-BAG010',durability:'12000 / 12000',source:'Inventory'}
  };

  const warehouseItems={
    0:{name:'Raptor',short:'RAP',upgrade:'+1',serial:'OE-DEMO-WH000',durability:'12000 / 12000',source:'Inn Hostess page 1'},
    3:{name:'Iron Belt',short:'IB',serial:'OE-DEMO-WH003',durability:'—',source:'Inn Hostess page 1'},
    12:{name:'Chitin Shell Pauldron',short:'CSP',upgrade:'+6',serial:'OE-DEMO-WH012',durability:'11000 / 11000',source:'Inn Hostess page 1'}
  };

  const model={
    character:'osevinc',account:'osevinc',level:70,className:'Warrior',nation:'El Morad',zone:'Moradon',zoneId:21,x:815,z:430,
    np:48920,coin:37400000,hp:'3,842 / 3,842',mp:'1,204 / 1,204',exp:'62.4%',clan:'—',authority:'PLAYER',
    permissions:{login:true,chat:true,trade:true,merchant:true},warehousePage:1,selectedItem:null
  };

  host.innerHTML=`
    <div class="char-control-v2">
      <div class="mutation-banner"><b>ROOT OWNER CHARACTER CONTROL</b><span>14 equipment + 28 inventory + 192 Inn Hostess slots</span><span>SERVER-AUTHORITY READY</span></div>

      <div class="character-head panel">
        <div class="portrait big">O</div>
        <div class="char-title"><small>ONLINE · SESSION #A17F</small><h2>${model.character}</h2><span>Level ${model.level} ${model.className} · ${model.nation} · ${model.zone}</span></div>
        <div class="char-actions">
          <button data-cc-command="SUMMONUSER">SUMMON</button>
          <button data-cc-command="VIEW">VIEW</button>
          <button data-cc-action="teleport">TELEPORT</button>
          <button class="danger" data-cc-command="CUTOFF">DISCONNECT</button>
        </div>
      </div>

      <div class="character-status-strip">
        <div class="status-tile"><small>ACCOUNT</small><strong>${model.account}</strong></div>
        <div class="status-tile"><small>NATIONAL POINT</small><strong>${model.np.toLocaleString('en-US')}</strong></div>
        <div class="status-tile"><small>COIN</small><strong>${(model.coin/1000000).toFixed(1)}M</strong></div>
        <div class="status-tile"><small>ZONE / POS</small><strong>${model.zone} · ${model.x}/${model.z}</strong></div>
        <div class="status-tile"><small>CLAN</small><strong>${model.clan}</strong></div>
        <div class="status-tile"><small>AUTHORITY</small><strong>${model.authority}</strong></div>
      </div>

      <div class="tabs" id="ccTabs">
        <button class="active" data-cc-tab="overview">Overview</button>
        <button data-cc-tab="inventory">Inventory</button>
        <button data-cc-tab="inn">Inn Hostess</button>
        <button data-cc-tab="stats">Stats & Skills</button>
        <button data-cc-tab="history">Transactions</button>
        <button data-cc-tab="sanctions">Sanctions</button>
      </div>

      <div class="char-tab-panel active" data-cc-panel="overview"></div>
      <div class="char-tab-panel" data-cc-panel="inventory"></div>
      <div class="char-tab-panel" data-cc-panel="inn"></div>
      <div class="char-tab-panel" data-cc-panel="stats"></div>
      <div class="char-tab-panel" data-cc-panel="history"></div>
      <div class="char-tab-panel" data-cc-panel="sanctions"></div>
    </div>`;

  const panel=id=>host.querySelector(`[data-cc-panel="${id}"]`);

  function renderOverview(){
    panel('overview').innerHTML=`
      <div class="char-grid">
        <section class="subpanel">
          <div class="subpanel-head"><small>LIVE CHARACTER STATE</small><b>Read model → /api/admin/characters/${model.character}</b></div>
          <h3>Character Overview</h3>
          <div class="detail-list">
            <span>Level / Class</span><b>${model.level} / ${model.className}</b>
            <span>Nation</span><b>${model.nation}</b>
            <span>HP</span><b>${model.hp}</b>
            <span>MP</span><b>${model.mp}</b>
            <span>EXP</span><b>${model.exp}</b>
            <span>National Point</span><b>${model.np.toLocaleString('en-US')}</b>
            <span>Coin</span><b>${model.coin.toLocaleString('en-US')}</b>
            <span>Zone</span><b>${model.zone} (#${model.zoneId})</b>
            <span>Coordinates</span><b>X ${model.x} / Z ${model.z}</b>
          </div>
        </section>
        <section class="subpanel">
          <div class="subpanel-head"><small>OWNER MUTATION CONSOLE</small><b>Demo-safe</b></div>
          <h3>Edit Character</h3>
          <form class="owner-form" id="ccMutationForm">
            <label>Level<input name="level" type="number" min="1" max="83" value="${model.level}"></label>
            <label>National Point<input name="np" type="number" min="0" value="${model.np}"></label>
            <label>Coin<input name="coin" type="number" min="0" value="${model.coin}"></label>
            <label>Zone<select name="zone"><option value="21">Moradon (21)</option><option value="1">Luferson</option><option value="2">El Morad Castle</option><option value="71">Colony Zone</option></select></label>
            <label>X<input name="x" type="number" value="${model.x}"></label>
            <label>Z<input name="z" type="number" value="${model.z}"></label>
            <label class="span-2">Audit reason<input name="reason" value="ROOT OWNER manual character edit"></label>
            <button class="span-2" type="submit">VALIDATE & APPLY CHARACTER UPDATE</button>
          </form>
        </section>
      </div>
      <div class="char-grid three" style="margin-top:12px">
        <section class="subpanel"><div class="subpanel-head"><small>SESSION</small><b>ONLINE</b></div><h3>Connection</h3><div class="detail-list"><span>Account</span><b>${model.account}</b><span>Session</span><b>A17F</b><span>Last heartbeat</span><b>Now</b><span>Client profile</span><b>1298 Web</b></div></section>
        <section class="subpanel"><div class="subpanel-head"><small>POSITION</small><b>WORLD</b></div><h3>Location Control</h3><div class="detail-list"><span>Zone</span><b>${model.zone}</b><span>Zone ID</span><b>${model.zoneId}</b><span>X / Z</span><b>${model.x} / ${model.z}</b></div><button class="wide" data-cc-action="teleport">TELEPORT / REPOSITION</button></section>
        <section class="subpanel"><div class="subpanel-head"><small>ACCOUNT STATE</small><b>ALLOWED</b></div><h3>Permissions</h3><div class="detail-list"><span>Login</span><b class="ok">Allowed</b><span>Chat</span><b class="ok">Allowed</b><span>Trade</span><b class="ok">Allowed</b><span>Merchant</span><b class="ok">Allowed</b></div></section>
      </div>`;

    panel('overview').querySelector('#ccMutationForm').addEventListener('submit',async e=>{
      e.preventDefault();
      const fd=new FormData(e.currentTarget);
      const body=Object.fromEntries(fd.entries());
      await admin.mutate(`/characters/${model.character}`,'PATCH',body,'CHARACTER_EDIT',model.character);
      admin.showToast('Character update prepared','Validated owner mutation payload is wired to the character service.');
    });
    bindLocalActions(panel('overview'));
  }

  function slotHTML(item,index,label=''){
    if(!item)return `<button type="button" class="item-slot empty" tabindex="-1"><span class="slot-label">${label||index+1}</span></button>`;
    return `<button type="button" class="item-slot" data-item-key="${index}" data-item-scope="${label.startsWith('EQ')?'equip':label.startsWith('WH')?'warehouse':'bag'}"><span class="item-icon">${item.short}</span>${item.upgrade?`<span class="upgrade">${item.upgrade}</span>`:''}${item.count?`<span class="count">${item.count}</span>`:''}<span class="slot-label">${label||index+1}</span></button>`;
  }

  function renderInventory(){
    const equips=equipmentNames.map((name,i)=>slotHTML(sampleItems[i],i,`EQ${i+1}`)).join('');
    const bag=Array.from({length:28},(_,i)=>slotHTML(bagItems[i],i,`${i+1}`)).join('');
    panel('inventory').innerHTML=`
      <div class="inventory-layout">
        <section class="equip-wrap"><h3>Equipment · 14 Slots</h3><div class="equipment-grid">${equips}</div><p class="inventory-note">Slot labels map to the 1298 server's 14 equipped-item positions.</p></section>
        <section class="bag-wrap"><h3>Inventory · 28 Slots</h3><div class="inventory-grid">${bag}</div><p class="inventory-note">Item icons will be replaced by the real 1298 item icon assets when the item table/icon resolver is attached.</p></section>
        <aside class="item-inspector" id="itemInspector"><h3>Item Inspector</h3><p class="inventory-note">Select an equipped or inventory item to inspect serial, source and owner actions.</p></aside>
      </div>`;
    panel('inventory').querySelectorAll('.item-slot[data-item-key]').forEach(btn=>btn.addEventListener('click',()=>selectItem(btn)));
  }

  function selectedFromButton(btn){
    const idx=Number(btn.dataset.itemKey),scope=btn.dataset.itemScope;
    if(scope==='equip')return {...sampleItems[idx],scope,index:idx,slot:equipmentNames[idx]};
    if(scope==='warehouse')return {...warehouseItems[idx],scope,index:idx,slot:`Warehouse #${(model.warehousePage-1)*24+idx+1}`};
    return {...bagItems[idx],scope,index:idx,slot:`Inventory #${idx+1}`};
  }

  function selectItem(btn){
    const root=btn.closest('.char-tab-panel');
    root.querySelectorAll('.item-slot.selected').forEach(x=>x.classList.remove('selected'));
    btn.classList.add('selected');
    const item=selectedFromButton(btn);
    model.selectedItem=item;
    const inspector=root.querySelector('#itemInspector');
    if(!inspector)return;
    inspector.innerHTML=`
      <small>SELECTED ITEM</small><div class="item-title">${item.name} ${item.upgrade||''}</div><div class="item-sub">${item.slot}</div>
      <div class="detail-list"><span>Current owner</span><b>${model.character}</b><span>Durability</span><b>${item.durability||'—'}</b><span>Source</span><b>${item.source||'Unknown'}</b><span>Scope</span><b>${item.scope.toUpperCase()}</b></div>
      <div class="serial-box">SERIAL: ${item.serial||'NO-SERIAL'}</div>
      <div class="inspector-actions"><button class="primary" data-item-action="trace">TRACE SERIAL</button><button data-item-action="transfer">TRANSFER</button><button data-item-action="edit">EDIT ITEM</button><button class="danger" data-item-action="remove">REMOVE ITEM</button></div>`;
    inspector.querySelectorAll('[data-item-action]').forEach(x=>x.addEventListener('click',()=>itemAction(x.dataset.itemAction,item)));
  }

  async function itemAction(action,item){
    if(action==='trace'){
      admin.showToast('Serial trace',`${item.serial} history route: /api/admin/items/:serial/history`);
      admin.appendAudit('ITEM_TRACE',item.serial,'DEMO');
      return;
    }
    const map={transfer:'ITEM_TRANSFER',edit:'ITEM_EDIT',remove:'ITEM_REMOVE'};
    await admin.mutate(`/items/${encodeURIComponent(item.serial)}`,'POST',{action,character:model.character,scope:item.scope,slot:item.slot,reason:'ROOT OWNER item control'},map[action],item.serial);
    admin.showToast(map[action],`${item.name} ${item.upgrade||''} action prepared.`);
  }

  function renderInn(){
    const pages=Array.from({length:8},(_,i)=>`<button type="button" class="${i+1===model.warehousePage?'active':''}" data-wh-page="${i+1}">${i+1}</button>`).join('');
    const items=model.warehousePage===1?warehouseItems:{};
    const slots=Array.from({length:24},(_,i)=>slotHTML(items[i],i,`WH${(model.warehousePage-1)*24+i+1}`)).join('');
    panel('inn').innerHTML=`
      <div class="warehouse-layout">
        <section class="bag-wrap"><div class="subpanel-head"><small>INN HOSTESS / WAREHOUSE</small><b>192 SLOTS TOTAL</b></div><div class="page-btns">${pages}</div><div class="warehouse-grid">${slots}</div><p class="inventory-note">8 pages × 24 slots = 192 warehouse slots.</p></section>
        <aside class="item-inspector" id="itemInspector"><h3>Warehouse Inspector</h3><p class="inventory-note">Select an item. Ownership, serial history, transfer and removal all route through the same server-side item service.</p></aside>
      </div>`;
    panel('inn').querySelectorAll('[data-wh-page]').forEach(btn=>btn.addEventListener('click',()=>{model.warehousePage=Number(btn.dataset.whPage);renderInn()}));
    panel('inn').querySelectorAll('.item-slot[data-item-key]').forEach(btn=>btn.addEventListener('click',()=>selectItem(btn)));
  }

  function renderStats(){
    panel('stats').innerHTML=`
      <div class="stat-grid">
        <section class="subpanel"><div class="subpanel-head"><small>BASE STATS</small><b>SERVER VALIDATED</b></div><h3>Character Stats</h3><form id="statForm"><div class="stats-table"><span>STR</span><b>255</b><input name="str" type="number" value="255"><span>HP</span><b>90</b><input name="hp" type="number" value="90"><span>DEX</span><b>60</b><input name="dex" type="number" value="60"><span>INT</span><b>50</b><input name="int" type="number" value="50"><span>MP</span><b>50</b><input name="mp" type="number" value="50"></div><button class="wide" type="submit">APPLY STAT VALUES</button></form></section>
        <section class="subpanel"><div class="subpanel-head"><small>SKILL POINTS</small><b>${model.className.toUpperCase()}</b></div><h3>Skill Trees</h3><form id="skillForm"><div class="skill-row"><span>Attack</span><input name="attack" type="number" value="70"><button type="button" data-reset-skill="attack">RESET</button></div><div class="skill-row"><span>Defense</span><input name="defense" type="number" value="50"><button type="button" data-reset-skill="defense">RESET</button></div><div class="skill-row"><span>Master</span><input name="master" type="number" value="10"><button type="button" data-reset-skill="master">RESET</button></div><button class="wide" type="submit">APPLY SKILL VALUES</button></form></section>
      </div>`;
    panel('stats').querySelector('#statForm').addEventListener('submit',async e=>{e.preventDefault();await admin.mutate(`/characters/${model.character}/stats`,'PATCH',Object.fromEntries(new FormData(e.currentTarget)),'STAT_EDIT',model.character);admin.showToast('Stats prepared','Stat mutation payload validated for server-side rules.');});
    panel('stats').querySelector('#skillForm').addEventListener('submit',async e=>{e.preventDefault();await admin.mutate(`/characters/${model.character}/skills`,'PATCH',Object.fromEntries(new FormData(e.currentTarget)),'SKILL_EDIT',model.character);admin.showToast('Skills prepared','Skill mutation payload is ready for the class/level validator.');});
    panel('stats').querySelectorAll('[data-reset-skill]').forEach(btn=>btn.addEventListener('click',()=>{const input=panel('stats').querySelector(`[name="${btn.dataset.resetSkill}"]`);if(input)input.value=0;}));
  }

  function renderHistory(){
    panel('history').innerHTML=`<section class="subpanel"><div class="subpanel-head"><small>CHARACTER TRANSACTIONS</small><b>TRACEABLE</b></div><table class="history-table"><thead><tr><th>Time</th><th>Type</th><th>Object</th><th>Counterparty / Source</th><th>Trace</th></tr></thead><tbody><tr><td>21:12:04</td><td><b>ZONE_ENTER</b></td><td>Moradon</td><td>Game Server</td><td>EVT-A17F-44</td></tr><tr><td>20:54:18</td><td><b>ITEM_MOVE</b></td><td>Raptor +1</td><td>Inventory → Inn</td><td>ITM-7A1C</td></tr><tr><td>20:41:02</td><td><b>COIN_CHANGE</b></td><td>+250,000</td><td>NPC / transaction hook</td><td>COIN-31BD</td></tr><tr><td>20:21:55</td><td><b>LOGIN</b></td><td>${model.account}</td><td>Web 1298 client</td><td>SES-A17F</td></tr></tbody></table></section>`;
  }

  function renderSanctions(){
    panel('sanctions').innerHTML=`
      <div class="sanction-grid">
        <section class="subpanel"><div class="subpanel-head"><small>CURRENT PERMISSIONS</small><b>ACCOUNT / CHARACTER</b></div><div class="permission-list"><div class="permission-row"><span>Login / Connect</span><b>ALLOWED</b></div><div class="permission-row"><span>Chat</span><b>ALLOWED</b></div><div class="permission-row"><span>Trade</span><b>ALLOWED</b></div><div class="permission-row"><span>Merchant</span><b>ALLOWED</b></div></div></section>
        <section class="subpanel"><div class="subpanel-head"><small>ORIGINAL GM + EXTENDED OWNER ACTIONS</small><b>AUDITED</b></div><div class="sanction-buttons"><button class="warn" data-sanction="FORBIDCHAT">FORBID CHAT</button><button data-sanction="PERMITCHAT">PERMIT CHAT</button><button class="danger" data-sanction="FORBIDCONNECT">FORBID CONNECT</button><button class="danger" data-sanction="CUTOFF">CUTOFF SESSION</button><button class="warn" data-sanction="ARREST">ARREST</button><button class="danger" data-sanction="FORBIDUSER">FORBID USER</button></div><form class="owner-form" id="sanctionForm" style="margin-top:12px"><label class="span-2">Audit reason<textarea name="reason">ROOT OWNER moderation action</textarea></label></form></section>
      </div>`;
    panel('sanctions').querySelectorAll('[data-sanction]').forEach(btn=>btn.addEventListener('click',()=>admin.execute(btn.dataset.sanction,model.character,'')));
  }

  function bindLocalActions(root){
    root.querySelectorAll('[data-cc-action="teleport"]').forEach(btn=>btn.addEventListener('click',()=>admin.showToast('Teleport control',`Target ${model.character}; zone ${model.zoneId}; X ${model.x}; Z ${model.z}. Edit coordinates in Owner Mutation Console before applying.`)));
  }

  host.querySelectorAll('[data-cc-command]').forEach(btn=>btn.addEventListener('click',()=>admin.execute(btn.dataset.ccCommand,model.character,'')));
  host.querySelectorAll('[data-cc-action="teleport"]').forEach(btn=>btn.addEventListener('click',()=>admin.showToast('Teleport control','Open Overview → Owner Mutation Console to set zone and coordinates.')));
  host.querySelector('#ccTabs').addEventListener('click',e=>{
    const btn=e.target.closest('button[data-cc-tab]');if(!btn)return;
    host.querySelectorAll('#ccTabs button').forEach(x=>x.classList.toggle('active',x===btn));
    host.querySelectorAll('.char-tab-panel').forEach(x=>x.classList.toggle('active',x.dataset.ccPanel===btn.dataset.ccTab));
  });

  renderOverview();renderInventory();renderInn();renderStats();renderHistory();renderSanctions();
})();
