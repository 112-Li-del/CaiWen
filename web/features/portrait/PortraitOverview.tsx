"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowUpRight, BookOpen, GraduationCap, RefreshCw, ScanFace, Users, CalendarDays, Info } from "lucide-react";
import { apiUrl, apiFetch } from "@/lib/api";
import type { Catalog, Overview } from "./types";

const RadarPanel=dynamic(()=>import("./PortraitCharts").then(m=>m.RadarPanel),{ssr:false,loading:()=> <div className="h-[250px] animate-pulse rounded-xl bg-[var(--muted)]"/>});
const BehaviorPanel=dynamic(()=>import("./PortraitCharts").then(m=>m.BehaviorPanel),{ssr:false,loading:()=> <div className="h-[285px] animate-pulse rounded-xl bg-[var(--muted)]"/>});
const fmt=(n:number|null|undefined,digits=1)=>n==null?"—":Number(n.toFixed(digits)).toString();
const selectStyle="h-9 min-w-0 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-xs text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]";

async function read<T>(url:string,signal:AbortSignal):Promise<T> {
  const response=await apiFetch(apiUrl(url),{signal});
  if(!response.ok) {const error=await response.json().catch(()=>({}));throw new Error(error.detail??"加载失败，请稍后重试");}
  return response.json();
}

