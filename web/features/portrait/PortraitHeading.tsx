'use client'

import { ScanFace, UserRound } from 'lucide-react'
import SplitText from '@/components/ui/SplitText'

export default function PortraitHeading({ profile = false }: { profile?: boolean }) {
  const Icon = profile ? UserRound : ScanFace
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium tracking-[.2em] text-[var(--muted-foreground)]">
        CAIWEN / {profile ? 'PERSONAL PROFILE' : 'STUDENT PORTRAIT'}
      </div>
      <h1 className="flex items-center gap-2 text-lg font-semibold">
        <Icon size={20} strokeWidth={1.6} />
        <SplitText text={profile ? '个人信息' : '学业画像'} delay={50} />
      </h1>
    </div>
  )
}
