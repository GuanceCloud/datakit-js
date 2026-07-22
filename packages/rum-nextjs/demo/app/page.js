'use client'

import { ErrorControl } from './ui/error-control'

export default function HomePage() {
  return (
    <>
      <h2>Router workspace</h2>
      <div className="demo-route" id="current-route">/</div>
      <p>Home route</p>
      <ErrorControl />
    </>
  )
}
