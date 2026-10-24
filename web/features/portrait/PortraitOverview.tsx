"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { BookOpen, RefreshCw, ScanFace, CalendarDays } from "lucide-react";
import { apiUrl, apiFetch } from "@/lib/api";
import type { Catalog, Overview } from "./types";
import PeoplePicker from "./PeoplePicker";
import SplitText from "@/components/ui/SplitText";
import BorderGlow from "@/components/ui/BorderGlow";

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
  const [semester,setSemester]=useState<number|null>(null);
  const [teacherId,setTeacherId]=useState<number|null>(null);
  const [selectedDimension,setDimension]=useState<"student"|"class">("student");
  const [student,setStudent]=useState<number|null>(null);
  const [studentLabel,setStudentLabel]=useState("");
  const [classId,setClassId]=useState<number|null>(null);
  const [mode,setMode]=useState<"date"|"semester">("date");
  const [days,setDays]=useState(30);
  const [refresh,setRefresh]=useState(0);
  const catalogParams=new URLSearchParams();
  if(semester) catalogParams.set("semester_id",String(semester));
  if(teacherId) catalogParams.set("teacher_id",String(teacherId));
  const catalogUrl=`/api/v1/portrait/catalog?${catalogParams}`;
  const catalogKey=`${catalogUrl}:${refresh}`;
  const [catalogResponse,setCatalogResponse]=useState<{key:string;data?:Catalog;error?:string}|null>(null);
  const catalog=catalogResponse?.key===catalogKey?catalogResponse.data:null;
  const activeSemester=semester??catalog?.semester_id??null;
  const dimension=selectedDimension;
  const params=new URLSearchParams({semester_id:String(activeSemester),dimension,board_mode:mode,days:String(days)});
  if(student&&dimension==="student") params.set("student_id",String(student));
  if(classId&&dimension!=="student") params.set("class_id",String(classId));
  if(teacherId) params.set("teacher_id",String(teacherId));
  const overviewUrl=`/api/v1/portrait/overview?${params}`;
  const overviewKey=`${catalogKey}:${overviewUrl}`;
  const [overviewResponse,setOverviewResponse]=useState<{key:string;data?:Overview;error?:string}|null>(null);
  const currentOverview=catalog&&overviewResponse?.key===overviewKey?overviewResponse:null;
  const data=currentOverview?.data;
  const courseListRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const list=courseListRef.current;
    const table=list?.querySelector("table");
    if(!list||!table) return;
    const measure=()=>{
      const rows=Array.from(table.tBodies[0]?.rows??[]);
      list.style.maxHeight=rows.length>5
        ? `${(table.tHead?.getBoundingClientRect().height??0)+rows.slice(0,5).reduce((height,row)=>height+row.getBoundingClientRect().height,0)}px`
        : "";
    };
    const observer=new ResizeObserver(measure);
    observer.observe(table);
    measure();
    return ()=>observer.disconnect();
  },[data?.courses]);
  const error=(catalogResponse?.key===catalogKey?catalogResponse.error:null)??currentOverview?.error??"";
  const loading=!error&&(!catalog||!!activeSemester&&!currentOverview);
  useEffect(()=>{
    const ctrl=new AbortController();
    read<Catalog>(catalogUrl,ctrl.signal).then(data=>{
      if(!ctrl.signal.aborted) setCatalogResponse({key:catalogKey,data});
    }).catch(e=>{if(!ctrl.signal.aborted)setCatalogResponse({key:catalogKey,error:e.message});});
    return ()=>ctrl.abort();
  },[catalogUrl,catalogKey]);
  useEffect(()=>{
    if(!catalog||!activeSemester) return;
    const ctrl=new AbortController();
    read<Overview>(overviewUrl,ctrl.signal).then(data=>{
      if(!ctrl.signal.aborted)setOverviewResponse({key:overviewKey,data});
    }).catch(e=>{if(!ctrl.signal.aborted)setOverviewResponse({key:overviewKey,error:e.message});});
    return ()=>ctrl.abort();
  },[catalog,activeSemester,overviewUrl,overviewKey]);
  const profile=data?.profile;
  const card="rounded-2xl border border-[var(--border)] bg-[var(--card)]";
  return <div className="min-h-full bg-[var(--background)] text-[var(--foreground)]">
    <header className="flex min-h-20 flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--card)] px-5 py-4 lg:px-9">
      <div><div className="mb-1 text-[10px] font-medium tracking-[.2em] text-[var(--muted-foreground)]">CAIWEN / STUDENT PORTRAIT</div><h1 className="flex items-center gap-2 text-lg font-semibold"><ScanFace size={20} strokeWidth={1.6}/><SplitText text="学业画像" delay={50}/></h1></div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="选择学期" value={activeSemester??""} onChange={e=>{setSemester(Number(e.target.value));setStudent(null);setStudentLabel("");setClassId(null);}} className={selectStyle}>
          {!catalog?.semesters.length&&<option value="">暂无学期</option>}{catalog?.semesters.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {catalog?.can_compare&&<PeoplePicker key={`${activeSemester}:${teacherId}:${refresh}`} catalog={catalog} teacherId={teacherId}
          label={dimension==="student"?(studentLabel||data?.title||catalog.first_student?.name||"搜索学生或教师"):(catalog.teacher?`${catalog.teacher.name} · 查找学生`:"搜索学生或教师")}
          onStudent={person=>{setStudent(person.id);setStudentLabel(`${person.name} · ${person.class_name}`);setClassId(null);setDimension("student");}}
          onTeacher={person=>{setTeacherId(person.id);setStudent(null);setStudentLabel("");setClassId(null);setDimension("student");}}/>}
        {catalog?.can_compare&&dimension!=="student"&&<select aria-label="选择班级" className={selectStyle} value={classId??(dimension==="class"?data?.class_id??catalog.classes[0]?.id??"":"")} onChange={e=>setClassId(e.target.value?Number(e.target.value):null)}>
          {catalog.classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>}
        <button aria-label="刷新画像数据" onClick={()=>setRefresh(x=>x+1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] hover:bg-[var(--muted)]"><RefreshCw size={15} className={loading?"animate-spin":""}/></button>
      </div>
    </header>
    <div className="mx-auto max-w-[1600px] space-y-5 p-4 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]"/><span>{data?.semester.name??"按学期查看"}</span></div>
        {catalog?.can_compare&&<div className="flex rounded-lg border border-[var(--border)] bg-[var(--card)] p-1" aria-label="画像维度">{([['student','学生'],['class','班级']] as const).map(([value,label])=><button key={value} aria-pressed={dimension===value} onClick={()=>{setDimension(value);setClassId(null);}} className={`rounded-md px-4 py-1.5 text-xs transition-colors ${dimension===value?"bg-[var(--primary)] text-[var(--primary-foreground)]":"text-[var(--muted-foreground)] hover:bg-[var(--muted)]"}`}>{label}</button>)}</div>}
      </div>
      {catalog?.teacher&&<div className={`${card} flex flex-wrap items-center justify-between gap-3 px-5 py-4`}>
        <div><p className="text-sm font-medium">正在查看：{catalog.teacher.name}<span className="ml-3 text-xs font-normal text-[var(--muted-foreground)]">{catalog.teacher.teacher_no} · {catalog.teacher.college_name}</span></p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">管理 {catalog.teacher.class_count} 个班级 · {catalog.teacher.student_count} 名学生 · 按当前学期分配范围查看</p></div>
        <div className="flex items-center gap-4">
          {catalog.can_select_teacher&&<button type="button" onClick={()=>{setTeacherId(null);setStudent(null);setStudentLabel("");setClassId(null);setDimension("student");}} className="text-xs text-[var(--muted-foreground)]">返回全部</button>}</div>
      </div>}
      {error&&<div role="alert" className="rounded-xl border border-[var(--destructive)] bg-[var(--card)] p-5 text-sm text-[var(--destructive)]">{error}<button className="ml-3 underline" onClick={()=>setRefresh(x=>x+1)}>重新加载</button></div>}
      {loading&&!data&&!error&&<div className="flex min-h-[500px] items-center justify-center text-sm text-[var(--muted-foreground)]">正在读取画像数据…</div>}
      {!loading&&!activeSemester&&!error&&<div className={`${card} p-12 text-center text-sm text-[var(--muted-foreground)]`}>尚未导入学期与师生数据，请联系管理员。</div>}
      {data&&<div aria-busy={loading} className={loading?"pointer-events-none opacity-50":""}>
        <div className="grid gap-5 xl:grid-cols-[330px_minmax(0,1fr)]">
          <aside className={`${card} min-w-0 p-6`}>
            <div className="mb-6 flex items-start justify-between"><div><p className="mb-1 text-xs text-[var(--muted-foreground)]">{dimension==="student"?"学生档案":"班级概况"}</p><h2 className="text-xl font-semibold"><SplitText text={data.title} effect="blur" delay={35}/></h2><p className="mt-1 text-xs text-[var(--muted-foreground)]">{profile?.student_no??`${data.summary.student_count} 位学生`}</p></div></div>
            <h3 className="mb-3 text-xs font-semibold tracking-wide text-[var(--muted-foreground)]"><SplitText text="学业表现"/></h3>
            <div className="grid grid-cols-2 gap-3"><Metric label={dimension==="student"?"已获得学分":"人均获得学分"} value={fmt(data.summary.passed_credits)}/><Metric label={dimension==="student"?"当前 GPA":"平均 GPA"} value={fmt(data.summary.gpa,2)}/><Metric label="平均成绩" value={fmt(data.summary.average)}/><Metric label="本学期课程" value={String(data.summary.course_count)} unit="门"/></div>
            <div className="mt-7 border-t border-[var(--border)] pt-5"><h3 className="mb-4 flex items-center gap-2 text-sm font-medium"><BookOpen size={15}/><SplitText text="课程清单"/><span className="ml-auto text-[10px] text-[var(--muted-foreground)]">课程总学分 {fmt(data.summary.total_credits)}</span></h3>
              <div ref={courseListRef} role="region" aria-label="课程清单" tabIndex={data.courses.length>5?0:undefined} className="overflow-auto overscroll-contain focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]"><table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-[var(--card)]"><tr className="border-b border-[var(--border)] text-[10px] text-[var(--muted-foreground)]">
                  <th className="pb-2 text-left font-normal">课程</th>
                  <th className="whitespace-nowrap px-1 pb-2 text-right font-normal">课程学分</th>
                  <th className="whitespace-nowrap px-1 pb-2 text-right font-normal" title={dimension!=="student"?"已录入该课程成绩学生的人均获得学分":"成绩及格后获得的学分"}>{dimension!=="student"?"人均获得":"获得学分"}</th>
                  <th className="pb-2 text-right font-normal">{dimension!=="student"?"均分":"成绩"}</th>
                </tr></thead>
                <tbody>{data.courses.map(course=><tr key={course.id} className="border-b border-[var(--border)]">
                  <td className="py-3 pr-2"><div>{course.name}</div><div className="mt-1 text-[9px] text-[var(--muted-foreground)]">{course.kind??"未分类"}</div></td>
                  <td className="px-1 text-right text-[var(--muted-foreground)]">{fmt(course.credits)}</td>
                  <td className={`px-1 text-right font-medium ${course.earned_credits===0?"text-[var(--destructive)]":"text-[var(--foreground)]"}`}>{fmt(course.earned_credits,2)}</td>
                  <td className="text-right"><span className={`rounded px-1.5 py-1 ${course.score!==null&&course.score/course.full_score<.6?"bg-[var(--muted)] text-[var(--destructive)]":"bg-[var(--muted)] text-[var(--chart-1)]"}`}>{course.score===null?({absent:"缺考",exempt:"免修",pending:"待录入"}[course.status]??"—"):fmt(course.score)}</span></td>
                </tr>)}</tbody>
              </table>{!data.courses.length&&<p className="py-4 text-[var(--muted-foreground)]">暂无课程成绩</p>}</div>
            </div>
            {profile&&<div className="mt-6 rounded-xl bg-[var(--muted)] p-4"><h3 className="mb-3 text-xs font-medium"><SplitText text="在校信息"/></h3><dl className="space-y-3 text-xs">{[['学院',profile.college_name],['专业',profile.major_name],['班级',profile.class_name],['入学',profile.enrollment_date],['预计毕业',profile.graduation_date],['宿舍',profile.dormitory]].map(([label,value])=><div key={label} className="flex gap-3"><dt className="w-12 shrink-0 text-[var(--muted-foreground)]">{label}</dt><dd className="min-w-0 flex-1 break-words text-right text-[var(--muted-foreground)]">{value??"未录入"}</dd></div>)}</dl></div>}
          </aside>
          <div className="min-w-0 space-y-5">
            <div className="grid gap-5 lg:grid-cols-2">
              <BorderGlow className={`${card} min-w-0 p-5`}><SectionTitle title="学业与行为雷达图" subtitle="固定刻度 · 原值可查看"/><RadarPanel data={data}/></BorderGlow>
              <BorderGlow className={`${card} min-w-0 p-5`}><SectionTitle title="画像标签" subtitle="由成绩与行为记录生成"/>
                <div className="flex min-h-[250px] flex-wrap content-center items-center justify-center gap-x-5 gap-y-4 px-2 py-6" aria-label={dimension==="student"?"学生标签云":"班级标签云"}>{data.tags.map((tag,i)=><span key={tag.code} title={`${tag.name}：${tag.value}`} className={`inline-block leading-snug ${i%3===0?"text-[var(--chart-1)]":i%3===1?"text-[var(--chart-2)]":"text-[var(--chart-3)]"}`} style={{fontSize:tag.weight===3?27:tag.weight===2?19:13,fontWeight:tag.weight>=2?600:400}}>{tag.weight===3?`${tag.name}：${tag.value}`:tag.weight===2?tag.value:`${tag.name} ${tag.value}`}</span>)}{!data.tags.length&&<span className="text-sm text-[var(--muted-foreground)]">数据不足，暂未生成标签</span>}</div>
              </BorderGlow>
            </div>
            <BorderGlow className={`${card} min-w-0 p-5 sm:p-6`}>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><SectionTitle title="生活与学习看板" subtitle={mode==="date"?"实际记录日期 · 无课日不计出勤率":"各学期汇总 · 不补造每日记录"}/><div className="flex flex-wrap items-center gap-2">
                {mode==="date"&&<select aria-label="日期范围" value={days} onChange={e=>setDays(Number(e.target.value))} className={selectStyle}><option value={7}>最近 7 个记录日</option><option value={30}>最近 30 个记录日</option></select>}
                <div className="flex rounded-lg bg-[var(--muted)] p-1">{([['date','日期'],['semester','学期']] as const).map(([v,label])=><button key={v} onClick={()=>setMode(v)} aria-pressed={mode===v} className={`rounded-md px-3 py-1.5 text-xs ${mode===v?"bg-[var(--card)] text-[var(--primary)] shadow-sm":"text-[var(--muted-foreground)]"}`}>{label}</button>)}</div>
              </div></div><BehaviorPanel data={data}/>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3 text-[10px] text-[var(--muted-foreground)]"><span className="flex items-center gap-1.5"><CalendarDays size={12}/>{data.board.points[0]?.label??"暂无记录"} 至 {data.board.points.at(-1)?.label??"—"}</span><span>行为数据覆盖 {data.summary.behavior_coverage}/{data.summary.student_count} 人</span></div>
            </BorderGlow>
          </div>
        </div>
      </div>}
    </div>
  </div>;
}

function Metric({label,value,unit}:{label:string;value:string;unit?:string}) {return <div className="rounded-xl bg-[var(--muted)] px-4 py-3"><p className="text-[10px] text-[var(--muted-foreground)]">{label}</p><p className="mt-1 text-2xl font-semibold tracking-tight text-[var(--foreground)]"><SplitText text={value} delay={25} duration={.6} hoverEffect="none"/><span className="ml-1 text-xs font-normal text-[var(--muted-foreground)]">{unit}</span></p></div>;}
function SectionTitle({title,subtitle}:{title:string;subtitle:string}) {return <div className="mb-3"><h2 className="text-sm font-semibold"><SplitText text={title}/></h2><p className="mt-1 text-[10px] text-[var(--muted-foreground)]">{subtitle}</p></div>;}
