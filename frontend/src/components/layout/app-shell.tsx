import { useEffect, useState, useCallback } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './sidebar'
import { Header } from './header'
import { SearchCommand } from './search-command'
import { useMediaQuery } from '@/hooks/use-media-query'

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const location = useLocation()
  const isMobile = useMediaQuery('(max-width: 767px)')

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setMobileOpen((v) => !v)
    } else {
      setCollapsed((v) => !v)
    }
  }, [isMobile])

  const closeMobileSidebar = useCallback(() => {
    setMobileOpen(false)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  useEffect(() => {
    if (isMobile) {
      setCollapsed(false)
    }
  }, [isMobile])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {isMobile && mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 transition-opacity"
          onClick={closeMobileSidebar}
        />
      )}

      <div
        className={`
          ${isMobile ? 'fixed inset-y-0 left-0 z-50' : 'relative'}
          ${isMobile && !mobileOpen ? '-translate-x-full' : 'translate-x-0'}
          transition-transform duration-200 ease-in-out
        `}
      >
        <Sidebar collapsed={isMobile ? false : collapsed} onNavigate={closeMobileSidebar} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header onToggleSidebar={toggleSidebar} onOpenSearch={() => setSearchOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <SearchCommand open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  )
}
