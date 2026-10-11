import { useEffect, useState } from 'react'

type View = 'host' | 'staff' | 'manager'
type ApiStatus = 'checking' | 'connected' | 'unavailable'

const views: Record<View, { label: string; title: string; description: string; next: string }> = {
  host: {
    label: 'Host',
    title: 'Table board and waitlist',
    description: 'The host will see table status, waiting parties, and seating recommendations here.',
    next: 'Manual table and queue workflow is the next build stage.',
  },
  staff: {
    label: 'Floor staff',
    title: 'Clearing tasks',
    description: 'Floor staff will claim tasks, start cleaning, and confirm when tables are ready here.',
    next: 'No tasks are available in this scaffold.',
  },
  manager: {
    label: 'Manager',
    title: 'Outlet operations',
    description: 'Managers will configure tables and cameras, review exceptions, and inspect shift metrics here.',
    next: 'Configuration and metrics are not connected yet.',
  },
}

export default function App() {
  const [view, setView] = useState<View>('host')
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/healthz', { signal: controller.signal })
      .then((response) => {
        setApiStatus(response.ok ? 'connected' : 'unavailable')
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return
        setApiStatus('unavailable')
      })

    return () => controller.abort()
  }, [])

  const activeView = views[view]

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="TurnWise">
          <span className="brand-mark" aria-hidden="true">T</span>
          <span>TurnWise</span>
        </div>
        <span className="mode-label">Project scaffold · No live table data</span>
      </header>

      <main className="workspace">
        <div className="intro">
          <p className="eyebrow">Restaurant table operations</p>
          <h1>One clear view for every handoff.</h1>
          <p>The application structure is ready. Operational data and actions will arrive in the next build stages.</p>
        </div>

        <nav className="view-nav" aria-label="Role views">
          {(Object.keys(views) as View[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-current={view === option ? 'page' : undefined}
              onClick={() => setView(option)}
            >
              {views[option].label}
            </button>
          ))}
        </nav>

        <section className="content-card" aria-labelledby="view-title">
          <div className="card-heading">
            <div>
              <p className="eyebrow">{activeView.label} view</p>
              <h2 id="view-title">{activeView.title}</h2>
            </div>
            <span className="empty-badge">Preview only</span>
          </div>
          <div className="empty-state">
            <div className="empty-icon" aria-hidden="true">◫</div>
            <p>{activeView.description}</p>
            <small>{activeView.next}</small>
          </div>
        </section>

        <footer className="status-row">
          <span className={`status-dot status-dot--${apiStatus}`} aria-hidden="true" />
          <span>API {apiStatus}</span>
          <span className="status-separator" aria-hidden="true">·</span>
          <span>Local development</span>
        </footer>
      </main>
    </div>
  )
}
