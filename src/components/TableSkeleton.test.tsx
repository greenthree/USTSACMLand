import { render, screen } from '@testing-library/react'
import { TableSkeleton } from './TableSkeleton'

describe('TableSkeleton', () => {
  it('renders with accessibility status attributes and default label', () => {
    const { container } = render(<TableSkeleton />)
    const statusWrap = screen.getByRole('status')
    expect(statusWrap).toHaveAttribute('aria-busy', 'true')
    expect(statusWrap).toHaveAttribute('aria-label', '正在读取公开榜单')
    expect(screen.getByText('正在读取公开榜单')).toBeInTheDocument()

    const rows = container.querySelectorAll('.skeleton-row')
    expect(rows).toHaveLength(8)
  })

  it('supports custom label, row count, and custom className', () => {
    const { container } = render(
      <TableSkeleton label="正在计算增量排名" rowCount={5} className="custom-wrap" />,
    )
    const statusWrap = screen.getByRole('status')
    expect(statusWrap).toHaveAttribute('aria-label', '正在计算增量排名')
    expect(statusWrap).toHaveClass('table-skeleton-wrap', 'custom-wrap')
    expect(screen.getByText('正在计算增量排名')).toBeInTheDocument()

    const rows = container.querySelectorAll('.skeleton-row')
    expect(rows).toHaveLength(5)
  })
})
