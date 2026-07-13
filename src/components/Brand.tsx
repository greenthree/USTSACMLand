import { Link } from 'react-router-dom'

export function Brand() {
  return (
    <Link className="brand" to="/" aria-label="USTS ACM Land 首页">
      <span className="brand-mark" aria-hidden="true">
        <span>U</span>
        <span>A</span>
      </span>
      <span className="brand-copy">
        <strong>USTS ACM Land</strong>
        <small>苏州科技大学 ACM 集训队</small>
      </span>
    </Link>
  )
}
