/**
 * Service Worker für Offline-Funktionalität, Caching und PWA-Features
 */

const CACHE_NAME = 'wasserfilter-v4';
const OFFLINE_URL = '/offline.html';

// Assets die gecached werden sollen
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/styles/main.css',
  '/scripts/main.js',
  '/images/logo.png',
  '/manifest.json',
  '/favicon.ico'
];

// API Endpoints die gecached werden sollen
const API_CACHE_PATTERNS = [
  '/api/water-analysis',
  '/api/plz-data'
];

// Install Event - Precache wichtiger Assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate Event - Alte Caches bereinigen
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Strategie: Cache First, dann Network
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Handle API requests with Network First, then Cache
  if (API_CACHE_PATTERNS.some(pattern => url.pathname.includes(pattern))) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // Handle static assets with Cache First
  if (PRECACHE_ASSETS.some(asset => url.pathname.includes(asset))) {
    event.respondWith(handleStaticRequest(request));
    return;
  }

  // For all other requests: Network First
  event.respondWith(handleNetworkFirst(request));
});

// API Request Handler
async function handleApiRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  
  try {
    // Try network first
    const networkResponse = await fetch(request);
    
    // Clone response to cache it
    const responseToCache = networkResponse.clone();
    
    // Cache successful responses
    if (networkResponse.status === 200) {
      cache.put(request, responseToCache);
    }
    
    return networkResponse;
  } catch (error) {
    // Network failed, try cache
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline fallback for API
    return new Response(
      JSON.stringify({ 
        error: 'Offline', 
        message: 'Sie sind offline. Bitte stellen Sie eine Internetverbindung her.' 
      }),
      { 
        status: 503, 
        headers: { 'Content-Type': 'application/json' } 
      }
    );
  }
}

// Static Asset Handler
async function handleStaticRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    // Return cached response but also update cache in background
    event.waitUntil(updateCache(request, cache));
    return cachedResponse;
  }
  
  return fetch(request);
}

// Network First Handler
async function handleNetworkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    return networkResponse;
  } catch (error) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // If offline and no cache, show offline page for navigation requests
    if (request.mode === 'navigate') {
      return caches.match(OFFLINE_URL);
    }
    
    throw error;
  }
}

// Background Sync für Formulare
self.addEventListener('sync', event => {
  if (event.tag === 'sync-analytics') {
    event.waitUntil(syncAnalytics());
  }
  
  if (event.tag === 'sync-newsletter') {
    event.waitUntil(syncNewsletterSubscriptions());
  }
});

// Push Notifications
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  
  const options = {
    body: data.body || 'Neue Wasserqualitäts-Daten verfügbar',
    icon: '/images/icon-192.png',
    badge: '/images/badge-72.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/'
    },
    actions: [
      {
        action: 'view',
        title: 'Anzeigen'
      },
      {
        action: 'close',
        title: 'Schließen'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Trinkwasser Monitor', options)
  );
});

// Notification Click Handler
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.action === 'close') {
    return;
  }
  
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      // Check if there's already a window/tab open
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      
      // Open new window if none exists
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url || '/');
      }
    })
  );
});

// Helper Functions
async function updateCache(request, cache) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.status === 200) {
      cache.put(request, networkResponse.clone());
    }
  } catch (error) {
    // Silently fail - we have cached response already
  }
}

async function syncAnalytics() {
  const db = await openAnalyticsDB();
  const pendingEvents = await getAllPendingEvents(db);
  
  for (const event of pendingEvents) {
    try {
      await fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event)
      });
      
      await deleteEvent(db, event.id);
    } catch (error) {
      console.error('Failed to sync analytics event:', error);
      break;
    }
  }
}

async function syncNewsletterSubscriptions() {
  // Similar implementation for newsletter subscriptions
}

// IndexedDB für Offline-Daten
function openAnalyticsDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('AnalyticsDB', 1);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('events')) {
        db.createObjectStore('events', { keyPath: 'id' });
      }
    };
    
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

function getAllPendingEvents(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['events'], 'readonly');
    const store = transaction.objectStore('events');
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteEvent(db, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['events'], 'readwrite');
    const store = transaction.objectStore('events');
    const request = store.delete(id);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
