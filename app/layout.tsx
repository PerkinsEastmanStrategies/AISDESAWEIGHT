import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "AISD ESA Live Weighting Lab",
  description: "Live ESA weight explorer for Casis and Ortega Pilot #2",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-slate-100 antialiased">{children}</body>
    </html>
  )
}
