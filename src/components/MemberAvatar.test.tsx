import { fireEvent, render, screen } from '@testing-library/react'
import { MemberAvatar } from './MemberAvatar'

describe('MemberAvatar', () => {
  it('renders the cached avatar without exposing identity data in markup', () => {
    render(
      <MemberAvatar name="周知行" avatarUrl="https://example.test/member/id/avatar.webp?v=1" />,
    )

    const image = document.querySelector('img')
    expect(image).not.toBeNull()
    expect(image).toHaveAttribute('src', 'https://example.test/member/id/avatar.webp?v=1')
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(screen.queryByText('行')).not.toBeInTheDocument()
  })

  it('falls back to the final name character when no cached avatar exists', () => {
    render(<MemberAvatar name="周知行" avatarUrl={null} />)
    expect(screen.getByText('行')).toHaveClass('member-avatar')
  })

  it('falls back after an image loading failure and retries a changed URL', () => {
    const { rerender } = render(
      <MemberAvatar name="周知行" avatarUrl="https://example.test/avatar.webp?v=1" />,
    )
    const firstImage = document.querySelector('img')
    expect(firstImage).not.toBeNull()
    fireEvent.error(firstImage!)
    expect(screen.getByText('行')).toBeInTheDocument()

    rerender(<MemberAvatar name="周知行" avatarUrl="https://example.test/avatar.webp?v=2" />)
    expect(document.querySelector('img')).toHaveAttribute(
      'src',
      'https://example.test/avatar.webp?v=2',
    )
  })
})
