"use client";

import { useEffect, useRef } from "react";
import { Chart as ChartJS, BarController, LineController, CategoryScale, LinearScale, RadialLinearScale, PointElement, LineElement, BarElement, Filler, Tooltip, Legend } from "chart.js";
import { Radar, Chart } from "react-chartjs-2";
import type { Plugin } from "chart.js";
import type { Overview } from "./types";
import { useChartPalette } from "./useChartPalette";
import { barCrosshair } from "./Crosshair";

ChartJS.register(BarController, LineController, CategoryScale, LinearScale, RadialLinearScale, PointElement, LineElement, BarElement, Filler, Tooltip, Legend);
const number=(v:number|null)=>v===null?"未采集":String(v);

const radarBoundary: Plugin<"radar"> = {
  id: "radarBoundary",
  beforeEvent(chart, { event }) {
    if (event.type === "mouseout") return;
    const scale = chart.scales.r as RadialLinearScale;
    const vertices = chart.data.labels!.map((_, index) =>
      scale.getPointPositionForValue(index, scale.max),
    );
    const { x, y } = event;
    const inside = x !== null && y !== null && vertices.every((a, index) => {
      const b = vertices[(index + 1) % vertices.length];
      return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) >= -0.01;
    });
    // Chart.js retains the last tooltip outside its rectangular chart area.
    // Treat leaving the radar polygon as leaving the chart to clear it immediately.
    if (!inside) event.type = "mouseout";
  },
};

export function RadarPanel({data}:{data:Overview}) {
  const palette=useChartPalette();
  const chartRef=useRef<ChartJS<"radar">|null>(null);
  useEffect(()=>{
    const chart=chartRef.current;
    if(!chart) return;
    // Restart from the center after the initial palette update and canvas layout.
    chart.stop();chart.reset();chart.draw();
    let frame=requestAnimationFrame(()=>{
      frame=requestAnimationFrame(()=>{
        chart.stop();chart.reset();chart.update();
      });
    });
    return ()=>cancelAnimationFrame(frame);
  },[data.radar,palette.first]);
  const labels=data.radar.map(x=>x.label);
  if(data.radar.filter(x=>x.value!==null).length<3) return <div className="flex h-60 items-center justify-center text-sm text-[var(--muted-foreground)]">有效维度不足，暂不绘制雷达图</div>;
  return <div className="h-[250px]" role="img" aria-label={data.radar.map(x=>`${x.label} ${number(x.raw)} ${x.unit}`).join("，")}>
    <Radar ref={chartRef} plugins={[radarBoundary]} data={{labels,datasets:[{label:data.title,data:data.radar.map(x=>x.value),backgroundColor:`${palette.first}22`,borderColor:palette.first,pointBackgroundColor:palette.first,pointRadius:3,borderWidth:1.8,spanGaps:false}]}}
      options={{responsive:true,maintainAspectRatio:false,animation:{duration:1000,easing:"easeOutQuart"},interaction:{mode:"nearest",axis:"xy",intersect:false},plugins:{legend:{display:false},tooltip:{backgroundColor:palette.surface,titleColor:palette.foreground,bodyColor:palette.foreground,borderColor:palette.grid,borderWidth:1,callbacks:{label:context=>{const p=data.radar[context.dataIndex];return `${p.label}：${number(p.raw)} ${p.unit}（图示上限 ${p.maximum}）`;}}}},scales:{r:{min:0,max:100,ticks:{stepSize:25,display:false},grid:{color:palette.grid},angleLines:{color:palette.grid},pointLabels:{color:palette.text,font:{size:11}}}}}} />
  </div>;
}

export function BehaviorPanel({data}:{data:Overview}) {
  const palette=useChartPalette();
  const points=data.board.points;
  if(!points.length) return <div className="flex h-[280px] items-center justify-center text-sm text-[var(--muted-foreground)]">当前范围没有记录，可以切换到学期查看</div>;
  return <div className="h-[285px]" role="img" aria-label={`${data.board.mode==="date"?"日期":"学期"}看板，${points.length}个时间点，出勤率、学习、睡眠及上网时长`}>
    <Chart type="bar" plugins={[barCrosshair]} data={{labels:points.map(p=>data.board.mode==="date"?p.label.slice(5):p.label),datasets:[
      {type:"bar",label:"出勤率 (%)",data:points.map(p=>p.attendance),backgroundColor:`${palette.first}55`,borderColor:palette.first,borderWidth:0,borderRadius:3,yAxisID:"attendance",maxBarThickness:20},
      {type:"line",label:"学习 (小时/日)",data:points.map(p=>p.study),borderColor:palette.second,backgroundColor:palette.second,yAxisID:"hours",pointRadius:points.length>14?1.5:3,borderWidth:2,tension:0,spanGaps:false},
      {type:"line",label:"睡眠 (小时/日)",data:points.map(p=>p.sleep),borderColor:palette.third,backgroundColor:palette.third,yAxisID:"hours",pointRadius:points.length>14?1.5:3,borderWidth:1.8,tension:0,spanGaps:false},
      {type:"line",label:"上网 (小时/日)",data:points.map(p=>p.internet),borderColor:palette.fourth,backgroundColor:palette.fourth,yAxisID:"hours",pointRadius:points.length>14?1.5:3,borderWidth:1.8,tension:0,borderDash:[4,4],spanGaps:false},
    ]}} options={{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:"index",intersect:false},plugins:{legend:{position:"bottom",labels:{color:palette.text,usePointStyle:true,boxWidth:8,font:{size:10},padding:16}},tooltip:{backgroundColor:palette.surface,titleColor:palette.foreground,bodyColor:palette.foreground,borderColor:palette.grid,borderWidth:1,callbacks:{title:items=>points[items[0].dataIndex].label}}},scales:{x:{grid:{display:false},ticks:{color:palette.text,maxTicksLimit:8,font:{size:10}}},attendance:{position:"left",min:0,max:100,title:{display:true,text:"出勤率 %",color:palette.text,font:{size:10}},grid:{color:palette.grid},ticks:{color:palette.text,stepSize:25,font:{size:10}}},hours:{position:"right",min:0,max:24,title:{display:true,text:"小时 / 日",color:palette.text,font:{size:10}},grid:{drawOnChartArea:false},ticks:{color:palette.text,stepSize:6,font:{size:10}}}}}} />
  </div>;
}
