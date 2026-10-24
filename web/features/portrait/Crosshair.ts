import type { BarElement, Chart, Plugin } from "chart.js";

type Box = {x:number;y:number;width:number;height:number};
type State = {
  frame:number; last:number; inside:boolean; opacity:number; lockOpacity:number;
  x:number;y:number; targetX:number;targetY:number;
  box:Box; target:Box|null; initialized:boolean;
};
const states=new WeakMap<Chart<"bar">,State>();

function stateFor(chart:Chart<"bar">):State {
  let state=states.get(chart);
  if(!state){
    state={frame:0,last:0,inside:false,opacity:0,lockOpacity:0,x:0,y:0,targetX:0,targetY:0,
      box:{x:0,y:0,width:0,height:0},target:null,initialized:false};
    states.set(chart,state);
  }
  return state;
}

function reset(chart:Chart<"bar">) {
  const state=states.get(chart);
  if(state) cancelAnimationFrame(state.frame);
  states.delete(chart);
}

function wake(chart:Chart<"bar">,state:State) {
  if(state.frame) return;
  state.last=performance.now();
  const tick=(now:number)=>{
    state.frame=0;
    const dt=Math.min(.05,Math.max(.001,(now-state.last)/1000));
    state.last=now;
    const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const follow=reduced?1:1-Math.exp(-dt/.064);
    const snap=reduced?1:1-Math.exp(-dt/.085);
    const wanted=state.inside?1:0;
    state.opacity+=(wanted-state.opacity)*(reduced?1:1-Math.exp(-dt/.12));
    if(Math.abs(wanted-state.opacity)<.002) state.opacity=wanted;
    const locked=state.inside&&state.target?1:0;
    state.lockOpacity+=(locked-state.lockOpacity)*(reduced?1:1-Math.exp(-dt/.1));
    if(Math.abs(locked-state.lockOpacity)<.002) state.lockOpacity=locked;
    state.x+=(state.targetX-state.x)*follow;
    state.y+=(state.targetY-state.y)*follow;
    if(state.target){
      for(const key of ["x","y","width","height"] as const)
        state.box[key]+=(state.target[key]-state.box[key])*snap;
    }
    chart.draw();
    const settling=Math.abs(state.x-state.targetX)+Math.abs(state.y-state.targetY)>.1
      || state.opacity!==wanted || state.lockOpacity!==locked
      || !!state.target&&(["x","y","width","height"] as const).some(key=>Math.abs(state.target![key]-state.box[key])>.1);
    if(settling) state.frame=requestAnimationFrame(tick);
  };
  state.frame=requestAnimationFrame(tick);
}

/** React Bits Crosshair lock effect, adapted to Chart.js bar geometry rather than DOM targets. */
export const barCrosshair:Plugin<"bar">={
  id:"portraitBarCrosshair",
  beforeUpdate:reset,
  resize:reset,
  afterDestroy:reset,
  afterEvent(chart,{event}) {
    const state=stateFor(chart);
    const {left,right,top,bottom}=chart.chartArea;
    const {x,y}=event;
    if(event.type==="mouseout"||x===null||y===null||x<left||x>right||y<top||y>bottom){
      state.inside=false;
      wake(chart,state);
      return;
    }
    state.inside=true;
    state.targetX=x;
    state.targetY=y;
    if(!state.initialized){
      state.x=x;state.y=y;
      state.box={x:x-10,y:y-10,width:20,height:20};
      state.initialized=true;
    }
    state.target=null;
    const meta=chart.getDatasetMeta(0);
    if(!meta.visible){wake(chart,state);return;}
    const bars=meta.data as BarElement[];
    let index=-1;
    let distance=Infinity;
    bars.forEach((bar,i)=>{
      if(Math.abs(bar.x-x)<distance){distance=Math.abs(bar.x-x);index=i;}
    });
    const bar=bars[index];
    const value=chart.data.datasets[0]?.data[index];
    // A missing attendance value is not a zero-height bar and must not be framed.
    if(!bar||typeof value!=="number"||!Number.isFinite(value)){
      wake(chart,state);return;
    }
    const padding=4;
    const geometry=bar.getProps(["x","y","width","base"],false);
    if(geometry.x===null||geometry.y===null||Math.abs(geometry.x-x)>geometry.width/2||y>geometry.base){
      wake(chart,state);return;
    }
    const boxLeft=Math.max(left,geometry.x-geometry.width/2-padding);
    const boxRight=Math.min(right,geometry.x+geometry.width/2+padding);
    const boxTop=Math.max(top,Math.min(geometry.y,geometry.base)-padding);
    const boxBottom=Math.min(bottom,Math.max(geometry.y,geometry.base)+padding);
    state.target={x:boxLeft,y:boxTop,width:boxRight-boxLeft,height:boxBottom-boxTop};
    state.targetX=bar.x;
    wake(chart,state);
  },
  // Draw before Chart.js paints its tooltip, so the frame never obscures the data labels.
  afterDatasetsDraw(chart) {
    const state=states.get(chart);
    if(!state||state.opacity===0) return;
    const {ctx,chartArea:{left,right,top,bottom}}=chart;
    const bar=chart.getDatasetMeta(0).data[0] as BarElement|undefined;
    if(!bar) return;
    const color=bar.options.borderColor;
    const {x,y,width:w,height:h}=state.box;
    ctx.save();
    ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
    ctx.strokeStyle=color;
    ctx.fillStyle=color;
    ctx.globalAlpha=state.lockOpacity*.08;
    ctx.fillRect(x,y,w,h);
    ctx.globalAlpha=state.opacity*(.55-.25*state.lockOpacity);
    ctx.lineWidth=1;
    ctx.setLineDash([3,4]);
    ctx.beginPath();
    ctx.moveTo(state.x,top);ctx.lineTo(state.x,bottom);
    ctx.moveTo(left,state.y);ctx.lineTo(right,state.y);
    ctx.stroke();
    ctx.globalAlpha=state.lockOpacity*.9;
    ctx.lineWidth=1.5;
    ctx.lineCap="square";
    ctx.setLineDash([]);
    const arm=Math.min(12,w/3,h/3);
    ctx.beginPath();
    ctx.moveTo(x,y+arm);ctx.lineTo(x,y);ctx.lineTo(x+arm,y);
    ctx.moveTo(x+w-arm,y);ctx.lineTo(x+w,y);ctx.lineTo(x+w,y+arm);
    ctx.moveTo(x+w,y+h-arm);ctx.lineTo(x+w,y+h);ctx.lineTo(x+w-arm,y+h);
    ctx.moveTo(x+arm,y+h);ctx.lineTo(x,y+h);ctx.lineTo(x,y+h-arm);
    ctx.stroke();
    ctx.restore();
  },
};
