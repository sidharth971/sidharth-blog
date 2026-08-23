import { RouterProvider } from 'react-router-dom'
import { ThemeProvider } from 'next-themes'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/contexts/AuthContext'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { router } from '@/routes/router'

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <TooltipProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
