// KO 1298 UI uses a 1024x768 virtual screen in this client build.
// Keep a single uniform scale: never stretch X and Y independently.
export const VIRTUAL_WIDTH=1024;
export const VIRTUAL_HEIGHT=768;

export function fitVirtualScreen(width,height){
  const scale=Math.min(width/VIRTUAL_WIDTH,height/VIRTUAL_HEIGHT);
  const renderWidth=VIRTUAL_WIDTH*scale;
  const renderHeight=VIRTUAL_HEIGHT*scale;
  return {
    scale,
    width:renderWidth,
    height:renderHeight,
    left:(width-renderWidth)/2,
    top:(height-renderHeight)/2
  };
}

export function clientToVirtual(clientX,clientY,fit){
  return {
    x:(clientX-fit.left)/fit.scale,
    y:(clientY-fit.top)/fit.scale,
    inside:clientX>=fit.left&&clientX<=fit.left+fit.width&&clientY>=fit.top&&clientY<=fit.top+fit.height
  };
}

export function applyVirtualScreen(element,width=innerWidth,height=innerHeight){
  const f=fitVirtualScreen(width,height);
  element.style.width=VIRTUAL_WIDTH+'px';
  element.style.height=VIRTUAL_HEIGHT+'px';
  element.style.left='50%';
  element.style.top='50%';
  element.style.transformOrigin='center center';
  element.style.transform=`translate(-50%,-50%) scale(${f.scale})`;
  return f;
}
