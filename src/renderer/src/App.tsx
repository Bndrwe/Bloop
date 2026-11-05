import { useEffect, useState } from 'react'
import { PetView } from './views/PetView'
import { Panel } from './views/Panel'
import { SettingsView } from './views/Settings'
import { Onboarding } from './views/Onboarding'
import { ChatView } from './views/Chat'
import { ShaderSmoke } from '@/components/ui/shader-smoke'
import { useWindowAwake } from './hooks/useWindowAwake'
import { useSettings } from './hooks/useSettings'
import { backgroundTokens, DEFAULT_BACKGROUND_INTENSITY, DEFAULT_BACKGROUND_SPEED } from '@shared/background'

export type Route = 'pet' | 'panel' | 'settings' | 'onboarding' | 'chat'

const ROUTES: readonly Route[] = ['pet', 'panel', 'settings', 'onboarding', 'chat']

/** Accepts "#/panel", "/panel", "panel" etc. */
export function parseRoute(raw: string): Route {
  const name = raw.replace(/^#?\/?/, '').split(/[/?]/)[0]
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : 'pet'
}

/**
 * The smoke behind the panel, settings and onboarding windows (never the transparent pet).
 * One instance per window, mounted above the views so it survives their loading states.
 * Brightness, speed and the pointer follow Settings → Background live; the cards' opacity
 * follows brightness so the smoke shows through a little more as it gets bolder.
 * The panel hides on blur, so it stops there; settings and onboarding stay on screen beside
 * other apps, so they only stop when hidden and drop to a slow 10fps while unfocused.
 */
function Backdrop({ route }: { route: Exclude<Route, 'pet'> }): JSX.Element | null {
  const { visible, focused } = useWindowAwake()
  const settings = useSettings()
  const panel = route === 'panel'
  const enabled = settings?.backgroundEnabled ?? true
  const intensity = settings?.backgroundIntensity ?? DEFAULT_BACKGROUND_INTENSITY
  const speed = settings?.backgroundSpeed ?? DEFAULT_BACKGROUND_SPEED

  useEffect(() => {
    const root = document.documentElement.style
    const t = backgroundTokens(intensity, enabled)
    root.setProperty('--card-alpha', String(t.cardAlpha))
    root.setProperty('--g4', t.tertiary)
  }, [intensity, enabled])

  if (!enabled) return null
  return (
    <ShaderSmoke
      className="app-smoke"
      intensity={intensity}
      speed={speed}
      interactive={settings?.backgroundInteractive ?? true}
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
      {route === 'panel' ? <Panel /> : route === 'settings' ? <SettingsView /> : route === 'chat' ? <ChatView /> : <Onboarding />}
    </>
  )
}
