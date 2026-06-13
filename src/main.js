// Register service worker with auto-reload on update
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/pwa/sw.js').then(reg => {
    console.log('[SW] Registered:', reg.scope);

    // Check for updates periodically. 10s was draining mobile battery
    // (≈8.640 fetches/day of /pwa/sw.js); 30 min is plenty for a PWA.
    setInterval(() => reg.update(), 30 * 60 * 1000);
  }).catch(err => {
    console.error('[SW] Registration failed:', err);
  });

  // When a new SW takes control, reload to get fresh assets
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.log('[SW] New service worker activated, reloading...');
    window.location.reload();
  });
}

// Import components
import './components/app-shell.js';
