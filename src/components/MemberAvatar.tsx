import { useEffect, useState } from 'react'

interface MemberAvatarProps {
  name: string
  avatarUrl?: string | null
  className?: string
}

export function MemberAvatar({ name, avatarUrl, className = '' }: MemberAvatarProps) {
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => setLoadFailed(false), [avatarUrl])

  const classes = ['member-avatar', className].filter(Boolean).join(' ')
  if (!avatarUrl || loadFailed) {
    return <span className={classes}>{name.slice(-1)}</span>
  }

  return (
    <img
      className={classes}
      src={avatarUrl}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setLoadFailed(true)}
    />
  )
}
