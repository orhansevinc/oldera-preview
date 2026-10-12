// OldERA 1298 engine port — player movement translated from GameProcMain.cpp / PlayerMySelf.cpp.
// Renderer independent. World collision is supplied through an adapter.
export const MOVE_SPEED_WHEN_WALK = 1.5;
export const MOVE_DELTA_WHEN_RUNNING = 3.0;
export const KEY_ROTATE_RAD_PER_SEC = Math.PI / 3; // GameProcMain: 60 degrees/sec.

export const MoveState = Object.freeze({ STOP:0, WALK:1, RUN:2, WALK_BACKWARD:3 });

function wrapAngle(a){
  const tau=Math.PI*2;
  while(a>=tau)a-=tau;
  while(a<=-tau)a+=tau;
  return a;
}

export class Player1298 {
  constructor({x=336,y=0,z=398,yaw=Math.PI,moveDelta=1}={}){
    this.position={x,y,z};
    this.yaw=yaw;
    this.moveDelta=moveDelta;
    this.state=MoveState.STOP;
    this.running=false;
    this.moveContinuous=false;
    this.moveSpeedPerSec=0;
    this.yNext=y;
  }

  toggleRun(){
    this.running=!this.running;
    if(this.state===MoveState.WALK && this.running)this.state=MoveState.RUN;
    else if(this.state===MoveState.RUN && !this.running)this.state=MoveState.WALK;
    return this.running;
  }

  rotate(deltaPerSec,dt){
    this.yaw=wrapAngle(this.yaw+deltaPerSec*dt);
  }

  commandForward(start=false){
    if(start)this.moveContinuous=true;
    this.state=this.running?MoveState.RUN:MoveState.WALK;
  }

  commandBackward(start=false){
    if(start)this.moveContinuous=true;
    this.state=MoveState.WALK_BACKWARD;
  }

  commandStop(){
    this.state=MoveState.STOP;
    this.moveContinuous=false;
    this.moveSpeedPerSec=0;
  }

  speedForState(){
    let s=MOVE_SPEED_WHEN_WALK;
    if(this.state===MoveState.RUN)s*=MOVE_DELTA_WHEN_RUNNING;
    else if(this.state===MoveState.STOP)s=0;
    else if(this.state===MoveState.WALK_BACKWARD)s*=-1;
    return s*this.moveDelta;
  }

  // Mirrors the important order in CPlayerMySelf::CheckCollision:
  // 1. next position from yaw/speed/frame time
  // 2. terrain bounds
  // 3. shape collision
  // 4. terrain/shape height selection
  // 5. apply position only after checks succeed.
  tick(dt,world){
    let speed=this.speedForState();
    this.moveSpeedPerSec=speed;
    if(!speed||!world)return {moved:false,blocked:false,speed:0};

    const dir={x:Math.sin(this.yaw),y:0,z:Math.cos(this.yaw)};
    const frameSpeed=Math.abs(speed)*dt;
    if(speed<0){dir.x*=-1;dir.z*=-1;}
    const next={x:this.position.x+dir.x*frameSpeed,y:this.position.y,z:this.position.z+dir.z*frameSpeed};

    if(!world.isInTerrain(next.x,next.z,this.position)){
      this.moveSpeedPerSec=0;
      return {moved:false,blocked:true,reason:'terrain-bounds',speed:0};
    }

    // Original client tests objects from roughly 0.5 m above the player's feet.
    if(world.checkShapeCollision?.({x:this.position.x,y:this.position.y+0.5,z:this.position.z},dir,frameSpeed)){
      this.moveSpeedPerSec=0;
      return {moved:false,blocked:true,reason:'shape',speed:0};
    }

    const terrainY=world.getTerrainHeight(next.x,next.z);
    const climb=world.getNearestShapeHeight?.(next,dt*30) ?? -Number.MAX_VALUE;
    let yNext=terrainY;
    if(Number.isFinite(climb) && climb>terrainY && climb<next.y+(30*dt*.5)) yNext=climb;
    else if(world.checkTerrainIncline?.(next,dir)){
      this.moveSpeedPerSec=0;
      return {moved:false,blocked:true,reason:'incline',speed:0};
    }

    this.position.x=next.x;
    this.position.y=yNext;
    this.position.z=next.z;
    this.yNext=yNext;
    return {moved:true,blocked:false,speed:this.moveSpeedPerSec};
  }
}

export class Input1298 {
  constructor(){this.down=new Set();this.pressed=new Set();this.released=new Set();}
  keyDown(code){if(!this.down.has(code))this.pressed.add(code);this.down.add(code);}
  keyUp(code){if(this.down.has(code))this.released.add(code);this.down.delete(code);}
  endFrame(){this.pressed.clear();this.released.clear();}
  held(...codes){return codes.some(k=>this.down.has(k));}
  hit(...codes){return codes.some(k=>this.pressed.has(k));}
  lifted(...codes){return codes.some(k=>this.released.has(k));}
}

// GameProcMain keyboard order, renderer/DOM agnostic.
export function processMovementInput(player,input,dt,{uiConsumesKeyboard=false}={}){
  if(uiConsumesKeyboard)return;
  if(input.held('ArrowLeft','KeyA'))player.rotate(-KEY_ROTATE_RAD_PER_SEC,dt);
  if(input.held('ArrowRight','KeyD'))player.rotate(KEY_ROTATE_RAD_PER_SEC,dt);

  if(input.held('ArrowUp','KeyW'))player.commandForward(input.hit('ArrowUp','KeyW'));
  else if(input.held('ArrowDown','KeyS'))player.commandBackward(input.hit('ArrowDown','KeyS'));
  else if(input.lifted('ArrowUp','KeyW','ArrowDown','KeyS'))player.commandStop();

  if(input.hit('KeyR'))player.toggleRun();
}
