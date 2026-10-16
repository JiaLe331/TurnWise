import { lazy, Suspense } from 'react'
import { Redirect, Route, Switch } from 'wouter'
import { FloorModelProvider, LIVE_FLOOR } from '@/features/floor-scene/floorModel'
import { ReplayProvider, useReplay } from '@/features/replay/ReplayProvider'
import { REPLAY_FLOOR } from '@/features/replay/replayFloor'
import { POLL_MS } from '@/config'
import { BoardProvider } from '@/lib/api/board'
import { FloorApp, type RouteRole } from '@/routes/FloorApp'
import { NotFound } from '@/routes/NotFound'

const Landing = lazy(() => import('@/routes/Landing'))
/** Archived: the original standalone live demo, superseded by the replay source in the main views. */
const LiveDemo = lazy(() => import('@/routes/LiveDemo'))

export default function App() {
  return (
    <Switch>
      <Route path="/">
        <Suspense fallback={null}>
          <Landing />
        </Suspense>
      </Route>
      {/* The replay now runs inside the main views; the original demo page is kept at /demo/classic. */}
      <Route path="/demo">
        <Redirect to="/manager?source=replay" replace />
      </Route>
      <Route path="/demo/classic">
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
            <ReplayProvider>
              <SourcedFloor role={params.role} />
            </ReplayProvider>
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

/**
 * The role views on whichever source is active: the live outlet, or a private replay session.
 * A new session remounts the board so nothing from the other source lingers in the cache.
 */
function SourcedFloor({ role }: { role: RouteRole }) {
  const replay = useReplay()
  const sessionId = replay.session?.session_id
  return (
    <BoardProvider key={sessionId ?? 'live'} pollMs={sessionId ? 1000 : POLL_MS}>
      <FloorModelProvider model={sessionId ? REPLAY_FLOOR : LIVE_FLOOR}>
        <FloorApp role={role} />
      </FloorModelProvider>
    </BoardProvider>
  )
}
