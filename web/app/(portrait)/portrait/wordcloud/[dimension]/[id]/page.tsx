'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, RefreshCw, ScanFace } from 'lucide-react'
import dynamic from 'next/dynamic'
import { apiFetch, apiUrl } from '@/lib/api'
import type { Catalog, Overview } from '@/features/portrait/types'

// ECharts 仅在浏览器端加载，避免 Next.js 服务端渲染时出现 window 相关错误
const ReactECharts = dynamic(() => import('echarts-for-react'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[65vh] items-center justify-center text-sm text-[var(--muted-foreground)]">
      正在加载词云图表…
    </div>
  ),
})
const WordCloudChart = dynamic(() => import('@/components/ui/WordCloudChart'), { ssr: false })

type WordCloudTag = Overview['tags'][number]

const COLORS = [
  '#38BDF8',
  '#22D3EE',
  '#818CF8',
  '#A78BFA',
  '#FB923C',
  '#34D399',
  '#60A5FA',
  '#F472B6',
  '#2DD4BF',
  '#FBBF24',
]

function getWordCloudOption(tags: WordCloudTag[]) {
  const values = tags.map(tag => tag.weight)
  const minWeight = Math.min(...values)
  const maxWeight = Math.max(...values)

  return {
    backgroundColor: 'transparent',

    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      borderColor: '#334155',
      textStyle: {
        color: '#F8FAFC',
        fontSize: 13,
      },
      formatter: (params: { name: string; data?: { detail?: string } }) =>
        `${params.name}<br/>${params.data?.detail ?? ''}`,
    },

    series: [
      {
        type: 'wordCloud',
        shape: 'circle',
        left: 'center',
        top: 'center',
        width: '96%',
        height: '96%',

        // 字号范围：核心词突出，次要词逐步缩小
        sizeRange: [15, 76],

        // 允许横向、纵向及倾斜排列
        rotationRange: [-60, 60],
        rotationStep: 30,

        // 数值越小，词语之间通常越紧凑
        gridSize: 5,
        drawOutOfBound: false,
        layoutAnimation: true,
        keepAspect: true,

        textStyle: {
          fontFamily: 'Arial, Microsoft YaHei, sans-serif',
          fontWeight: 'bold',
          color: () => COLORS[Math.floor(Math.random() * COLORS.length)],
        },

        emphasis: {
          focus: 'self',
          textStyle: {
            shadowBlur: 18,
            shadowColor: '#38BDF8',
          },
        },

        data: tags.map(tag => {
          const weight = Number(tag.weight) || 1

          // 归一化权重，避免权重跨度较小时字号差异不明显
          const normalized =
            maxWeight === minWeight ? 0.5 : (weight - minWeight) / (maxWeight - minWeight)

          return {
            name: tag.name,
            value: Math.round(15 + normalized * 85),
            detail: `标签值：${tag.value} · 权重：${tag.weight}`,
            textStyle: {
              color:
                COLORS[
                  Math.abs(tag.name.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) %
                    COLORS.length
                ],
            },
          }
        }),
      },
    ],
  }
}

