"use client";

import { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { SplitText as GSAPSplitText } from "gsap/SplitText";

gsap.registerPlugin(GSAPSplitText);

interface SplitTextProps {
  text:string;
  className?:string;
  effect?:"rise"|"blur";
  delay?:number;
  duration?:number;
  startDelay?:number;
  hoverEffect?:"lift"|"none";
}

/** React Bits SplitText reveal/lift, using the project's existing GSAP runtime. */
export default function SplitText({text,className="",effect="rise",delay=30,duration=.65,startDelay=0,hoverEffect="lift"}:SplitTextProps) {
  const ref=useRef<HTMLSpanElement>(null);
  useLayoutEffect(()=>{
    const element=ref.current;
    if(!element||!text) return;
    const motion=window.matchMedia("(prefers-reduced-motion: reduce)");
    let alive=true;
    let split:GSAPSplitText|null=null;
    let intro:gsap.core.Tween|null=null;
    let observer:IntersectionObserver|null=null;
    let pieces:Element[]=[];
    let revealed=false;
    let centers:number[]=[];
    const em=parseFloat(getComputedStyle(element).fontSize)||16;
    const move=(event:PointerEvent)=>{
      if(!revealed||hoverEffect!=="lift"||event.pointerType==="touch") return;
      if(!centers.length) centers=pieces.map(piece=>{const box=piece.getBoundingClientRect();return box.left+box.width/2;});
      gsap.to(pieces,{
        y:(index:number)=>-em*.13*Math.exp(-.5*((centers[index]-event.clientX)/(em*1.15))**2),
        duration:.28,ease:"power3.out",overwrite:"auto",
      });
    };
    const leave=()=>{
      centers=[];
      if(revealed&&hoverEffect==="lift") gsap.to(pieces,{y:0,duration:.4,ease:"power3.out",overwrite:"auto",clearProps:"transform"});
    };
    const stop=()=>{
      observer?.disconnect();observer=null;
      intro?.kill();intro=null;
      gsap.killTweensOf(pieces);
      element.removeEventListener("pointermove",move);
      element.removeEventListener("pointerleave",leave);
      split?.revert();split=null;pieces=[];centers=[];revealed=false;
    };
    const start=()=>{
      stop();
      if(!alive||motion.matches) return;
      split=new GSAPSplitText(element,{type:"chars",smartWrap:true,charsClass:"split-char",aria:"auto",reduceWhiteSpace:false});
      pieces=split.chars;
      intro=gsap.fromTo(pieces,
        {opacity:0,y:em*.5,filter:effect==="blur"?"blur(3px)":"none",willChange:"transform,opacity"},
        {opacity:1,y:0,filter:"none",duration,delay:startDelay,ease:"power3.out",
          stagger:Math.min(delay/1000,.45/Math.max(1,pieces.length-1)),paused:true,
          clearProps:"transform,filter,willChange",onComplete:()=>{revealed=true;}},
      );
      observer=new IntersectionObserver(entries=>{
        if(entries.some(entry=>entry.isIntersecting)){
          intro?.play();observer?.disconnect();
        }
      },{threshold:.1});
      observer.observe(element);
      element.addEventListener("pointermove",move);
      element.addEventListener("pointerleave",leave);
    };
    const prepare=()=>{
      if(document.fonts?.status==="loading") void document.fonts.ready.then(()=>{if(alive)start();});
      else start();
    };
    prepare();
    motion.addEventListener("change",prepare);
    return ()=>{alive=false;motion.removeEventListener("change",prepare);stop();};
  },[text,effect,delay,duration,startDelay,hoverEffect]);

  return <span key={text} ref={ref} data-split-text="" className={`inline-block max-w-full align-baseline ${className}`}>{text}</span>;
}
