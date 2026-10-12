(()=>{'use strict';
addEventListener('click',e=>{if(!document.getElementById('world')?.classList.contains('on'))return;const b=e.target?.closest?.('[data-uiid="btn_option" i]');if(!b)return;e.preventDefault();e.stopImmediatePropagation();window.OldERAWorld?.togglePanel?.('command')},true);
})();
