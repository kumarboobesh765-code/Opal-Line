import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Gem, Loader2, LogIn, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function LoginPage() {
  const navigate = useNavigate()
  const { login, currentUser, loading: authLoading } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (currentUser) navigate('/', { replace: true })
  }, [currentUser, navigate])

  const signIn = async () => {
    if (!identifier.trim() || !password) return
    setSigningIn(true)
    setError('')
    try {
      await login(identifier.trim(), password)
      navigate('/', { replace: true })
    } catch {
      setError('Invalid username or password')
      setSigningIn(false)
    }
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-sidebar px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-primary-500/10 blur-3xl" />

      <div className="relative w-full max-w-sm sm:max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary-400 to-primary-700 shadow-lg shadow-primary-950/40 ring-1 ring-white/10 sm:h-12 sm:w-12">
            <Gem className="h-5 w-5 text-white sm:h-6 sm:w-6" />
          </div>
          <div>
            <p className="text-lg font-bold tracking-tight text-white sm:text-xl">OPAL LINE</p>
            <p className="text-[10px] font-medium uppercase tracking-widest text-sidebar-muted sm:text-[11px]">Jewellery Billing ERP</p>
          </div>
        </div>

        <Card className="shadow-2xl shadow-primary-950/40">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-lg sm:text-xl">Sign in</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Enter your Opal Line username or email and password. Permissions for each module are applied based on your role and personal overrides.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-xs text-muted-foreground">Username or email</Label>
              <Input
                id="username"
                autoComplete="username"
                placeholder="e.g. arjun or arjun@opalline.in"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && signIn()}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs text-muted-foreground">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && signIn()}
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

            <Button className="w-full" onClick={signIn} disabled={!identifier.trim() || !password || signingIn}>
              {signingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              Sign in
            </Button>
            <p className="flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> Passwords are encrypted and never stored in plain text.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
