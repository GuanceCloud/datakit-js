'use client'

import { useEffect, useState } from 'react'

function useDemoState() {
  const [hydrated, setHydrated] = useState(false)
  const [, setVersion] = useState(0)
  useEffect(() => {
    const update = () => setVersion((value) => value + 1)
    window.addEventListener('framework-demo:update', update)
    setHydrated(true)
    update()
    return () => window.removeEventListener('framework-demo:update', update)
  }, [])
  return hydrated ? window.__frameworkDemo : undefined
}

export function DemoStatus({ mode }) {
  const state = useDemoState()
  if (mode === 'badge') {
    return (
      <div id="demo-result" className={`demo-badge ${state?.passed ? 'passed' : ''}`}>
        {state?.passed ? 'Passed' : state?.ready ? 'Running' : 'Starting'}
      </div>
    )
  }

  return (
    <aside className="demo-status">
      <h2>RUM events</h2>
      <div className="demo-kpis">
        <div className="demo-kpi"><span>Views</span><strong id="demo-view-count">{state?.viewNames.length || 0}</strong></div>
        <div className="demo-kpi"><span>Errors</span><strong id="demo-error-count">{state?.errors.length || 0}</strong></div>
        <div className="demo-kpi"><span>Uploads</span><strong id="demo-request-count">{state?.requests.length || 0}</strong></div>
      </div>
      <pre id="demo-log" className="demo-log">{JSON.stringify(state || {}, null, 2)}</pre>
    </aside>
  )
}
