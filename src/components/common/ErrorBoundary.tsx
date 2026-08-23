import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error in tree:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <AlertTriangle className="size-10 text-destructive" strokeWidth={1.5} />
          <div>
            <p className="font-medium">Something went wrong.</p>
            <p className="text-sm text-muted-foreground">{this.state.error.message}</p>
          </div>
          <Button onClick={() => window.location.assign('/')}>Go home</Button>
        </div>
      )
    }

    return this.props.children
  }
}
