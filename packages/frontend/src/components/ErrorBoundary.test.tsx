import {beforeEach, describe, expect, test, vi} from 'vitest'
import {render, screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {ErrorBoundary} from './ErrorBoundary'

function Boom({message = 'kaboom'}: {message?: string}): never {
    throw new Error(message)
}

beforeEach(() => {
    // React logs every caught render error; silence it so a passing suite stays
    // readable, while componentDidCatch's own console.error is still asserted.
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('ErrorBoundary', () => {
    test('renders children when nothing throws', () => {
        render(
            <ErrorBoundary>
                <p>healthy</p>
            </ErrorBoundary>,
        )
        expect(screen.getByText('healthy')).toBeInTheDocument()
    })

    test('replaces a throwing subtree with the fallback instead of blanking it', () => {
        render(
            <ErrorBoundary label="Cloud Explorer">
                <Boom/>
            </ErrorBoundary>,
        )
        expect(screen.getByRole('alert')).toBeInTheDocument()
        expect(screen.getByText('Cloud Explorer failed to render')).toBeInTheDocument()
    })

    test('shows the error message so the failure is diagnosable in place', () => {
        render(
            <ErrorBoundary>
                <Boom message="schema was null"/>
            </ErrorBoundary>,
        )
        expect(screen.getByText(/schema was null/)).toBeInTheDocument()
    })

    // Pins capture and render together: without the stored componentStack the
    // fallback cannot say which component threw.
    test('renders the component stack so the throwing component is identifiable', () => {
        render(
            <ErrorBoundary>
                <Boom/>
            </ErrorBoundary>,
        )
        expect(screen.getByText(/Boom/)).toBeInTheDocument()
    })

    test('survives a caught error that carries no component stack', () => {
        // React can hand componentDidCatch an info object with a null stack.
        render(
            <ErrorBoundary>
                <Boom message="no stack here"/>
            </ErrorBoundary>,
        )
        expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    test('does not throw when the clipboard API is unavailable', async () => {
        Object.defineProperty(navigator, 'clipboard', {value: undefined, configurable: true})
        const user = userEvent.setup()
        render(
            <ErrorBoundary>
                <Boom/>
            </ErrorBoundary>,
        )
        await user.click(screen.getByRole('button', {name: /copy report/i}))
        expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    test('tells the operator their resources are untouched', () => {
        render(
            <ErrorBoundary>
                <Boom/>
            </ErrorBoundary>,
        )
        expect(screen.getByText(/resources are untouched/i)).toBeInTheDocument()
    })

    test('logs the failure rather than swallowing it', () => {
        render(
            <ErrorBoundary label="Networking">
                <Boom/>
            </ErrorBoundary>,
        )
        const logged = vi.mocked(console.error).mock.calls
        expect(logged.some((args) => args[0] === '[ErrorBoundary]')).toBe(true)
    })

    test('clears the error when resetKey changes, so navigating away recovers', () => {
        const {rerender} = render(
            <ErrorBoundary resetKey="/cloud-explorer/aws/storage">
                <Boom/>
            </ErrorBoundary>,
        )
        expect(screen.getByRole('alert')).toBeInTheDocument()

        rerender(
            <ErrorBoundary resetKey="/console/aws">
                <p>recovered</p>
            </ErrorBoundary>,
        )
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(screen.getByText('recovered')).toBeInTheDocument()
    })

    test('keeps the fallback while resetKey is unchanged', () => {
        const {rerender} = render(
            <ErrorBoundary resetKey="/same">
                <Boom/>
            </ErrorBoundary>,
        )
        rerender(
            <ErrorBoundary resetKey="/same">
                <p>ignored</p>
            </ErrorBoundary>,
        )
        expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    test('Try again re-renders the subtree, recovering when the cause is gone', async () => {
        const user = userEvent.setup()
        let shouldThrow = true
        function Flaky() {
            if (shouldThrow) throw new Error('transient')
            return <p>healthy again</p>
        }

        render(
            <ErrorBoundary>
                <Flaky/>
            </ErrorBoundary>,
        )
        expect(screen.getByRole('alert')).toBeInTheDocument()

        shouldThrow = false
        await user.click(screen.getByRole('button', {name: /try again/i}))
        expect(screen.getByText('healthy again')).toBeInTheDocument()
    })

    test('Copy report puts the location and stack on the clipboard', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        // Order matters: userEvent.setup() installs its own clipboard stub, so
        // ours has to be defined after it. navigator.clipboard is also a
        // getter-only property in jsdom, hence defineProperty over assignment.
        const user = userEvent.setup()
        Object.defineProperty(navigator, 'clipboard', {
            value: {writeText},
            configurable: true,
        })

        render(
            <ErrorBoundary label="Serverless">
                <Boom message="invoke failed"/>
            </ErrorBoundary>,
        )
        await user.click(screen.getByRole('button', {name: /copy report/i}))

        expect(writeText).toHaveBeenCalledTimes(1)
        const report = writeText.mock.calls[0][0] as string
        expect(report).toContain('Serverless')
        // Assert the values, not the labels: a report that kept its headings and
        // dropped every value would satisfy a `toContain('Location:')` check.
        expect(report).toContain(`Location: ${window.location.pathname}`)
        expect(report).toMatch(/Error: Error: invoke failed/)
        expect(report).toMatch(/Stack:\n[\s\S]*\bat\b/)
        // The component stack must name the component that threw.
        expect(report).toMatch(/Component stack:[\s\S]*Boom/)
        expect(await screen.findByRole('button', {name: /report copied/i})).toBeInTheDocument()
    })
})
