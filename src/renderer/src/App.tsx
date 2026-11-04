import { useEffect, useState } from 'react'
import { PetView } from './views/PetView'
import { Panel } from './views/Panel'
import { SettingsView } from './views/Settings'
import { Onboarding } from './views/Onboarding'
import { ShaderSmoke } from '@/components/ui/shader-smoke'
import { useWindowAwake } from './hooks/useWindowAwake'

export type Route = 'pet' | 'panel' | 'settings' | 'onboarding'

const ROUTES: readonly Route[] = ['pet', 'panel', 'settings', 'onboarding']

/** Accepts "#/panel", "/panel", "panel" etc. */
export function parseRoute(raw: string): Route {
  const name = raw.replace(/^#?\/?/, '').split(/[/?]/)[0]
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : 'pet'
}

/**
 * The faint smoke behind the panel, settings and onboarding windows (never the transparent pet).
 * One instance per window, mounted above the views so it survives their loading states.
 * The panel hides on blur, so it stops there; settings and onboarding stay on screen beside
 * other apps, so they only stop when hidden and drop to a slow 10fps while unfocused.
 */
function Backdrop({ route }: { route: Exclude<Route, 'pet'> }): JSX.Element {
  const { visible, focused } = useWindowAwake()
  const panel = route === 'panel'
  return (
    <ShaderSmoke
      className="app-smoke"
      intensity={panel ? 0.42 : 0.5}
      paused={panel ? !(visible && focused) : !visible}
      fps={focused ? 30 : 10}
    />
  )
}

export function App(): JSX.Element {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash))

  useEffect(() => {
    const onHash = (): void => setRoute(parseRoute(location.hash))
    window.addEventListener('hashchange', onHash)
    const off = window.studyPet?.onNavigate((r) => {
      const next = parseRoute(r)
      location.hash = `#/${next}`
      setRoute(next)
    })
    return () => {
      window.removeEventListener('hashchange', onHash)
      off?.()
    }
  }, [])

  useEffect(() => {
    const el = document.documentElement
    ROUTES.forEach((r) => el.classList.remove(`route-${r}`))
    el.classList.add(`route-${route}`)
  }, [route])

  if (route === 'pet') return <PetView />
  return (
    <>
      <Backdrop route={route} />
      {route === 'panel' ? <Panel /> : route === 'settings' ? <SettingsView /> : <Onboarding />}
    </>
  )
}