export default function WordCloudPage() {
  const params = useParams<{ dimension: string; id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()

  const dimension = params.dimension
  const targetId = Number(params.id)

  const semesterParam = searchParams.get('semester_id')
  const teacherParam = searchParams.get('teacher_id')

  const semesterFromUrl =
    semesterParam && /^\d+$/.test(semesterParam) ? Number(semesterParam) : null

  const teacherFromUrl = teacherParam && /^\d+$/.test(teacherParam) ? Number(teacherParam) : null

  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (
      !['student', 'class'].includes(dimension) ||
      !Number.isSafeInteger(targetId) ||
      targetId <= 0
    ) {
      setError('页面参数无效，请返回画像主页重新选择。')
      setLoading(false)
      return
    }

    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError('')

      try {
        const catalogParams = new URLSearchParams()

        if (teacherFromUrl !== null && Number.isSafeInteger(teacherFromUrl) && teacherFromUrl > 0) {
          catalogParams.set('teacher_id', String(teacherFromUrl))
        }

        const catalogResponse = await apiFetch(
          apiUrl(`/api/v1/portrait/catalog?${catalogParams.toString()}`),
          { signal: controller.signal }
        )

        if (!catalogResponse.ok) {
          throw new Error('获取画像目录失败，请稍后重试。')
        }

        const catalogData: Catalog = await catalogResponse.json()

        const semesterId =
          semesterFromUrl !== null && Number.isSafeInteger(semesterFromUrl) && semesterFromUrl > 0
            ? semesterFromUrl
            : catalogData.semester_id

        if (!semesterId) {
          throw new Error('暂无可查看的学期数据。')
        }

        const overviewParams = new URLSearchParams({
          semester_id: String(semesterId),
          dimension,
          board_mode: 'date',
          days: '30',
        })

        if (dimension === 'student') {
          overviewParams.set('student_id', String(targetId))
        } else {
          overviewParams.set('class_id', String(targetId))
        }

        if (teacherFromUrl !== null && Number.isSafeInteger(teacherFromUrl) && teacherFromUrl > 0) {
          overviewParams.set('teacher_id', String(teacherFromUrl))
        }

        const overviewResponse = await apiFetch(
          apiUrl(`/api/v1/portrait/overview?${overviewParams.toString()}`),
          { signal: controller.signal }
        )

        if (!overviewResponse.ok) {
          throw new Error('获取词云数据失败，请确认该学生或班级存在。')
        }

        const overviewData: Overview = await overviewResponse.json()

        if (!controller.signal.aborted) {
          setCatalog(catalogData)
          setData(overviewData)
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : '加载失败，请稍后重试。')
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => controller.abort()
  }, [dimension, targetId, semesterFromUrl, teacherFromUrl])

  const cardStyle = 'rounded-2xl border border-[var(--border)] bg-[var(--card)]'

  const wordCloudOption = data?.tags.length ? getWordCloudOption(data.tags) : null

  // 增强词云数据：合并课程名称作为额外标签，避免关键词过少
  const enhancedTags = useMemo(() => {
    if (!data) return [];

    const tagMap = new Map<string, WordCloudTag>();

    // 1. 添加原始标签
    data.tags.forEach(tag => {
      tagMap.set(tag.name, {
        ...tag,
        weight: Math.max(1, Number(tag.weight))
      });
    });

    // 2. 添加课程名称作为标签（权重基于学分）
    data.courses.forEach(course => {
      if (course.name && course.credits) {
        const courseWeight = Math.round(course.credits * 2);
        const name = course.name;

        if (tagMap.has(name)) {
          // 合并重复标签：累加权重但不超过上限
          const existing = tagMap.get(name)!;
          tagMap.set(name, {
            ...existing,
            weight: Math.min(100, existing.weight + courseWeight)
          });
        } else {
          tagMap.set(name, {
            code: `course-${course.id}`,
            name,
            value: name,
            weight: Math.min(20, courseWeight)
          });
        }
      }
    });

    // 3. 按权重降序排序（确保高权重词优先布局）
    return Array.from(tagMap.values()).sort((a, b) => b.weight - a.weight);
  }, [data]);

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--card)] px-5 py-5 lg:px-10">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--muted)]">
            <ScanFace size={22} />
          </div>

          <div>
            <h1 className="text-xl font-semibold">完整画像词云</h1>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {dimension === 'student' ? '学生画像标签' : '班级画像标签'}
              {data ? ` · ${data.title}` : ''}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm transition-colors hover:bg-[var(--muted)]"
        >
          <ArrowLeft size={16} />
          返回上一页
        </button>
      </header>

      <div className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-8">
        {loading && (
          <div className={`${cardStyle} flex min-h-[400px] items-center justify-center gap-3`}>
            <RefreshCw size={18} className="animate-spin" />
            <span className="text-sm text-[var(--muted-foreground)]">正在生成完整词云…</span>
          </div>
        )}

        {!loading && error && (
          <div className={`${cardStyle} p-8 text-center`}>
            <p className="text-sm text-[var(--destructive)]">{error}</p>

            <button
              type="button"
              onClick={() => router.back()}
              className="mt-4 rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--muted)]"
            >
              返回画像主页
            </button>
          </div>
        )}

        {!loading && !error && data && (
          <>
            <section className={`${cardStyle} p-5 sm:p-8`}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{data.title} · 全部画像标签</h2>

                  <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                    共 {data.tags.length} 个标签 · 字体大小反映标签权重
                  </p>
                </div>

                <span className="rounded-lg bg-[var(--muted)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                  {data.semester.name}
                </span>
              </div>

              {data.tags.length > 0 && wordCloudOption ? (
                <div
                  aria-label="完整画像词云"
                  className="min-h-[65vh] overflow-hidden rounded-xl border border-[var(--border)]/50 bg-gradient-to-br from-sky-500/[0.03] via-transparent to-violet-500/[0.06] p-2 sm:p-4"
                >
                  <WordCloudChart tags={data.tags} />
                </div>
              ) : (
                <div className="flex min-h-[300px] items-center justify-center text-sm text-[var(--muted-foreground)]">
                  当前学期暂无画像标签
                </div>
              )}
            </section>

            <p className="px-1 text-xs text-[var(--muted-foreground)]">
              学期：{data.semester.name} · 展示全部 {data.tags.length} 个标签
            </p>
          </>
        )}
      </div>
    </main>
  )
}
