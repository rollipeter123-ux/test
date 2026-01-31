/**
 * Modernes Data-Fetching Modul mit Caching und Offline-Support
 * ES6 Module für bessere Performance
 */

class DataFetcher {
  constructor(options = {}) {
    this.cache = new Map();
    this.cacheDuration = options.cacheDuration || 5 * 60 * 1000; // 5 Minuten
    this.offlineStorage = 'waterDataCache';
    this.apiBase = options.apiBase || '/api';
    
    this.initServiceWorker();
    this.setupCacheCleanup();
  }

  // Service Worker für Offline-Funktionalität
  initServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(console.error);
    }
  }

  // Cache-Aufräumen
  setupCacheCleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.cache.entries()) {
        if (now - value.timestamp > this.cacheDuration) {
          this.cache.delete(key);
        }
      }
    }, 60000); // Jede Minute prüfen
  }

  // Haupt-Fetch-Funktion mit allen Optimierungen
  async fetchWaterAnalysis(plz, forceRefresh = false) {
    const cacheKey = `analysis_${plz}`;
    
    // 1. Memory Cache prüfen
    if (!forceRefresh && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheDuration) {
        return { ...cached.data, source: 'memory_cache' };
      }
    }

    // 2. IndexedDB für Offline-Support prüfen
    if (!navigator.onLine) {
      const offlineData = await this.getOfflineData(plz);
      if (offlineData) {
        return { ...offlineData, source: 'offline_storage', offline: true };
      }
      throw new Error('Offline und keine gespeicherten Daten verfügbar');
    }

    // 3. API Request mit Retry-Logic
    try {
      const data = await this.fetchWithRetry(`${this.apiBase}/water-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plz })
      });

      // 4. In Caches speichern
      this.cache.set(cacheKey, {
        data,
        timestamp: Date.now()
      });

      await this.saveOfflineData(plz, data);

      // 5. Performance Metrics loggen
      this.logAnalytics('analysis_fetch', {
        plz,
        success: true,
        cacheHit: false
      });

      return { ...data, source: 'api' };

    } catch (error) {
      // Fallback: Statische Daten für Demo
      if (error.message.includes('Failed to fetch')) {
        return this.getFallbackData(plz);
      }
      throw error;
    }
  }

  // Fetch mit Retry und Timeout
  async fetchWithRetry(url, options, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const response = await fetch(url, {
          ...options,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();

      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
      }
    }
  }

  // Offline-Daten in IndexedDB
  async saveOfflineData(plz, data) {
    if (!('indexedDB' in window)) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.offlineStorage, 1);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('analysis')) {
          db.createObjectStore('analysis', { keyPath: 'plz' });
        }
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction(['analysis'], 'readwrite');
        const store = transaction.objectStore('analysis');
        
        store.put({
          plz,
          data,
          timestamp: Date.now()
        });

        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(e.target.error);
      };

      request.onerror = (e) => reject(e.target.error);
    });
  }

  async getOfflineData(plz) {
    if (!('indexedDB' in window)) return null;

    return new Promise((resolve) => {
      const request = indexedDB.open(this.offlineStorage, 1);

      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction(['analysis'], 'readonly');
        const store = transaction.objectStore('analysis');
        const getRequest = store.get(plz);

        getRequest.onsuccess = () => {
          const result = getRequest.result;
          // Nur Daten zurückgeben, die jünger als 7 Tage sind
          if (result && Date.now() - result.timestamp < 7 * 24 * 60 * 60 * 1000) {
            resolve(result.data);
          } else {
            resolve(null);
          }
        };

        getRequest.onerror = () => resolve(null);
      };

      request.onerror = () => resolve(null);
    });
  }

  // Fallback für Demo/Offline-Modus
  getFallbackData(plz) {
    const hash = plz.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const seed = (hash % 100) / 100;

    return {
      success: true,
      plz,
      city: this.guessCityFromPLZ(plz),
      waterData: {
        pfas: { value: (10 + seed * 30).toFixed(1), unit: 'ng/L', limit: 20 },
        nitrate: { value: (20 + seed * 30).toFixed(1), unit: 'mg/L', limit: 50 },
        hardness: { value: (10 + seed * 15).toFixed(0), unit: '°dH' }
      },
      riskAssessment: {
        level: seed > 0.7 ? 'medium' : seed > 0.4 ? 'elevated' : 'low',
        score: Math.round(seed * 70),
        color: seed > 0.7 ? 'orange' : seed > 0.4 ? 'yellow' : 'green'
      },
      recommendations: [
        {
          id: 'lotus_vita',
          name: 'Lotus Vita Fontana',
          type: 'countertop',
          price: 329
        }
      ],
      source: 'fallback_data',
      offline: true
    };
  }

  guessCityFromPLZ(plz) {
    const cities = {
      '10': 'Berlin',
      '20': 'Hamburg',
      '30': 'Hannover',
      '40': 'Düsseldorf',
      '50': 'Köln',
      '60': 'Frankfurt',
      '70': 'Stuttgart',
      '80': 'München',
      '90': 'Nürnberg'
    };
    
    const prefix = plz.substring(0, 2);
    return cities[prefix] || 'Unbekannte Region';
  }

  // Analytics für Performance-Monitoring
  logAnalytics(event, data) {
    if (typeof gtag !== 'undefined') {
      gtag('event', event, data);
    }
    
    // Eigenes Logging
    const logEntry = {
      event,
      timestamp: new Date().toISOString(),
      ...data,
      userAgent: navigator.userAgent,
      online: navigator.onLine
    };

    // Console im Dev-Modus
    if (process.env.NODE_ENV === 'development') {
      console.log('Analytics:', logEntry);
    }
  }

  // Cache leeren
  clearCache() {
    this.cache.clear();
    if ('indexedDB' in window) {
      indexedDB.deleteDatabase(this.offlineStorage);
    }
  }
}

// Export als ES6 Modul
export default DataFetcher;
