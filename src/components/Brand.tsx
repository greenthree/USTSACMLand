import { Link } from 'react-router-dom'
import { SiteLogo } from './SiteLogo'

export function Brand() {
  return (
    <Link className="brand" to="/" aria-label="USTS ACM Land 首页">
      <SiteLogo className="brand-logo" />
      <span className="brand-copy">
        <strong>USTS ACM Land</strong>
        <small>苏州科技大学 ACM 集训队</small>
      </span>
    </Link>
  )
}
