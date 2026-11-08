'use client'
import PortraitAssistant from './PortraitAssistant'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowUpRight, RefreshCw } from 'lucide-react'
import { apiFetch, apiUrl } from '@/lib/api'
import SplitText from '@/components/ui/SplitText'
import StudentLanyard from './StudentLanyard'
import PortraitHeading from './PortraitHeading'
import PeoplePicker from './PeoplePicker'
import { usePortraitSelection } from './PortraitSelection'
import type { Catalog, Overview } from './types'

async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await apiFetch(apiUrl(path), { signal })
  if (!response.ok) throw new Error('档案读取失败，请重试或联系管理员检查绑定信息。')
  return response.json()
}
function Fields({ items }: { items: [string, string | number | null | undefined][] }) {
  return (
    <dl className="grid gap-x-10 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0 border-b border-[var(--border)] py-5">
          <dt className="text-xs font-medium text-[var(--muted-foreground)]">{label}</dt>
          <dd className="mt-2 break-words text-base font-semibold leading-7">
            {value == null || value === '' ? '未录入' : value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
const panel = 'rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8'
const control =
  'h-9 min-w-0 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]'
export default function StudentProfile() {
  const selection = usePortraitSelection()
  const {
    semester,
    setSemester,
    teacherId,
    setTeacherId,
    student,
    setStudent,
    studentLabel,
    setStudentLabel,
    setClassId,
    setDimension,
  } = selection
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const ctrl = new AbortController()
    async function load() {
      setLoading(true)
      setError('')
      setData(null)
      setCatalog(null)
      try {
        const params = new URLSearchParams()
        if (semester) params.set('semester_id', String(semester))
        if (teacherId) params.set('teacher_id', String(teacherId))
        const next = await read<Catalog>(`/api/v1/portrait/catalog?${params}`, ctrl.signal)
        if (ctrl.signal.aborted) return
        setCatalog(next)
        if (!next.semester_id || !next.first_student || (next.teacher && !student)) return
        params.set('semester_id', String(next.semester_id))
        params.set('dimension', 'student')
        if (student) params.set('student_id', String(student))
        const result = await read<Overview>(`/api/v1/portrait/overview?${params}`, ctrl.signal)
        if (!ctrl.signal.aborted) setData(result)
      } catch (e) {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => ctrl.abort()
  }, [semester, teacherId, student, revision])
  const teacher = catalog?.teacher && !student ? catalog.teacher : null
  const profile = data?.profile
  return (
    <div className="min-h-full text-[var(--foreground)]">
      <PortraitAssistant data={data} />

      <header className="flex min-h-20 flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--card)] px-5 py-4 lg:px-9">
        <PortraitHeading profile />
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <select
            aria-label="选择学期"
            value={semester ?? catalog?.semester_id ?? ''}
            onChange={e => {
              setSemester(Number(e.target.value))
              setStudent(null)
              setStudentLabel('')
              setClassId(null)
            }}
            className={control}
          >
            {!catalog?.semesters.length && <option value="">暂无学期</option>}
            {catalog?.semesters.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {catalog?.can_compare && (
            <PeoplePicker
              catalog={catalog}
              teacherId={teacherId}
              label={studentLabel || teacher?.name || data?.title || '搜索学生或教师'}
              onStudent={person => {
                if (catalog.can_select_teacher) setTeacherId(null)
                setStudent(person.id)
                setStudentLabel(person.name)
                setClassId(null)
                setDimension('student')
              }}
              onTeacher={person => {
                setTeacherId(person.id)
                setStudent(null)
                setStudentLabel('')
                setClassId(null)
                setDimension('student')
              }}
            />
          )}
          <button aria-label="刷新档案" className={control} onClick={() => setRevision(r => r + 1)}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-10">
        <div className="mb-8">
          <p className="mb-2 text-[10px] font-medium tracking-[.18em] text-[var(--primary)]">
            {teacher ? 'TEACHER PROFILE / 教师档案' : 'STUDENT PROFILE / 学生档案'}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            <SplitText
              text={loading ? '正在读取档案' : teacher?.name || data?.title || '个人档案'}
              delay={45}
            />
          </h2>
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">
            {teacher ? '按学期查看教师信息与班级分管情况' : '校园身份、在校信息与学习记录'}
          </p>
        </div>
        {error && (
          <div
            role="alert"
            className="mb-6 rounded-xl border border-[var(--destructive)] p-5 text-sm"
          >
            {error}
            <button className="ml-3 underline" onClick={() => setRevision(r => r + 1)}>
              重试
            </button>
          </div>
        )}
        <div
          aria-busy={loading}
          className="grid items-start gap-7 lg:grid-cols-[320px_minmax(0,1fr)]"
        >
          {teacher ? (
            <aside className={`${panel} lg:sticky lg:top-8`}>
              <Image
                src="/avatar-default.jpg"
                alt="教师统一头像"
                width={96}
                height={96}
                className="rounded-2xl"
                suppressHydrationWarning
              />
              <p className="mt-6 text-xs text-[var(--primary)]">南京财经大学 · 教师</p>
              <h3 className="mt-2 text-2xl font-semibold">{teacher.name}</h3>
              <p className="mt-2 font-mono text-sm text-[var(--muted-foreground)]">
                {teacher.teacher_no}
              </p>
              <p className="mt-5 text-sm">{teacher.college_name}</p>
              {catalog?.demo && (
                <p className="mt-6 text-xs text-[var(--muted-foreground)]">示例数据 · 仅供演示</p>
              )}
            </aside>
          ) : (
            <StudentLanyard data={data} loading={loading} demo={catalog?.demo ?? false} />
          )}
          <div className="min-w-0 space-y-6">
            {teacher ? (
              <>
                <section className={panel}>
                  <h2 className="text-lg font-semibold">
                    <SplitText text="教师基本信息" />
                  </h2>
                  <Fields
                    items={[
                      ['姓名', teacher.name],
                      ['工号', teacher.teacher_no],
                      ['所属学院', teacher.college_name],
                      [
                        '当前学期',
                        catalog?.semesters.find(s => s.id === catalog.semester_id)?.name,
                      ],
                    ]}
                  />
                </section>
                <section className={panel}>
                  <h2 className="text-lg font-semibold">
                    <SplitText text="分管班级" />
                  </h2>
                  <div className="my-6 grid grid-cols-2 gap-5">
                    {[
                      ['分管班级', teacher.class_count, '个'],
                      ['所管学生', teacher.student_count, '人'],
                    ].map(([label, count, unit]) => (
                      <div key={label}>
                        <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
                        <p className="mt-2 text-3xl font-semibold tabular-nums text-[var(--primary)]">
                          {count}
                          <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">
                            {unit}
                          </span>
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="divide-y divide-[var(--border)]">
                    {teacher.classes.map(c => (
                      <Link
                        key={c.id}
                        href="/portrait/overview"
                        onClick={() => {
                          setClassId(c.id)
                          setDimension('class')
                          setStudent(null)
                        }}
                        className="flex items-center justify-between gap-4 py-4 hover:text-[var(--primary)]"
                      >
                        <span className="font-semibold">{c.name}</span>
                        <span className="flex items-center gap-3 text-sm text-[var(--muted-foreground)]">
                          {c.student_count} 名学生
                          <ArrowUpRight size={16} />
                        </span>
                      </Link>
                    ))}
                  </div>
                  {!teacher.classes.length && (
                    <p className="text-sm text-[var(--muted-foreground)]">当前学期尚未分配班级</p>
                  )}
                  <Link
                    href="/portrait/overview"
                    className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-[var(--primary)]"
                  >
                    查看所管范围画像
                    <ArrowUpRight size={16} />
                  </Link>
                </section>
              </>
            ) : (
              <>
                {!loading && !error && !data && (
                  <p role="status" className="text-sm text-[var(--muted-foreground)]">
                    暂无可查看的学生档案，请联系管理员绑定信息。
                  </p>
                )}
                <section className={panel}>
                  <h2 className="text-lg font-semibold">
                    <SplitText text="基础与在校信息" />
                  </h2>
                  <Fields
                    items={[
                      ['姓名', data?.title],
                      ['学号', profile?.student_no],
                      ['学院', profile?.college_name],
                      ['专业', profile?.major_name],
                      ['班级', profile?.class_name],
                      ['宿舍', profile?.dormitory],
                      ['入学日期', profile?.enrollment_date],
                      ['预计毕业日期', profile?.graduation_date],
                    ]}
                  />
                  <p className="mt-5 text-xs leading-6 text-[var(--muted-foreground)]">
                    信息来自学校档案。如需更正，请联系辅导员或教务管理人员。
                  </p>
                </section>
                <section className={panel}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold">
                      <SplitText text="学习档案" />
                    </h2>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {data?.semester.name || '暂无学期数据'}
                    </span>
                  </div>
                  <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-6">
                    {[
                      ['当前 GPA', data?.summary.gpa?.toFixed(2)],
                      ['平均成绩', data?.summary.average?.toFixed(1)],
                      ['已获得学分', data?.summary.passed_credits],
                      ['课程数量', data?.summary.course_count],
                    ].map(([label, number]) => (
                      <div key={label} className="border-b border-[var(--border)] pb-5">
                        <dt className="text-xs text-[var(--muted-foreground)]">{label}</dt>
                        <dd className="mt-3 text-3xl font-semibold tabular-nums tracking-tight text-[var(--primary)]">
                          {number ?? '未录入'}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <Link
                    href="/portrait/overview"
                    className="mt-7 inline-flex items-center gap-3 rounded-lg bg-[var(--primary)] px-4 py-3 text-sm text-[var(--primary-foreground)]"
                  >
                    查看完整学习画像
                    <ArrowUpRight size={16} />
                  </Link>
                </section>
              </>
            )}
          </div>
        </div>
        <footer className="mt-10 border-t border-[var(--border)] py-5 text-xs text-[var(--muted-foreground)]">
          南京财经大学 · 财问
        </footer>
      </div>
    </div>
  )
}
