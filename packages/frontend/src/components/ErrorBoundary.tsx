import {Component, type ErrorInfo, type ReactNode} from 'react'
import {AlertTriangle, Copy, RotateCcw} from 'lucide-react'

interface ErrorBoundaryProps {
    children: ReactNode
    /**
     * Changing this clears a caught error. Route-level boundaries pass the
     * pathname so navigating away recovers instead of stranding the operator on
     * a dead screen with no way back.
     */
    resetKey?: string
    /** Shown in the fallback and in the copied report, e.g. "Cloud Explorer". */
    label?: string
}

interface ErrorBoundaryState {
    error: Error | null
    componentStack: string | null
    copied: boolean
}

const INITIAL: ErrorBoundaryState = {error: null, componentStack: null, copied: false}

/**
 * Catches render-phase throws so one broken view cannot blank the whole console.
 *
 * React only surfaces render errors to class components, so this stays a class
 * despite the rest of the app being hooks-only. It deliberately does not catch
 * async or event-handler failures — those already surface through TanStack Query
 * error states and the typed `HttpError`.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = INITIAL

    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
        return {error}
    }

    componentDidUpdate(prev: ErrorBoundaryProps) {
        if (this.state.error && prev.resetKey !== this.props.resetKey) {
            this.setState(INITIAL)
        }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        this.setState({componentStack: info.componentStack ?? null})
        // Keep the console as the source of truth: there is no telemetry sink
        // for render failures, and inventing a silent one would hide them.
        console.error('[ErrorBoundary]', this.props.label ?? 'app', error, info.componentStack)
    }

    private report = () => {
        const {error, componentStack} = this.state
        if (!error) return
        const report = [
            `Floci UI render error${this.props.label ? ` — ${this.props.label}` : ''}`,
            `Location: ${window.location.pathname}${window.location.search}`,
            `Error: ${error.name}: ${error.message}`,
            '',
            'Stack:',
            error.stack ?? '(no stack)',
            '',
            'Component stack:',
            componentStack ?? '(no component stack)',
        ].join('\n')

        void navigator.clipboard
            ?.writeText(report)
            .then(() => this.setState({copied: true}))
            .catch(() => this.setState({copied: false}))
    }

    private retry = () => this.setState(INITIAL)

    render() {
        const {error, componentStack, copied} = this.state
        if (!error) return this.props.children

        return (
            <div className="error-boundary" role="alert">
                <div className="error-boundary-head">
                    <span className="error-boundary-icon"><AlertTriangle size={20}/></span>
                    <div>
                        <h3>{this.props.label ? `${this.props.label} failed to render` : 'Something failed to render'}</h3>
                        <p className="muted">
                            This is a bug in the console, not in your local runtime. Your resources are untouched.
                        </p>
                    </div>
                </div>

                <pre className="error-boundary-stack">
                    {error.name}: {error.message}
                    {componentStack ? `\n${componentStack}` : ''}
                </pre>

                <div className="error-boundary-actions">
                    <button className="button compact" onClick={this.retry}>
                        <RotateCcw size={12}/> Try again
                    </button>
                    <button className="button compact" onClick={this.report}>
                        <Copy size={12}/> {copied ? 'Report copied' : 'Copy report'}
                    </button>
                </div>
            </div>
        )
    }
}
