import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className = '',
  disabled,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const classes = ['btn', `btn-${variant}`, `btn-${size}`, className].filter(Boolean).join(' ')
  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? (
        <Spinner size={size === 'sm' ? 13 : 15} />
      ) : icon ? (
        <span className="btn-icon">{icon}</span>
      ) : null}
      {children != null && <span className="btn-label">{children}</span>}
    </button>
  )
}
