import CircleAlert from 'lucide-react/dist/esm/icons/circle-alert'

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <CircleAlert size={24} aria-hidden="true" />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  )
}
