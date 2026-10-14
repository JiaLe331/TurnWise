import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'sonner'
import { IdentityProvider } from '@/lib/identity/dev-identity'
import App from './App'
import './styles/tokens.css'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <IdentityProvider>
        <App />
        <Toaster
          position="bottom-center"
          mobileOffset={{ bottom: 80 }}
          toastOptions={{
            style: { fontFamily: 'var(--font-sans)', fontSize: 15, borderRadius: 12 },
          }}
        />
      </IdentityProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
