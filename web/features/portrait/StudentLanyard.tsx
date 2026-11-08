'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import type { Overview } from './types'

// Load the supplied React Bits scene only on this page, after hydration.
const Lanyard = dynamic(() => import('@/components/ui/Lanyard/Lanyard'), { ssr: false })

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  maxWidth: number
) {
  let fontSize = size
  do {
    ctx.font = `500 ${fontSize--}px system-ui, sans-serif`
  } while (ctx.measureText(text).width > maxWidth && fontSize > 13)
  ctx.fillText(text, x, y, maxWidth)
}

export default function StudentLanyard({
  data,
  loading,
  demo,
}: {
  data: Overview | null
  loading: boolean
  demo: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const onReady = useCallback(() => setReady(true), [])
  const [art, setArt] = useState<{
    front: string
    back: string
    primary: string
    card: string
  } | null>(null)
  useEffect(() => {
    let active = true
    const avatar = new window.Image()
    const paint = () => {
      if (!active || !root.current) return
      const css = getComputedStyle(root.current)
      const color = (name: string) => css.getPropertyValue(name).trim()
      const primary = color('--primary')
      const card = color('--card')
      const name = loading ? '正在读取…' : data?.title || '暂无学生档案'
      const profile = data?.profile
      const face = (back: boolean) => {
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 900
        const ctx = canvas.getContext('2d')
        if (!ctx) return ''
        // Opaque backing also supports the translucent glass theme.
        ctx.fillStyle = color('--background')
        ctx.fillRect(0, 0, 640, 900)
        ctx.fillStyle = card
        ctx.fillRect(0, 0, 640, 900)
        ctx.fillStyle = primary
        ctx.fillRect(0, 0, 640, 166)
        ctx.fillStyle = color('--primary-foreground')
        fitText(ctx, '南京财经大学', 48, 120, 32, 544)
        ctx.fillStyle = color('--foreground')
        if (!back) {
          if (avatar.complete && avatar.naturalWidth) {
            ctx.save()
            ctx.beginPath()
            ctx.roundRect(180, 205, 280, 280, 30)
            ctx.clip()
            const scale = Math.max(280 / avatar.naturalWidth, 280 / avatar.naturalHeight)
            ctx.drawImage(
              avatar,
              180 + (280 - avatar.naturalWidth * scale) / 2,
              205 + (280 - avatar.naturalHeight * scale) / 2,
              avatar.naturalWidth * scale,
              avatar.naturalHeight * scale
            )
            ctx.restore()
          }
          fitText(ctx, name, 48, 558, 44, 544)
          ctx.fillStyle = color('--muted-foreground')
          fitText(ctx, profile?.student_no || '学号未录入', 48, 607, 27, 544)
          fitText(ctx, profile?.college_name || '学院未录入', 48, 688, 29, 544)
          fitText(ctx, profile?.major_name || '专业未录入', 48, 735, 26, 544)
          fitText(ctx, profile?.class_name || '班级未录入', 48, 779, 26, 544)
        } else {
          fitText(ctx, '学生档案', 48, 255, 42, 544)
          const rows = [
            ['姓名', name],
            ['学号', profile?.student_no],
            ['入学日期', profile?.enrollment_date],
            ['预计毕业', profile?.graduation_date],
          ]
          rows.forEach(([label, value], index) => {
            const y = 335 + index * 110
            ctx.fillStyle = color('--muted-foreground')
            fitText(ctx, label || '', 48, y, 23, 544)
            ctx.fillStyle = color('--foreground')
            fitText(ctx, value || '未录入', 48, y + 43, 30, 544)
          })
        }
        ctx.fillStyle = color('--border')
        ctx.fillRect(48, 820, 544, 2)
        ctx.fillStyle = primary
        fitText(ctx, '财问 / CAIWEN', 48, 865, 22, 320)
        ctx.fillStyle = color('--muted-foreground')
        fitText(ctx, demo ? '示例档案' : '学生档案', 462, 865, 21, 132)
        return canvas.toDataURL('image/png')
      }
      setArt({ front: face(false), back: face(true), primary, card })
    }
    avatar.onload = paint
    avatar.onerror = paint
    avatar.src = '/avatar-default.jpg'
    void document.fonts.ready.then(paint)
    const observer = new MutationObserver(paint)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    })
    return () => {
      active = false
      observer.disconnect()
      avatar.onload = null
      avatar.onerror = null
    }
  }, [data, loading, demo])

  return (
    <div ref={root} className="lg:sticky lg:top-8">
      <div className="relative h-[490px] w-full" aria-label="学生挂绳档案卡">
        {!ready && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center">
            <div className="h-24 w-5 bg-[var(--primary)]" />
            <div className="relative h-[330px] w-[235px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-lg">
              {art ? (
                // OCR extensions can inject attributes into images before hydration.
                <Image
                  src={art.front}
                  alt="学生档案卡"
                  fill
                  unoptimized
                  sizes="235px"
                  className="object-cover"
                  suppressHydrationWarning
                />
              ) : (
                <Image
                  src="/avatar-default.jpg"
                  alt="学生统一头像"
                  fill
                  sizes="235px"
                  className="object-contain p-8"
                  suppressHydrationWarning
                />
              )}
            </div>
          </div>
        )}
        {art && (
          <Lanyard
            frontImage={art.front}
            backImage={art.back}
            strapImage={undefined}
            cardColor={art.card}
            strapColor={art.primary}
            size={0.64}
            strapLength={0.18}
            breeze={0.12}
            damping={0.65}
            finish="matte"
            onReady={onReady}
            style={{ position: 'absolute', inset: 0 }}
          />
        )}
      </div>
      <p className="text-center text-xs leading-6 text-[var(--muted-foreground)]">
        {ready ? '拖动卡片，让它轻轻摆动 · 点击翻面' : '南京财经大学 · 学生档案'}
      </p>
      {demo && (
        <p className="mt-2 text-center text-xs text-[var(--muted-foreground)]">
          示例数据 · 仅供演示
        </p>
      )}
    </div>
  )
}
