import type { ReactNode } from 'react'

interface CardProps {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  icon?: ReactNode
  children: ReactNode
  className?: string
  /** Remove inner body padding (useful for full-bleed tables). */
  flush?: boolean
}

export function Card({
  title,
  subtitle,
  actions,
  icon,
  children,
  className = '',
  flush = false
}: CardProps): JSX.Element {
  const hasHeader = title != null || actions != null
  return (
    <section className={`card ${className}`.trim()}>
      {hasHeader && (
        <header className="card-header">
          <div className="card-heading">
            {icon && <span className="card-icon">{icon}</span>}
            <div>
              {title && <h3 className="card-title">{title}</h3>}
              {subtitle && <p className="card-subtitle">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={flush ? 'card-body card-body-flush' : 'card-body'}>{children}</div>
    </section>
  )
}
