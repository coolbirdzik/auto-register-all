import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'success' | 'danger' | 'warn' | 'info' | 'accent'

interface BadgeProps {
  tone?: BadgeTone
  children: ReactNode
  dot?: boolean
  className?: string
}

export function Badge({ tone = 'neutral', children, dot = false, className = '' }: BadgeProps): JSX.Element {
  return (
    <span className={`badge badge-${tone} ${className}`.trim()}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  )
}
