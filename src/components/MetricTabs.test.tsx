import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ratingRankingViews, type RankingView } from '../lib/platforms'
import { MetricTabs } from './MetricTabs'

function TestTabs() {
  const [value, setValue] = useState<RankingView>('overall')
  return (
    <>
      <MetricTabs
        platforms={ratingRankingViews}
        value={value}
        onChange={setValue}
        panelId="test-panel"
      />
      <div id="test-panel" role="tabpanel">
        {value}
      </div>
    </>
  )
}

describe('MetricTabs', () => {
  it('uses a roving tab stop and arrow-key navigation', async () => {
    const user = userEvent.setup()
    render(<TestTabs />)

    const overall = screen.getByRole('tab', { name: '总榜' })
    const codeforces = screen.getByRole('tab', { name: 'Codeforces' })
    expect(overall).toHaveAttribute('tabindex', '0')
    expect(codeforces).toHaveAttribute('tabindex', '-1')
    expect(overall).toHaveAttribute('aria-controls', 'test-panel')

    overall.focus()
    await user.keyboard('{ArrowRight}')
    expect(codeforces).toHaveFocus()
    expect(codeforces).toHaveAttribute('aria-selected', 'true')
    expect(codeforces).toHaveAttribute('tabindex', '0')

    await user.keyboard('{ArrowLeft}')
    expect(overall).toHaveFocus()
    expect(overall).toHaveAttribute('aria-selected', 'true')
  })

  it('supports Home, End and vertical arrow keys', async () => {
    const user = userEvent.setup()
    render(<TestTabs />)

    const overall = screen.getByRole('tab', { name: '总榜' })
    const xcpc = screen.getByRole('tab', { name: 'XCPC ELO' })
    overall.focus()

    await user.keyboard('{End}')
    expect(xcpc).toHaveFocus()
    expect(xcpc).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}')
    expect(overall).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(xcpc).toHaveFocus()
    await user.keyboard('{Home}')
    expect(overall).toHaveFocus()
  })
})
