// Service Worker for Jarvis PWA

// Bump on every release so a new SW activates and serves fresh assets.
// Keep aligned with package.json "version" (public/ isn't processed by Vite,
// so __APP_VERSION__ can't be injected here — this must be updated by hand).
const CACHE_NAME = 'jarvis-pwa-v4.8.12-hotfix1';
const SHELL_FILES = ['/pwa/', '/pwa/index.html'];

// Handle SKIP_WAITING to force immediate takeover
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') {
    self.skipWaiting();
  }
  // existing handlers...
});

// Badge count tracker (simple in-memory, but will try to persist via Cache API for resilience)
let badgeCount = 0;

async function getStoredBadgeCount() {
  try {
    const cache = await caches.open('badge-store');
    const resp = await cache.match('count');
    if (resp) return parseInt(await resp.text(), 10) || 0;
  } catch (e) {}
  return 0;
}

async function setStoredBadgeCount(count) {
  try {
    const cache = await caches.open('badge-store');
    await cache.put('count', new Response(count.toString()));
  } catch (e) {}
}

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== 'badge-store').map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API/WS, cache-first for shell and static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Never cache API or WebSocket
  if (url.pathname.startsWith('/pwa/api/') || url.pathname.startsWith('/pwa/ws')) return;

  // Cache-First with Network Update for assets
  if (url.pathname.endsWith('.css') || url.pathname.includes('/assets/') || url.pathname.includes('/icons/')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const networked = fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => null);
        return cached || networked;
      })
    );
    return;
  }

  // Network-First for index/shell
  event.respondWith(
    fetch(event.request).then(response => {
      if (response.ok && event.request.method === 'GET') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});

// Push notification — only show if PWA is not visible in foreground
self.addEventListener('push', (event) => {
  let data = { title: 'Jarvis', body: 'New message' };
  try {
    data = event.data.json();
  } catch {}

  const tag = data.category || 'chat';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      // Find ANY client window that belongs to the PWA and is truly visible or focused
      const hasForeground = clients.some(c => {
        return c.visibilityState === 'visible' || c.focused;
      });
      
      console.log('[SW] Push received. hasForeground:', hasForeground, 'clientCount:', clients.length);

      // Update badge count
      badgeCount = await getStoredBadgeCount();
      badgeCount++;
      await setStoredBadgeCount(badgeCount);

      if (self.navigator && self.navigator.setAppBadge) {
        try { await self.navigator.setAppBadge(badgeCount); } catch (e) {
          console.log('[SW] setAppBadge failed:', e);
        }
      }

      if (hasForeground) {
        console.log('[SW] App in foreground, suppressing notification');
        return;
      }

      console.log('[SW] App in background, showing notification');
      
      // Build notification options
      const notifOptions = {
        body: data.body,
        icon: '/pwa/icons/icon-192.png',
        badge: '/pwa/icons/icon-192.png',
        tag: data.tag || tag,
        data: data.data || { url: data.url || '/pwa/' },
        vibrate: data.requireInteraction ? [200, 100, 200, 100, 200] : [100, 50, 100],
        requireInteraction: data.requireInteraction || false,
        actions: data.actions || [],
        priority: data.requireInteraction ? 'high' : 'default',
      };
      
      // For approval notifications, add approve/deny actions
      if (data.data?.category === 'approval') {
        notifOptions.actions = [
          { action: 'approve', title: 'Approve' },
          { action: 'deny', title: 'Deny' },
        ];
      }
      
      return self.registration.showNotification(data.title, notifOptions);
    })
  );
});

// Notification click — clear badge and focus app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/pwa/';
  const action = event.action;

  event.waitUntil(
    (async () => {
      // Clear badge
      badgeCount = 0;
      await setStoredBadgeCount(0);
      if (self.navigator && self.navigator.clearAppBadge) {
        try { await self.navigator.clearAppBadge(); } catch {}
      }

      // Handle approval actions from notification
      if (action === 'approve' || action === 'deny') {
        // Try to post message to client to handle the approval
        const clients = await self.clients.matchAll({ type: 'window' });
        const pwaClient = clients.find(c => c.url.includes('/pwa/'));
        if (pwaClient) {
          pwaClient.postMessage({
            type: 'notification-action',
            action: action,
            data: event.notification.data,
          });
          if ('focus' in pwaClient) {
            return pwaClient.focus();
          }
        }
      }

      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        if (client.url.includes('/pwa/') && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })()
  );
});

// Message handler
self.addEventListener('message', (event) => {
  if (event.data === 'clear-badge') {
    badgeCount = 0;
    setStoredBadgeCount(0);
    if (self.navigator && self.navigator.clearAppBadge) {
      self.navigator.clearAppBadge().catch(() => {});
    }
  }
  
  if (event.data === 'clear-notifications') {
    self.registration.getNotifications().then(notifications => {
      notifications.forEach(notification => notification.close());
    });
  }
});

// Subscription change
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription.options).then(sub => {
      return fetch('/pwa/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'pwa-resubscribe-' + Date.now(),
          subscription: sub.toJSON(),
        }),
      });
    })
  );
});
