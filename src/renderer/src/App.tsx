import { useEffect, useState } from 'react'
import { PetView } from './views/PetView'
import { Panel } from './views/Panel'
import { SettingsView } from './views/Settings'
import { Onboarding } from './views/Onboarding'

export type Route = 'pet' | 'panel' | 'settings' | 'onboarding'

const ROUTES: readonly Route[] = ['pet', 'panel', 'settings', 'onboarding']

/** Accepts "#/panel", "/panel", "panel" etc. */
export function parseRoute(raw: string): Route {
  const name = raw.replace(/^#?\/?/, '').split(/[/?]/)[0]
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : 'pet'
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

  switch (route) {
    case 'panel':
      return <Panel />
    case 'settings':
      return <SettingsView />
    case 'onboarding':
      return <Onboarding />
    default:
      return <PetView />
  }
}
