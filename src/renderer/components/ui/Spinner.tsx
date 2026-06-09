interface SpinnerProps {
  size?: number
  className?: string
}

export function Spinner({ size = 16, className = '' }: SpinnerProps): JSX.Element {
  return (
    <span
      className={`spinner ${className}`.trim()}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  )
}
