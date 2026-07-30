'use client'

import { useState } from 'react'
import { ErrorBoundary } from '@cloudcare/browser-rum-nextjs'

function CrashProbe({ active }) {
  if (active) {
    throw new Error('Next.js demo render error')
  }
  return null
}

function ErrorFallback() {
  return (
    <div className="demo-fallback">
      <p>The Next.js error was captured.</p>
      <button className="demo-button" id="reset-error" onClick={() => window.location.reload()}>
        Reset demo
      </button>
    </div>
  )
}

export function ErrorControl() {
  const [active, setActive] = useState(false)
  return (
    <ErrorBoundary fallback={ErrorFallback}>
      <div className="demo-actions">
        <button className="demo-button error" id="trigger-error" onClick={() => setActive(true)}>
          Trigger render error
        </button>
      </div>
      <CrashProbe active={active} />
    </ErrorBoundary>
  )
}
