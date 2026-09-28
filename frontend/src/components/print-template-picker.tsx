import { useEffect, useState } from 'react'
import { LayoutTemplate } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { printTemplatesApi, type PrintDocType, type PrintTemplateRow } from '@/lib/api'

interface PrintTemplatePickerProps {
  /** Which saved-template list to show. */
  docType: PrintDocType
  /** Called with the picked template's config (falls back to nothing when cancelled). */
  onSelect: (config: unknown, name: string | null) => void
  variant?: 'outline' | 'ghost' | 'secondary'
  size?: 'sm' | 'icon-sm' | 'icon'
  /** Button label; omit for icon-only buttons. */
  label?: string
  className?: string
}

/**
 * Dropdown of saved print templates (Print Designer) for one docType.
 * Picking a template calls onSelect immediately with its config so the caller
 * can print/PDF the current document with that design. Renders nothing when
 * no templates are saved for the docType, so pages without custom designs
 * keep their original toolbar.
 */
export function PrintTemplatePicker({
  docType,
  onSelect,
  variant = 'outline',
  size = 'sm',
  label = 'Template',
  className,
}: PrintTemplatePickerProps) {
  const [templates, setTemplates] = useState<PrintTemplateRow[]>([])

  useEffect(() => {
    let cancelled = false
    printTemplatesApi
      .list(docType)
      .then((r) => {
        if (!cancelled) setTemplates(r.templates ?? [])
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [docType])

  if (templates.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          <LayoutTemplate className="h-3.5 w-3.5" />
          {label ? <span>{label}</span> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Print with template</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {templates.map((t) => (
          <DropdownMenuItem key={t.id} onClick={() => onSelect(t.config, t.name)}>
            {t.name}
            {t.isDefault ? (
              <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">default</span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
