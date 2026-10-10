// Registers the service worker in production builds. A new version waits until every HighGround
// tab is closed: we never reload the page under someone in the middle of a storm.
export function registerOffline() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/', type: 'classic' }).catch(() => {})
  })
}
