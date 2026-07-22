'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { ErrorControl } from '../../ui/error-control'

export default function UserPage() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const query = searchParams.toString()

  return (
    <>
      <h2>Router workspace</h2>
      <div className="demo-route" id="current-route">
        {pathname}{query ? `?${query}` : ''}
      </div>
      <p>Dynamic user route</p>
      <ErrorControl />
    </>
  )
}
