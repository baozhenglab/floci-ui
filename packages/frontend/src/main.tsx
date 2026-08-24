import React from 'react'
import ReactDOM from 'react-dom/client'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import App from './App'
import {ErrorBoundary} from '@/components/ErrorBoundary'
import './index.css'

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 1,
            staleTime: 3000,
        },
    },
})

// Two boundaries by design: this one is the last resort for a throw in the
// shell itself (Layout, router, providers), which would otherwise blank the
// page. The route-scoped boundary inside Layout catches the common case and
// keeps the navigation usable.
ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ErrorBoundary label="Floci UI">
            <QueryClientProvider client={queryClient}>
                <App/>
            </QueryClientProvider>
        </ErrorBoundary>
    </React.StrictMode>
)
