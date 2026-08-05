import { memo, useEffect, useRef } from 'react'

interface VerdictEntry {
  problem: string
  verdict: string
  tone?: 'ac' | 'wa'
}

const verdicts: VerdictEntry[] = [
  { problem: 'A', verdict: 'Accepted', tone: 'ac' },
  { problem: 'B', verdict: 'Accepted', tone: 'ac' },
  { problem: 'C', verdict: 'Wrong Answer', tone: 'wa' },
  { problem: 'C', verdict: 'Accepted', tone: 'ac' },
  { problem: 'D', verdict: 'Running' },
  { problem: 'E', verdict: 'Accepted', tone: 'ac' },
  { problem: 'F', verdict: 'Pending' },
  { problem: 'G', verdict: 'Time Limit', tone: 'wa' },
  { problem: 'H', verdict: 'Accepted', tone: 'ac' },
  { problem: 'I', verdict: 'Pending' },
  { problem: 'J', verdict: 'Accepted', tone: 'ac' },
  { problem: 'K', verdict: 'Compiling' },
]

function VerdictSegment() {
  return (
    <>
      {verdicts.map((entry, index) => (
        <span key={`${entry.problem}-${entry.verdict}-${index}`}>
          {entry.problem}{' '}
          {entry.tone ? (
            <span className={`verdict-${entry.tone}`}>{entry.verdict}</span>
          ) : (
            entry.verdict
          )}
          {' · '}
        </span>
      ))}
    </>
  )
}

export const VerdictTicker = memo(function VerdictTicker() {
  const tickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ticker = tickerRef.current
    if (!ticker || !('IntersectionObserver' in window)) return undefined

    const observer = new IntersectionObserver(([entry]) => {
      ticker.classList.toggle('is-offscreen', !entry.isIntersecting)
    })
    observer.observe(ticker)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="verdict-ticker" aria-hidden="true" ref={tickerRef}>
      <span className="verdict-ticker-inner">
        <VerdictSegment />
        <VerdictSegment />
      </span>
    </div>
  )
})
