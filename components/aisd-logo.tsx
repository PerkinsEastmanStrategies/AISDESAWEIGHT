export function AisdLogo({ className = "h-11 w-auto" }: { className?: string }) {
  return (
    <img
      src="/images/aisd-logo.png"
      alt="Austin Independent School District"
      className={`shrink-0 object-contain object-left ${className}`}
    />
  )
}
