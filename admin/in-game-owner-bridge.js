(function(global){
  'use strict';

  const ROOT_AUTHORITY='ROOT_OWNER';
  const PLAYER_COMMANDS=new Set(['ARREST','FORBIDCONNECT','FORBIDCHAT','PERMITCHAT','CUTOFF','VIEW','FORBIDUSER','SUMMONUSER']);
  const WORLD_COMMANDS=new Set(['CLEAN','RAINING','SNOWING','TIME','ATTACKDISABLE','ATTACKENABLE']);
  const GLOBAL_COMMANDS=new Set(['COUNT','NOTICE','NOTICEALL','INVISIBLE','UNVIEW','PROGRAMLISTCHECK']);

  class OldERAOwnerBridge{
    constructor(options={}){
      this.endpoint=options.endpoint||'/api/admin/commands';
      this.authority=options.authority||null;
      this.character=options.character||null;
      this.selectedTarget=null;
      this.enabled=this.authority===ROOT_AUTHORITY;
    }

    setSession(session){
      this.authority=session?.authority||null;
      this.character=session?.character||null;
      this.enabled=this.authority===ROOT_AUTHORITY;
      if(!this.enabled) this.selectedTarget=null;
      return this.enabled;
    }

    setSelectedTarget(target){
      if(!this.enabled) return false;
      this.selectedTarget=target?.name||target||null;
      return Boolean(this.selectedTarget);
    }

    can(command){
      return this.enabled&&(PLAYER_COMMANDS.has(command)||WORLD_COMMANDS.has(command)||GLOBAL_COMMANDS.has(command));
    }

    async execute(command,{target,arg='',reason='In-game owner action'}={}){
      if(!this.can(command)) throw new Error('ROOT OWNER authority required');
      const resolvedTarget=target||this.selectedTarget||'';
      if(PLAYER_COMMANDS.has(command)&&!resolvedTarget) throw new Error(`${command} requires a target player`);

      const payload={
        command,
        target:resolvedTarget,
        arg,
        reason,
        source:'in-game-owner',
        actorCharacter:this.character
      };

      const response=await fetch(this.endpoint,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        credentials:'include',
        body:JSON.stringify(payload)
      });
      if(!response.ok) throw new Error(`Owner command failed (${response.status})`);
      return response.json();
    }

    getContextActions(){
      if(!this.enabled) return [];
      return [
        {id:'owner-view',label:'VIEW',command:'VIEW',requiresTarget:true},
        {id:'owner-summon',label:'SUMMON',command:'SUMMONUSER',requiresTarget:true},
        {id:'owner-arrest',label:'ARREST',command:'ARREST',requiresTarget:true},
        {id:'owner-mute',label:'MUTE',command:'FORBIDCHAT',requiresTarget:true},
        {id:'owner-unmute',label:'PERMIT CHAT',command:'PERMITCHAT',requiresTarget:true},
        {id:'owner-cutoff',label:'DISCONNECT',command:'CUTOFF',requiresTarget:true}
      ];
    }
  }

  global.OldERAOwnerBridge=OldERAOwnerBridge;
})(window);
