import { createContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'
import { signInWithPassword, signOut as signOutRequest } from '@/lib/auth'

interface AuthContextValue {
  session: Session | null
  user: User | null
  isLoading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setIsLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => subscription.subscription.unsubscribe()
  }, [])

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    isLoading,
    signIn: async (email, password) => {
      await signInWithPassword(email, password)
    },
    signOut: async () => {
      await signOutRequest()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
