"use client";

import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";
import styles from "./BorderGlow.module.css";

/** React Bits BorderGlow, adapted to semantic card surfaces and CaiWen's six themes. */
export default function BorderGlow({children,className=""}:{children:ReactNode;className?:string}) {
  const ref=useRef<HTMLElement>(null);
  const frame=useRef(0);
  const pointer=useRef({x:0,y:0});
  useEffect(()=>()=>cancelAnimationFrame(frame.current),[]);

  const move=(event:PointerEvent<HTMLElement>)=>{
    if(event.pointerType==="touch") return;
    const card=ref.current;
    if(!card) return;
    card.dataset.glowHovered="true";
    if(window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    pointer.current={x:event.clientX,y:event.clientY};
    if(frame.current) return;
    frame.current=requestAnimationFrame(()=>{
      frame.current=0;
      const rect=card.getBoundingClientRect();
      if(!rect.width||!rect.height) return;
      const x=pointer.current.x-rect.left,y=pointer.current.y-rect.top;
      const dx=x-rect.width/2,dy=y-rect.height/2;
      const edge=Math.min(1,Math.max(Math.abs(dx)/(rect.width/2),Math.abs(dy)/(rect.height/2)));
      card.style.setProperty("--glow-x",`${x}px`);
      card.style.setProperty("--glow-y",`${y}px`);
      card.style.setProperty("--glow-angle",`${Math.atan2(dy,dx)*180/Math.PI+90}deg`);
      card.style.setProperty("--glow-edge",String(edge));
    });
  };
  const leave=()=>{
    cancelAnimationFrame(frame.current);frame.current=0;
    if(ref.current) delete ref.current.dataset.glowHovered;
  };
  return <section ref={ref} className={`${styles.card} ${className}`} data-border-glow=""
    onPointerEnter={move} onPointerMove={move} onPointerLeave={leave} onPointerCancel={leave}>
    <span aria-hidden="true" className={styles.wash}/>
    <span aria-hidden="true" className={styles.direction}><span className={styles.edge}/></span>
    <span aria-hidden="true" className={styles.halo}/>
    {children}
  </section>;
}