export default function PortraitOverview() {
  const [catalog,setCatalog]=useState<Catalog|null>(null);
  const [data,setData]=useState<Overview|null>(null);
  const [semester,setSemester]=useState<number|null>(null);
  const [dimension,setDimension]=useState<"student"|"class">("student");
  const [student,setStudent]=useState<number|null>(null);
  const [classId,setClassId]=useState<number|null>(null);
  const [mode,setMode]=useState<"date"|"semester">("date");
  const [days,setDays]=useState(30);
  const [refresh,setRefresh]=useState(0);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  useEffect(()=>{
    const ctrl=new AbortController();
    setLoading(true);setError("");setData(null);
    read<Catalog>(`/api/v1/portrait/catalog${semester?`?semester_id=${semester}`:""}`,ctrl.signal).then(result=>{
      setCatalog(result);
      if(!semester) setSemester(result.semester_id);
      if(!result.semester_id) setLoading(false);
    }).catch(e=>{if(!ctrl.signal.aborted){setError(e.message);setLoading(false);}});
    return ()=>ctrl.abort();
  },[semester,refresh]);
  useEffect(()=>{
    if(!catalog||!semester) return;
    const ctrl=new AbortController();setLoading(true);setError("");
    const params=new URLSearchParams({semester_id:String(semester),dimension,board_mode:mode,days:String(days)});
    if(student&&catalog.students.some(s=>s.id===student)) params.set("student_id",String(student));
    if(classId&&catalog.classes.some(c=>c.id===classId)) params.set("class_id",String(classId));
    read<Overview>(`/api/v1/portrait/overview?${params}`,ctrl.signal).then(setData).catch(e=>{if(!ctrl.signal.aborted){setError(e.message);setData(null);}}).finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
    return ()=>ctrl.abort();
  },[catalog,semester,dimension,student,classId,mode,days]);
  const profile=data?.profile;
  const card="rounded-2xl border border-[var(--border)] bg-[var(--card)]";
  return <div className="min-h-full bg-[var(--background)] text-[var(--foreground)]">
    <header className="flex min-h-20 flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--card)] px-5 py-4 lg:px-9">
      <div><div className="mb-1 text-[10px] font-medium tracking-[.2em] text-[var(--muted-foreground)]">CAIWEN / STUDENT PORTRAIT</div><h1 className="flex items-center gap-2 text-lg font-semibold"><ScanFace size={20} strokeWidth={1.6}/>学业画像</h1></div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="选择学期" value={semester??""} onChange={e=>{setSemester(Number(e.target.value));setStudent(null);setClassId(null);}} className={selectStyle}>
          {!catalog?.semesters.length&&<option value="">暂无学期</option>}{catalog?.semesters.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {dimension==="student"?<select aria-label="选择学生" className={selectStyle} value={student??data?.student_id??catalog?.students[0]?.id??""} onChange={e=>setStudent(Number(e.target.value))}>
          {!catalog?.students.length&&<option value="">暂无可查看档案</option>}{catalog?.students.map(s=><option key={s.id} value={s.id}>{s.name} · {s.class_name}</option>)}
        </select>:<select aria-label="选择班级" className={selectStyle} value={classId??data?.class_id??catalog?.classes[0]?.id??""} onChange={e=>setClassId(Number(e.target.value))}>{catalog?.classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>}
        <button aria-label="刷新画像数据" onClick={()=>setRefresh(x=>x+1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] hover:bg-[var(--muted)]"><RefreshCw size={15} className={loading?"animate-spin":""}/></button>
      </div>
    </header>
    <div className="mx-auto max-w-[1600px] space-y-5 p-4 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]"/>{catalog?.demo?"演示数据 · 全部为合成记录":"学生学业与行为分析"}<span className="hidden sm:inline">/</span><span className="hidden sm:inline">{data?.semester.name??"按学期查看"}</span></div>
        {catalog?.can_compare&&<div className="flex rounded-lg border border-[var(--border)] bg-[var(--card)] p-1" aria-label="画像维度">{([['student','学生'],['class','班级']] as const).map(([value,label])=><button key={value} aria-pressed={dimension===value} onClick={()=>setDimension(value)} className={`rounded-md px-4 py-1.5 text-xs transition-colors ${dimension===value?"bg-[var(--primary)] text-[var(--primary-foreground)]":"text-[var(--muted-foreground)] hover:bg-[var(--muted)]"}`}>{label}</button>)}</div>}
      </div>
      {error&&<div role="alert" className="rounded-xl border border-[var(--destructive)] bg-[var(--card)] p-5 text-sm text-[var(--destructive)]">{error}<button className="ml-3 underline" onClick={()=>setRefresh(x=>x+1)}>重新加载</button></div>}
      {loading&&!data&&!error&&<div className="flex min-h-[500px] items-center justify-center text-sm text-[var(--muted-foreground)]">正在读取画像数据…</div>}
      {!loading&&!semester&&!error&&<div className={`${card} p-12 text-center text-sm text-[var(--muted-foreground)]`}>尚未导入学期与师生数据，请联系管理员。</div>}
      {data&&<div aria-busy={loading} className={loading?"pointer-events-none opacity-50":""}>
        <div className="grid gap-5 xl:grid-cols-[330px_minmax(0,1fr)]">
          <aside className={`${card} min-w-0 p-6`}>
            <div className="mb-6 flex items-start justify-between"><div><p className="mb-1 text-xs text-[var(--muted-foreground)]">{dimension==="student"?"学生档案":"班级概况"}</p><h2 className="text-xl font-semibold">{data.title}</h2><p className="mt-1 text-xs text-[var(--muted-foreground)]">{profile?.student_no??`${data.summary.student_count} 位学生`}</p></div><span className="rounded-xl bg-[var(--accent)] p-2.5 text-[var(--chart-1)]">{dimension==="student"?<GraduationCap size={23}/>:<Users size={23}/>}</span></div>
            <h3 className="mb-3 text-xs font-semibold tracking-wide text-[var(--muted-foreground)]">学业表现</h3>
            <div className="grid grid-cols-2 gap-3"><Metric label={dimension==="student"?"已获得学分":"人均获得学分"} value={fmt(data.summary.passed_credits)}/><Metric label={dimension==="student"?"当前 GPA":"平均 GPA"} value={fmt(data.summary.gpa,2)}/><Metric label="平均成绩" value={fmt(data.summary.average)}/><Metric label="本学期课程" value={String(data.summary.course_count)} unit="门"/></div>
            <p className="mt-3 text-[10px] leading-5 text-[var(--muted-foreground)]">GPA：原项目绩点换算后算术平均，未按学分加权；当前统计首次考试。</p>
            <div className="mt-7 border-t border-[var(--border)] pt-5"><h3 className="mb-4 flex items-center gap-2 text-sm font-medium"><BookOpen size={15}/>课程清单<span className="ml-auto text-[10px] text-[var(--muted-foreground)]">课程总学分 {fmt(data.summary.total_credits)}</span></h3>
              <div className="overflow-x-auto"><table className="w-full text-xs">
                <thead><tr className="border-b border-[var(--border)] text-[10px] text-[var(--muted-foreground)]">
                  <th className="pb-2 text-left font-normal">课程</th>
                  <th className="whitespace-nowrap px-1 pb-2 text-right font-normal">课程学分</th>
                  <th className="whitespace-nowrap px-1 pb-2 text-right font-normal" title={dimension==="class"?"已录入该课程成绩学生的人均获得学分":"成绩及格后获得的学分"}>{dimension==="class"?"人均获得":"获得学分"}</th>
                  <th className="pb-2 text-right font-normal">{dimension==="class"?"均分":"成绩"}</th>
                </tr></thead>
                <tbody>{data.courses.map(course=><tr key={course.id} className="border-b border-[var(--border)]">
                  <td className="py-3 pr-2"><div>{course.name}</div><div className="mt-1 text-[9px] text-[var(--muted-foreground)]">{course.kind??"未分类"}</div></td>
                  <td className="px-1 text-right text-[var(--muted-foreground)]">{fmt(course.credits)}</td>
                  <td className={`px-1 text-right font-medium ${course.earned_credits===0?"text-[var(--destructive)]":"text-[var(--foreground)]"}`}>{fmt(course.earned_credits,2)}</td>
                  <td className="text-right"><span className={`rounded px-1.5 py-1 ${course.score!==null&&course.score/course.full_score<.6?"bg-[var(--muted)] text-[var(--destructive)]":"bg-[var(--muted)] text-[var(--chart-1)]"}`}>{course.score===null?({absent:"缺考",exempt:"免修",pending:"待录入"}[course.status]??"—"):fmt(course.score)}</span></td>
                </tr>)}</tbody>
              </table>{!data.courses.length&&<p className="py-4 text-[var(--muted-foreground)]">暂无课程成绩</p>}</div>
              <p className="mt-3 text-[10px] leading-5 text-[var(--muted-foreground)]">达到课程满分的 60% 才获得学分；未及格获得 0 学分，未录入不作判定。</p>
            </div>
            {profile&&<div className="mt-6 rounded-xl bg-[var(--muted)] p-4"><h3 className="mb-3 text-xs font-medium">在校信息</h3><dl className="space-y-3 text-xs">{[['学院',profile.college_name],['专业',profile.major_name],['班级',profile.class_name],['入学',profile.enrollment_date],['预计毕业',profile.graduation_date],['宿舍',profile.dormitory]].map(([label,value])=><div key={label} className="flex gap-3"><dt className="w-12 shrink-0 text-[var(--muted-foreground)]">{label}</dt><dd className="min-w-0 flex-1 break-words text-right text-[var(--muted-foreground)]">{value??"未录入"}</dd></div>)}</dl></div>}
          </aside>
          <div className="min-w-0 space-y-5">
            <div className="grid gap-5 lg:grid-cols-2">
              <section className={`${card} min-w-0 p-5`}><SectionTitle title="学业与行为雷达图" subtitle="固定刻度 · 原值可查看"/><RadarPanel data={data}/><p className="text-[10px] leading-5 text-[var(--muted-foreground)]">时长按 24 小时、活动按 30 次/月展示；面积不代表综合能力，数值越大不一定越好。</p></section>
              <section className={`${card} min-w-0 p-5`}><SectionTitle title="画像标签" subtitle="由成绩与行为记录生成"/>
                <div className="flex min-h-[250px] flex-wrap content-center items-center justify-center gap-x-5 gap-y-4 px-2 py-6" aria-label={dimension==="student"?"学生标签云":"班级标签云"}>{data.tags.map((tag,i)=><span key={tag.code} title={`${tag.name}：${tag.value}`} className={`inline-block leading-snug ${i%3===0?"text-[var(--chart-1)]":i%3===1?"text-[var(--chart-2)]":"text-[var(--chart-3)]"}`} style={{fontSize:tag.weight===3?27:tag.weight===2?19:13,fontWeight:tag.weight>=2?600:400}}>{tag.weight===3?`${tag.name}：${tag.value}`:tag.weight===2?tag.value:`${tag.name} ${tag.value}`}</span>)}{!data.tags.length&&<span className="text-sm text-[var(--muted-foreground)]">数据不足，暂未生成标签</span>}</div>
                <p className="text-[10px] leading-5 text-[var(--muted-foreground)]">标签使用可解释的统计与分档，不推断心理健康或学习能力。</p>
              </section>
            </div>
            <section className={`${card} min-w-0 p-5 sm:p-6`}>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><SectionTitle title="生活与学习看板" subtitle={mode==="date"?"实际记录日期 · 无课日不计出勤率":"各学期汇总 · 不补造每日记录"}/><div className="flex flex-wrap items-center gap-2">
                {mode==="date"&&<select aria-label="日期范围" value={days} onChange={e=>setDays(Number(e.target.value))} className={selectStyle}><option value={7}>最近 7 个记录日</option><option value={30}>最近 30 个记录日</option></select>}
                <div className="flex rounded-lg bg-[var(--muted)] p-1">{([['date','日期'],['semester','学期']] as const).map(([v,label])=><button key={v} onClick={()=>setMode(v)} aria-pressed={mode===v} className={`rounded-md px-3 py-1.5 text-xs ${mode===v?"bg-[var(--card)] text-[var(--primary)] shadow-sm":"text-[var(--muted-foreground)]"}`}>{label}</button>)}</div>
              </div></div><BehaviorPanel data={data}/>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3 text-[10px] text-[var(--muted-foreground)]"><span className="flex items-center gap-1.5"><CalendarDays size={12}/>{data.board.points[0]?.label??"暂无记录"} 至 {data.board.points.at(-1)?.label??"—"}</span><span>行为数据覆盖 {data.summary.behavior_coverage}/{data.summary.student_count} 人</span></div>
            </section>
            <div className="flex items-start gap-2 px-1 text-[11px] leading-6 text-[var(--muted-foreground)]"><Info size={14} className="mt-1 shrink-0"/><p>同一页面使用相同学期与档案范围。缺失值保留为空，演示记录不代表真实师生。</p></div>
          </div>
        </div>
        <footer className="flex items-center justify-between pb-2 text-[10px] text-[var(--muted-foreground)]"><span>南京财经大学 · 财问</span><span className="flex items-center gap-1">以数据了解成长 <ArrowUpRight size={12}/></span></footer>
      </div>}
    </div>
  </div>;
}

function Metric({label,value,unit}:{label:string;value:string;unit?:string}) {return <div className="rounded-xl bg-[var(--muted)] px-4 py-3"><p className="text-[10px] text-[var(--muted-foreground)]">{label}</p><p className="mt-1 text-2xl font-semibold tracking-tight text-[var(--foreground)]">{value}<span className="ml-1 text-xs font-normal text-[var(--muted-foreground)]">{unit}</span></p></div>;}
function SectionTitle({title,subtitle}:{title:string;subtitle:string}) {return <div className="mb-3"><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-[10px] text-[var(--muted-foreground)]">{subtitle}</p></div>;}
