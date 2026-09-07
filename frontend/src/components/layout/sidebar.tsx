import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronRight, LogOut, Gem, ShieldCheck } from 'lucide-react'
import { navSections } from '@/config/navigation'
import { moduleForPath } from '@/lib/permissions'
import { useAuth } from '@/auth/auth-context'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface SidebarProps {
  collapsed: boolean
  onNavigate?: () => void
}

export function Sidebar({ collapsed, onNavigate }: SidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { hasPermission, currentUser, logout } = useAuth()
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(navSections.map((s) => [s.label, true])),
  )

  const visibleSections = useMemo(
    () =>
      navSections
        .map((s) => ({
          ...s,
          items: s.items.filter((i) => hasPermission(moduleForPath(i.path), 'view')),
        }))
        .filter((s) => s.items.length > 0),
    [hasPermission],
  )

  const isPathActive = (path: string) =>
    path === '/'
      ? location.pathname === '/'
      : location.pathname === path || location.pathname.startsWith(`${path}/`)

  useEffect(() => {
    const section = visibleSections.find((s) =>
      s.items.some((i) => i.path !== '/' && isPathActive(i.path)),
    )
    if (section) {
      setExpanded((prev) => ({ ...prev, [section.label]: true }))
    }
  }, [location.pathname, visibleSections])

  const isActive = isPathActive

  const toggleSection = (label: string) => {
    if (collapsed) return
    setExpanded((prev) => ({ ...prev, [label]: !prev[label] }))
  }

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <aside
      className={cn(
        'flex h-full flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-[64px]' : 'w-[248px]',
      )}
    >
      <div className={cn('flex items-center gap-3 px-4 pt-5', collapsed && 'justify-center px-0')}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary-400 to-primary-700 shadow-lg shadow-primary-950/40 ring-1 ring-white/10">
          <Gem className="h-5 w-5 text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-[15px] font-bold leading-tight tracking-tight text-white">
              OPAL LINE
            </p>
            <p className="truncate text-[10.5px] font-medium uppercase tracking-widest text-sidebar-muted">
              Jewellery Billing ERP
            </p>
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="mx-4 mt-4 rounded-md border border-sidebar-border/60 bg-white/[0.04] px-3 py-2">
          <p className="text-[11px] font-medium text-sidebar-muted">92.5 Sterling Silver</p>
          <p className="mt-0.5 text-[11px] text-primary-200">Ecommerce · Shopify Connected</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 sidebar-scroll">
        <TooltipProvider delayDuration={300}>
          {visibleSections.map((section) => {
            const isOpen = expanded[section.label]
            return (
              <div key={section.label} className="mb-4">
                <button
                  onClick={() => toggleSection(section.label)}
                  className={cn(
                    'flex w-full items-center px-2 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-sidebar-muted/80 transition-colors hover:text-sidebar-foreground',
                    collapsed && 'justify-center',
                  )}
                >
                  {!collapsed && (
                    <>
                      <span>{section.label}</span>
                      <ChevronRight
                        className={cn(
                          'ml-auto h-3 w-3 transition-transform',
                          isOpen && 'rotate-90',
                        )}
                      />
                    </>
                  )}
                </button>
                {isOpen && (
                  <nav className={cn('space-y-0.5', collapsed && 'space-y-1')}>
                    {section.items.map((item) => {
                      const active = isActive(item.path)
                      const content = (
                        <Link
                          to={item.path}
                          onClick={onNavigate}
                          className={cn(
                            'group relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium transition-all duration-150',
                            collapsed && 'justify-center px-0 py-2.5',
                            active
                              ? 'bg-sidebar-active text-sidebar-active-foreground shadow-[0_0_0_1px_rgba(139,92,246,0.4),0_4px_16px_-4px_rgba(124,58,237,0.55)]'
                              : 'text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground',
                          )}
                        >
                          <item.icon
                            className={cn(
                              'h-4 w-4 shrink-0 transition-colors',
                              active
                                ? 'text-white'
                                : 'text-sidebar-muted group-hover:text-sidebar-foreground',
                            )}
                          />
                          {!collapsed && <span className="truncate">{item.title}</span>}
                          {!collapsed && item.badge && (
                            <span className="ml-auto rounded-full bg-primary-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              {item.badge}
                            </span>
                          )}
                        </Link>
                      )
                      return collapsed ? (
                        <Tooltip key={item.path}>
                          <TooltipTrigger asChild>{content}</TooltipTrigger>
                          <TooltipContent side="right">{item.title}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <div key={item.path}>{content}</div>
                      )
                    })}
                  </nav>
                )}
              </div>
            )
          })}
        </TooltipProvider>
      </div>

      <div className="border-t border-sidebar-border p-3">
        <div className="mb-2 flex items-center gap-2.5 rounded-md bg-white/[0.04] px-2.5 py-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-primary-700 text-[10px] font-bold text-white">
            {currentUser ? currentUser.name.split(' ').map((p) => p[0]).join('').slice(0, 2) : '?'}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[12px] font-semibold text-sidebar-foreground">{currentUser?.name ?? '—'}</p>
              <p className="flex items-center gap-1 truncate text-[10.5px] text-sidebar-muted">
                <ShieldCheck className="h-3 w-3 shrink-0" /> {currentUser?.role ?? '—'}
              </p>
            </div>
          )}
        </div>
        <button
          onClick={handleLogout}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium text-sidebar-muted transition-colors hover:bg-red-500/10 hover:text-red-300',
            collapsed && 'justify-center px-0',
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
      <style>{`
        .sidebar-scroll::-webkit-scrollbar { width: 6px; }
        .sidebar-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border: 0; }
        .sidebar-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
      `}</style>
    </aside>
  )
}
