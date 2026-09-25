import { useState } from 'react'
import { KeyRound, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authApi } from '@/lib/api'
import { useAuth } from '@/auth/auth-context'

const RULES = [
  { test: (v: string) => v.length >= 8, label: 'At least 8 characters' },
  { test: (v: string) => /[A-Z]/.test(v), label: 'One uppercase letter' },
  { test: (v: string) => /[a-z]/.test(v), label: 'One lowercase letter' },
  { test: (v: string) => /[0-9]/.test(v), label: 'One number' },
  { test: (v: string) => /[^A-Za-z0-9]/.test(v), label: 'One special character' },
]

export default function ChangePasswordPage() {
  const { currentUser, refresh, logout } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const unmet = RULES.filter((r) => !r.test(newPassword))
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword
  const ready = currentPassword.length > 0 && unmet.length === 0 && !mismatch

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await authApi.changePassword(currentPassword, newPassword)
      // Re-read the profile so requirePasswordChange clears before the app
      // shell (and the rest of the API) becomes reachable again.
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Choose a new password</h1>
              <p className="text-sm text-muted-foreground">
                {currentUser?.username ? `Signed in as ${currentUser.username}. ` : ''}
                You must set a new password before using Opal Line.
              </p>
            </div>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <ul className="grid grid-cols-1 gap-0.5 text-xs text-muted-foreground sm:grid-cols-2">
                {RULES.map((r) => {
                  const ok = r.test(newPassword)
                  return (
                    <li key={r.label} className={ok ? 'text-success-700 dark:text-success-300' : undefined}>
                      {ok ? '✓' : '•'} {r.label}
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {mismatch && <p className="text-xs text-destructive">Passwords do not match.</p>}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={!ready || busy} className="flex-1">
                <KeyRound className="mr-2 h-4 w-4" />
                {busy ? 'Saving…' : 'Set new password'}
              </Button>
              <Button type="button" variant="ghost" onClick={logout}>
                Sign out
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
