import { lazy, Suspense } from 'react'
import { Redirect, Route, Switch } from 'wouter'
import { BoardProvider } from '@/lib/api/board'
import { FloorApp } from '@/routes/FloorApp'
import { NotFound } from '@/routes/NotFound'

const Landing = lazy(() => import('@/routes/Landing'))
const LiveDemo = lazy(() => import('@/routes/LiveDemo'))

export default function App() {
  return (
    <Switch>
      <Route path="/">
        <Suspense fallback={null}>
          <Landing />
        </Suspense>
      </Route>
      <Route path="/demo">
        <Suspense fallback={null}>
          <LiveDemo />
        </Suspense>
      </Route>
      <Route path="/floor">
        <Redirect to="/staff" />
      </Route>
      <Route path="/:role">
        {(params) =>
          params.role === 'host' || params.role === 'staff' || params.role === 'manager' ? (
            <BoardProvider>
              <FloorApp role={params.role} />
            </BoardProvider>
          ) : (
            <NotFound />
          )
        }
      </Route>
      <Route>
        <NotFound />
      </Route>
    </Switch>
  )
}
