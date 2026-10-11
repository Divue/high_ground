import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
// fonts ship with the app (no Google Fonts request), so text renders the same offline
import '@fontsource-variable/anek-latin/wdth.css'
import '@fontsource/hind/400.css'
import '@fontsource/hind/500.css'
import '@fontsource/hind/600.css'
import './styles.css'
import { registerOffline } from './offline/register'

registerOffline()

// "/" is the landing page; the map lives at "/app". Links made before the landing page existed
// (?replay=..., ?motion=..., #proof and the other screen hashes) still open the map.
const App = lazy(() => import('./App'))
const Landing = lazy(() => import('./landing/Landing'))
const APP_HASHES = ['tonight', 'whatif', 'proof', 'hospitals', 'about', 'admin']

function wantsApp() {
  const { pathname, search, hash } = window.location
  if (pathname.startsWith('/app')) return true
  const q = new URLSearchParams(search)
  if (q.has('replay') || q.has('motion') || q.has('q')) return true
  return APP_HASHES.includes(hash.replace('#', ''))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      {wantsApp() ? <App /> : <Landing />}
    </Suspense>
  </StrictMode>,
)
