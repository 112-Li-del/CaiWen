"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { apiFetch, apiUrl } from "@/lib/api";
import type { Catalog, PeoplePage, Person } from "./types";

interface Props {
  catalog:Catalog; teacherId:number|null; label:string;
  scope?:"school"|"teacher";
  triggerLabel?:string;
  onStudent:(person:Person)=>void; onTeacher:(person:Person)=>void;
}

export default function PeoplePicker({catalog,teacherId,label,onStudent,onTeacher,scope="school",triggerLabel}:Props) {
  const schoolSearch=catalog.can_select_teacher&&scope==="school";
  const scopedTeacherId=schoolSearch?null:teacherId;
  const [open,setOpen]=useState(false);
  const [kind,setKind]=useState<"student"|"teacher">("student");
  const [query,setQuery]=useState("");
  const [college,setCollege]=useState("");
  const [classId,setClassId]=useState("");
  const [page,setPage]=useState(1);
  const [result,setResult]=useState<{key:string;data:PeoplePage}|null>(null);
  const [failure,setFailure]=useState<{key:string;message:string}|null>(null);
  const [retry,setRetry]=useState(0);
  const root=useRef<HTMLDivElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const input=useRef<HTMLInputElement>(null);
  const key=JSON.stringify([catalog.semester_id,scopedTeacherId,kind,query,college,classId,page,retry]);
  const data=result?.key===key?result.data:null;
  const error=failure?.key===key?failure.message:null;
  const classes=(schoolSearch?catalog.directory_classes:catalog.classes).filter(c=>!college||c.college_id===Number(college));

  useEffect(()=>{
    if(!open) return;
    input.current?.focus();
    const outside=(event:PointerEvent)=>{
      if(!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown",outside);
    return ()=>document.removeEventListener("pointerdown",outside);
  },[open]);

  useEffect(()=>{
    if(!open||!catalog.semester_id) return;
    const controller=new AbortController();
    const timer=setTimeout(async()=>{
      const params=new URLSearchParams({semester_id:String(catalog.semester_id),kind,q:query,page:String(page),page_size:"20"});
      if(college) params.set("college_id",college);
      if(classId) params.set("class_id",classId);
      if(kind==="student"&&scopedTeacherId) params.set("teacher_id",String(scopedTeacherId));
      try {
        const response=await apiFetch(apiUrl(`/api/v1/portrait/people?${params}`),{signal:controller.signal});
        const body=await response.json();
        if(!response.ok) throw new Error(body.detail??"搜索失败，请重试");
        if(!controller.signal.aborted) setResult({key,data:body});
      } catch(e) {
        if(!controller.signal.aborted) setFailure({key,message:e instanceof Error?e.message:"搜索失败，请重试"});
      }
    },250);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[open,catalog.semester_id,scopedTeacherId,kind,query,college,classId,page,key]);

  const filterStyle="h-9 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-xs";
  return <div ref={root} className="relative" onKeyDown={e=>{
    if(e.key==="Escape"){setOpen(false);trigger.current?.focus();}
  }}>
    <button ref={trigger} type="button" aria-label={triggerLabel} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(v=>!v)} className="flex h-9 max-w-[280px] items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-xs">
      <span className="truncate">{label}</span><ChevronDown size={14} className="shrink-0"/>
    </button>
    {open&&<div role="dialog" aria-label={schoolSearch?"全校人员搜索":"所管学生搜索"} className="fixed right-4 top-28 z-50 flex max-h-[calc(100dvh-8rem)] w-[min(390px,calc(100vw-2rem))] flex-col overflow-hidden md:absolute md:right-0 md:top-11 rounded-xl border border-[var(--border)] bg-[var(--popover)] text-[var(--popover-foreground)] shadow-xl">
      <div className="shrink-0 space-y-3 border-b border-[var(--border)] p-4">
        <div className="flex items-center justify-between gap-3">
          {schoolSearch?<div className="flex gap-1 rounded-lg bg-[var(--muted)] p-1" aria-label="人员类型">{([['student','学生'],['teacher','教师']] as const).map(([value,text])=><button type="button" key={value} aria-pressed={kind===value} onClick={()=>{setKind(value);setPage(1);setQuery("");setCollege("");setClassId("");}} className={`rounded-md px-5 py-1.5 text-xs ${kind===value?"bg-[var(--card)] text-[var(--primary)] shadow-sm":"text-[var(--muted-foreground)]"}`}>{text}</button>)}</div>:<span className="text-sm font-medium">查找所管学生</span>}
          <button type="button" aria-label="关闭人员选择" onClick={()=>{setOpen(false);trigger.current?.focus();}} className="rounded p-1 hover:bg-[var(--muted)]"><X size={16}/></button>
        </div>
        <label className="flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3">
          <Search size={15} className="shrink-0 text-[var(--muted-foreground)]"/>
          <input ref={input} type="search" aria-label="搜索人员" maxLength={100} value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}} placeholder={kind==="student"?"搜索姓名、学号或登录账号":"搜索姓名、工号或登录账号"} className="w-full min-w-0 bg-transparent text-xs outline-none"/>
        </label>
        <div className="flex gap-2">
          <select aria-label="筛选学院" className={filterStyle} value={college} onChange={e=>{setCollege(e.target.value);setClassId("");setPage(1);}}><option value="">全部学院</option>{catalog.colleges.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select aria-label="筛选班级" className={filterStyle} value={classId} onChange={e=>{setClassId(e.target.value);setPage(1);}}><option value="">全部班级</option>{classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </div>
      </div>
      <div className="min-h-0 max-h-72 overflow-y-auto overscroll-contain p-2" aria-busy={!data&&!error} aria-live="polite">
        {error?<div role="alert" className="p-5 text-center text-xs text-[var(--destructive)]">{error}<button type="button" onClick={()=>setRetry(v=>v+1)} className="ml-2 underline">重试</button></div>:!data?<p className="p-7 text-center text-xs text-[var(--muted-foreground)]">正在搜索…</p>:!data.items.length?<p className="p-7 text-center text-xs text-[var(--muted-foreground)]">没有符合条件的{kind==="student"?"学生":"教师"}</p>:data.items.map(person=><button type="button" key={person.id} onClick={()=>{if(kind==="student")onStudent(person);else onTeacher(person);setOpen(false);}} className="block w-full rounded-lg px-3 py-3 text-left hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)]">
          <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{person.name}</span><span className="text-[10px] text-[var(--muted-foreground)]">{person.username??"未绑定账号"}</span></div>
          <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{person.code} · {person.college_name}</p>
          <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{kind==="student"?person.class_name:`管理 ${person.class_count} 个班级 · ${person.student_count} 名学生`}</p>
          {kind==="teacher"&&!!person.classes?.length&&<p className="mt-1 truncate text-[10px] text-[var(--muted-foreground)]">{person.classes.slice(0,2).map(c=>c.name).join("、")}{person.classes.length>2?` · 另有 ${person.classes.length-2} 个班级`:""}</p>}
        </button>)}
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted-foreground)]">
        <span>{data?`共 ${data.total} 人 · 第 ${page}/${Math.max(1,Math.ceil(data.total/20))} 页`:"每页 20 人"}</span>
        <div className="flex gap-3"><button type="button" disabled={page===1||!data} onClick={()=>setPage(p=>p-1)} className="disabled:opacity-35">上一页</button><button type="button" disabled={!data||page*20>=data.total} onClick={()=>setPage(p=>p+1)} className="disabled:opacity-35">下一页</button></div>
      </div>
    </div>}
  </div>;
}
