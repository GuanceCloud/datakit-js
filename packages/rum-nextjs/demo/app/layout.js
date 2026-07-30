import Link from 'next/link'
import './globals.css'
import { DemoStatus } from './ui/demo-status'
import { RouterTracker } from './ui/router-tracker'

export const metadata = {
  title: 'Next.js RUM Plugin Demo'
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <RouterTracker />
        <main className="demo-shell">
          <header className="demo-header">
            <div>
              <h1>Next.js RUM Plugin</h1>
              <p>App Router view tracking and ErrorBoundary reporting</p>
            </div>
            <DemoStatus mode="badge" />
          </header>
          <div className="demo-grid">
            <section className="demo-workspace">
              <nav className="demo-nav">
                <Link id="go-home" href="/">Home</Link>
                <Link id="go-user" href="/users/42">User 42</Link>
                <Link id="change-query" href="/users/42?tab=activity">Query only</Link>
              </nav>
              {children}
            </section>
            <DemoStatus mode="panel" />
          </div>
        </main>
      </body>
    </html>
  )
}
