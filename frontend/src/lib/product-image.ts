import { safeImageUrl } from '@/lib/utils'

const API_ORIGIN = (import.meta.env.VITE_API_BASE ?? '').replace(/\/api\/v1$/, '') || ''

/** First usable image for a product: primary image or first gallery entry. */
export function productImageSrc(p: { image?: string | null; images?: string[] | null }): string | undefined {
  const candidates = [p.image, ...(p.images ?? [])].filter(Boolean) as string[]
  for (const c of candidates) {
    const remote = safeImageUrl(c)
    if (remote) return remote
    if (c.startsWith('/uploads/')) return `${API_ORIGIN}${c}`
  }
  return undefined
}

/**
 * Every usable image URL for a product, primary first — local /uploads files
 * are resolved against the API origin, remote URLs run through safeImageUrl.
 */
export function productImageGallery(p: { image?: string | null; images?: string[] | null }): string[] {
  const candidates = [p.image, ...(p.images ?? [])].filter(Boolean) as string[]
  const out: string[] = []
  for (const c of candidates) {
    if (c.startsWith('/uploads/')) {
      const url = `${API_ORIGIN}${c}`
      if (!out.includes(url)) out.push(url)
      continue
    }
    const remote = safeImageUrl(c)
    if (remote && !out.includes(remote)) out.push(remote)
  }
  return out
}
