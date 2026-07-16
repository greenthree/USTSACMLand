import { render, screen } from '@testing-library/react'
import { RatingValue } from './RatingValue'

describe('RatingValue', () => {
  it('shows a visible non-color tier label and an accessible platform title', () => {
    render(<RatingValue platform="codeforces" value={1924} />)

    expect(screen.getByText('1,924')).toHaveClass('rating-display-number')
    expect(screen.getByText('候选大师')).toBeInTheDocument()
    expect(screen.getByTitle('Codeforces · 候选大师')).toHaveClass('rating-tone-violet')
  })

  it('keeps a screen-reader tier label in compact mode', () => {
    render(<RatingValue platform="atcoder" value={1682} showTier={false} />)

    expect(screen.getByText('，蓝色段位')).toHaveClass('sr-only')
  })

  it('renders missing values without inventing a tier', () => {
    render(<RatingValue platform="xcpc_elo" value={null} />)

    expect(screen.getByText('--')).toHaveClass('rating-display')
    expect(screen.queryByText('新手')).not.toBeInTheDocument()
  })
})
