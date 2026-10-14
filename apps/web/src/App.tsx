import { Redirect, Route, Switch } from 'wouter'
import { BoardProvider } from '@/lib/api/board'
import { FloorApp } from '@/routes/FloorApp'
import { NotFound } from '@/routes/NotFound'

export default function App() {
  return (
    <Switch>
      <Route path="/">
        <Redirect to="/staff" />
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
