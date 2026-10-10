import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// fonts ship with the app (no Google Fonts request), so text renders the same offline
import '@fontsource-variable/anek-latin/wdth.css'
import '@fontsource/hind/400.css'
import '@fontsource/hind/500.css'
import '@fontsource/hind/600.css'
import './styles.css'
import App from './App'
import { registerOffline } from './offline/register'

registerOffline()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
