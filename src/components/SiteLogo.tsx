interface SiteLogoProps {
  className: string
}

const logoUrl = `${import.meta.env.BASE_URL}ustsacm.png`

export function SiteLogo({ className }: SiteLogoProps) {
  return (
    <img className={className} src={logoUrl} width="388" height="293" alt="" aria-hidden="true" />
  )
}
