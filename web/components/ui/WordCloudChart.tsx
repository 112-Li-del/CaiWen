'use client'

import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import * as echarts from 'echarts'

interface WordCloudTag {
  code: string
  name: string
  value: string
  weight: number
}

interface WordCloudChartProps {
  tags: WordCloudTag[]
  className?: string
  colors?: string[]
  sizeRange?: [number, number]
  /** 控制布局分散度，值越大通常越分散 */
  gridSize?: number
  backgroundColor?: string
  /** 是否尽可能铺满画面 */
  enableFill?: boolean
}

const DEFAULT_COLORS = [
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

export default function WordCloudChart({
  tags = [],
  className = '',
  colors = DEFAULT_COLORS,
  sizeRange = [12, 60],
  gridSize = 8,
  backgroundColor = 'transparent',
  enableFill = true,
}: WordCloudChartProps) {
  const [pluginReady, setPluginReady] = useState(false)

  // 仅在浏览器端加载词云插件，避免服务端出现 window is not defined
  useEffect(() => {
    let active = true

    import('echarts-wordcloud')
      .then(() => {
        if (active) {
          setPluginReady(true)
        }
      })
      .catch(error => {
        console.error('echarts-wordcloud 加载失败：', error)
      })

    return () => {
      active = false
    }
  }, [])

  const option = useMemo(() => {
    const validTags = (tags ?? []).filter(
      tag => tag && typeof tag.name === 'string' && tag.name.trim()
    )

    if (validTags.length === 0) return null

    const safeColors = colors && colors.length > 0 ? colors : DEFAULT_COLORS

    const parsedTags = validTags.map(tag => {
      const rawWeight = Number(tag.weight)
      const weight = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 1

      const colorSeed = tag.name.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)

      return {
        ...tag,
        weight,
        color: safeColors[colorSeed % safeColors.length],
      }
    })

    const weightList = parsedTags.map(tag => tag.weight)
    const minWeight = Math.min(...weightList)
    const maxWeight = Math.max(...weightList)
    const [minFont, maxFont] = sizeRange

    const getFontSize = (weight: number): number => {
      if (maxWeight === minWeight) {
        return (minFont + maxFont) / 2
      }

      const normalized = (weight - minWeight) / (maxWeight - minWeight)

      return Math.round(minFont + Math.pow(normalized, 1.7) * (maxFont - minFont))
    }

    const wordCloudData = parsedTags
      .flatMap((tag, index) => {
        const name = `${tag.name}：${tag.value ?? '暂无'}`
        const detail = `标签名称：${tag.name}；标签值：${tag.value ?? '暂无'}；权重：${tag.weight}`

        // 第一次显示的颜色
        const firstColor = tag.color

        // 第二次显示使用不同颜色
        const colorIndex = colors.indexOf(tag.color)
        const secondColor =
          colors[(Math.max(0, colorIndex) + 3 + index) % colors.length] ?? '#F472B6'

        const createWord = (color: string) => ({
          name,
          value: tag.weight,
          detail,
          textStyle: {
            color,
            fontSize: getFontSize(tag.weight),
          },
        })

        // 同一个关键词生成两份，使用不同颜色
        return [createWord(firstColor), createWord(secondColor)]
      })
      .sort((a, b) => b.value - a.value)

    return {
      backgroundColor,
      animation: true,

      tooltip: {
        show: true,
        trigger: 'item',
        confine: true,
        backgroundColor: 'rgba(15, 23, 42, 0.96)',
        borderColor: '#38BDF8',
        textStyle: {
          color: '#F8FAFC',
          fontSize: 13,
        },
        formatter: (params: { name: string; data?: { detail?: string } }) => {
          return `${params.name}<br/>${params.data?.detail ?? ''}`
        },
      },

      series: [
        {
          type: 'wordCloud',

          // 布局设置
          shape: 'circle',
          left: 'center',
          top: 'center',
          width: enableFill ? '100%' : '90%',
          height: enableFill ? '100%' : '90%',

          // 字体大小：缩小字体，容纳更多关键词
          sizeRange: [12, 42],

          // 文字方向更加丰富
          rotationRange: [-15, 15],
          rotationStep: 5,

          // 网格越小，通常越容易放入更多文字
          gridSize: 4,

          // 布局设置
          drawOutOfBound: false,
          layoutAnimation: true,
          keepAspect: true,
          shrinkToFit: true,
          minSize: 12,

          // 文字样式
          textStyle: {
            fontFamily: '"Microsoft YaHei", "PingFang SC", Arial, sans-serif',
            fontWeight: 'bold',
            color: '#38BDF8',
            textBorderColor: '#00000010',
            textBorderWidth: 1,
          },

          // 鼠标悬停效果
          emphasis: {
            focus: 'self',
            textStyle: {
              shadowBlur: 22,
              shadowColor: '#38BDF8',
              fontWeight: 'bolder',
            },
          },

          data: wordCloudData,
        },
      ],
    }
  }, [tags, colors, sizeRange, gridSize, backgroundColor, enableFill])

  if (!tags?.length || !option) {
    return (
      <div
        className={`flex h-full min-h-[300px] w-full items-center justify-center text-sm text-[var(--muted-foreground)] ${className}`}
      >
        当前暂无画像标签
      </div>
    )
  }

  if (!pluginReady) {
    return (
      <div
        className={`flex h-full min-h-[300px] w-full items-center justify-center text-sm text-[var(--muted-foreground)] ${className}`}
      >
        词云加载中...
      </div>
    )
  }

  return (
    <div
      className={`h-full min-h-0 w-full ${className}`}
      style={{
        margin: 0,
        padding: 0,
        background: backgroundColor,
      }}
    >
      <ReactECharts
        echarts={echarts}
        option={option}
        notMerge
        lazyUpdate={false}
        opts={{ renderer: 'canvas' }}
        style={{
          width: '100%',
          height: '100%',
          minHeight: 300,
        }}
      />
    </div>
  )
}
