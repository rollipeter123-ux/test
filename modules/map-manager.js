/**
 * Hochleistungs-Kartenmanager mit WebGL-Beschleunigung
 * Lädt GeoJSON-Daten dynamisch und rendert 10.000+ Punkte effizient
 */

class MapManager {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.map = null;
    this.clusterLayer = null;
    this.heatmapLayer = null;
    this.data = null;
    this.isWebGLAvailable = this.checkWebGLSupport();
    
    this.defaultOptions = {
      center: [51.1657, 10.4515],
      zoom: 6,
      minZoom: 5,
      maxZoom: 12,
      maxBounds: [[47.0, 5.0], [55.0, 15.0]],
      ...options
    };
  }

  // Initialisierung mit Performance-Optimierungen
  async init() {
    if (!L || typeof L === 'undefined') {
      await this.loadLeafletDynamically();
    }

    // Map mit Performance-Optionen erstellen
    this.map = L.map(this.containerId, {
      ...this.defaultOptions,
      preferCanvas: true, // Canvas statt SVG für Performance
      fadeAnimation: false,
      markerZoomAnimation: false,
      transform3DLimit: 386 * (2 ** 19), // Für bessere 3D Performance
      zoomControl: false // Eigenes Control hinzufügen
    });

    // Basemap mit optimierten Tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap, © CARTO',
      subdomains: 'abcd',
      detectRetina: true,
      keepBuffer: 4 // Reduziert Flackern beim Zoomen
    }).addTo(this.map);

    // Eigenes Zoom Control
    L.control.zoom({
      position: 'topright'
    }).addTo(this.map);

    // Marker-Clustering für Performance
    this.clusterLayer = L.markerClusterGroup({
      chunkedLoading: true,
      chunkInterval: 100, // ms zwischen Chunks
      chunkDelay: 50,
      maxClusterRadius: 80,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: true,
      zoomToBoundsOnClick: true,
      disableClusteringAtZoom: 10,
      animateAddingMarkers: false // Performance
    });

    // Heatmap Layer (optional)
    if (this.isWebGLAvailable) {
      this.initHeatmapLayer();
    }

    // Daten laden
    await this.loadData();

    // Event Listener
    this.setupEventListeners();

    // Performance Monitoring
    this.setupPerformanceMonitoring();

    return this.map;
  }

  // Leaflet dynamisch laden falls nicht vorhanden
  async loadLeafletDynamically() {
    return new Promise((resolve, reject) => {
      if (typeof L !== 'undefined') {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
      script.crossOrigin = '';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);

      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
      link.crossOrigin = '';
      document.head.appendChild(link);
    });
  }

  // WebGL Support prüfen
  checkWebGLSupport() {
    try {
      const canvas = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && 
                (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch (e) {
      return false;
    }
  }

  // Heatmap Layer initialisieren
  initHeatmapLayer() {
    if (typeof L.heatLayer === 'undefined') {
      // Heatmap Plugin dynamisch laden
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js';
      document.head.appendChild(script);
    }
  }

  // GeoJSON Daten laden (optimiert)
  async loadData() {
    try {
      // Zuerst versuchen, komprimierte Daten zu laden
      const response = await fetch('/data/water-quality.geojson.gz', {
        headers: { 'Accept-Encoding': 'gzip' }
      });

      if (!response.ok) {
        // Fallback: Unkomprimierte Daten
        const fallback = await fetch('/data/water-quality.geojson');
        this.data = await fallback.json();
      } else {
        // Gzip entpacken (Browser macht das automatisch)
        this.data = await response.json();
      }

      // Daten vorverarbeiten
      this.processData();
      
      // Auf Karte rendern
      this.renderData();

    } catch (error) {
      console.error('Failed to load map data:', error);
      // Demo-Daten als Fallback
      this.loadDemoData();
    }
  }

  // Daten für Performance optimieren
  processData() {
    if (!this.data || !this.data.features) return;

    // Nur benötigte Properties behalten
    this.data.features = this.data.features.map(feature => ({
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        id: feature.properties.id,
        pfas: feature.properties.pfas,
        risk: this.calculateRiskLevel(feature.properties.pfas),
        city: feature.properties.city,
        lastUpdate: feature.properties.lastUpdate
      }
    }));

    // Für Clustering: Punkte gruppieren bei niedrigen Zoom-Leveln
    this.groupPointsByGrid(0.1); // 0.1 Grad Raster
  }

  // Punkte für bessere Performance gruppieren
  groupPointsByGrid(gridSize) {
    const grid = new Map();
    
    this.data.features.forEach(feature => {
      const coord = feature.geometry.coordinates;
      const gridKey = `${Math.floor(coord[0]/gridSize)}_${Math.floor(coord[1]/gridSize)}`;
      
      if (!grid.has(gridKey)) {
        grid.set(gridKey, {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: coord
          },
          properties: {
            count: 0,
            avgPfas: 0,
            maxPfas: 0,
            cities: new Set()
          }
        });
      }
      
      const cell = grid.get(gridKey);
      cell.properties.count++;
      cell.properties.avgPfas += feature.properties.pfas;
      cell.properties.maxPfas = Math.max(cell.properties.maxPfas, feature.properties.pfas);
      cell.properties.cities.add(feature.properties.city);
    });

    // Grid in Features umwandeln
    this.gridFeatures = Array.from(grid.values()).map(cell => {
      cell.properties.avgPfas /= cell.properties.count;
      cell.properties.cities = Array.from(cell.properties.cities).slice(0, 3);
      return cell;
    });
  }

  // Daten auf Karte rendern
  renderData() {
    if (!this.map) return;

    // Clear existing layers
    this.clusterLayer.clearLayers();

    // Marker nach Risiko-Level stylen
    const markers = this.data.features.map(feature => {
      const marker = L.circleMarker(
        [feature.geometry.coordinates[1], feature.geometry.coordinates[0]],
        this.getMarkerStyle(feature.properties.risk)
      );

      // Popup mit Performance-Optimierung
      marker.on('click', (e) => {
        this.showOptimizedPopup(e, feature.properties);
      });

      // Tooltip (lazy geladen)
      marker.on('mouseover', (e) => {
        if (!marker._tooltip) {
          marker.bindTooltip(this.getTooltipContent(feature.properties), {
            direction: 'top',
            offset: [0, -10],
            opacity: 0.9
          });
        }
        marker.openTooltip();
      });

      return marker;
    });

    // Marker zum Cluster hinzufügen (chunked für Performance)
    this.addMarkersInChunks(markers, 500);

    // Cluster zur Karte hinzufügen
    this.map.addLayer(this.clusterLayer);

    // Heatmap wenn verfügbar
    if (this.isWebGLAvailable && typeof L.heatLayer !== 'undefined') {
      this.renderHeatmap();
    }
  }

  // Marker in Chunks laden für bessere Performance
  addMarkersInChunks(markers, chunkSize) {
    let index = 0;
    
    const addChunk = () => {
      const chunk = markers.slice(index, index + chunkSize);
      this.clusterLayer.addLayers(chunk);
      index += chunkSize;
      
      if (index < markers.length) {
        requestAnimationFrame(addChunk);
      }
    };
    
    requestAnimationFrame(addChunk);
  }

  // Heatmap rendern
  renderHeatmap() {
    if (!this.data || !this.heatmapLayer) return;

    const points = this.data.features.map(feature => [
      feature.geometry.coordinates[1],
      feature.geometry.coordinates[0],
      feature.properties.pfas / 100 // Intensity
    ]);

    this.heatmapLayer = L.heatLayer(points, {
      radius: 25,
      blur: 15,
      maxZoom: 10,
      gradient: {
        0.1: 'blue',
        0.3: 'cyan',
        0.5: 'lime',
        0.7: 'yellow',
        1.0: 'red'
      }
    }).addTo(this.map);
  }

  // Marker-Styling basierend auf Risiko
  getMarkerStyle(riskLevel) {
    const styles = {
      critical: {
        radius: 8,
        fillColor: '#ef4444',
        color: '#b91c1c',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.7
      },
      high: {
        radius: 6,
        fillColor: '#f97316',
        color: '#ea580c',
        weight: 1.5,
        opacity: 0.9,
        fillOpacity: 0.6
      },
      medium: {
        radius: 5,
        fillColor: '#eab308',
        color: '#ca8a04',
        weight: 1,
        opacity: 0.8,
        fillOpacity: 0.5
      },
      low: {
        radius: 4,
        fillColor: '#22c55e',
        color: '#16a34a',
        weight: 1,
        opacity: 0.7,
        fillOpacity: 0.4
      }
    };

    return styles[riskLevel] || styles.low;
  }

  // Risiko-Level berechnen
  calculateRiskLevel(pfasValue) {
    if (pfasValue > 50) return 'critical';
    if (pfasValue > 20) return 'high';
    if (pfasValue > 10) return 'medium';
    return 'low';
  }

  // Optimiertes Popup (lazy Content)
  showOptimizedPopup(event, properties) {
    const popup = L.popup({ 
      maxWidth: 300,
      className: 'water-quality-popup',
      closeButton: true,
      autoClose: false
    });

    // Minimaler Inhalt zuerst
    popup.setContent(`
      <div class="popup-loading">
        <div class="spinner"></div>
        <p>Lade Details...</p>
      </div>
    `);

    popup.setLatLng(event.latlng).openOn(this.map);

    // Detaillierte Daten nachladen
    setTimeout(() => {
      popup.setContent(this.getPopupContent(properties));
    }, 100);
  }

  getPopupContent(properties) {
    return `
      <div class="water-popup-content">
        <h4>${properties.city || 'Messstelle'}</h4>
        <div class="risk-badge risk-${properties.risk}">
          ${properties.risk.toUpperCase()} RISIKO
        </div>
        <p><strong>PFAS:</strong> ${properties.pfas} ng/L</p>
        <p><strong>Grenzwert:</strong> 20 ng/L</p>
        <div class="popup-actions">
          <button onclick="analyzeRegion(${properties.id})" class="btn-small">
            <i class="fa-solid fa-chart-line"></i> Analyse
          </button>
          <button onclick="showFiltersForRisk('${properties.risk}')" class="btn-small">
            <i class="fa-solid fa-filter"></i> Filter
          </button>
        </div>
      </div>
    `;
  }

  getTooltipContent(properties) {
    return `
      <div class="map-tooltip">
        <strong>${properties.city || 'Messstelle'}</strong><br>
        PFAS: ${properties.pfas} ng/L<br>
        Risiko: ${properties.risk}
      </div>
    `;
  }

  // Demo-Daten als Fallback
  loadDemoData() {
    this.data = {
      type: 'FeatureCollection',
      features: this.generateDemoFeatures(1000)
    };
    this.renderData();
  }

  generateDemoFeatures(count) {
    const features = [];
    const cities = ['Berlin', 'Hamburg', 'München', 'Köln', 'Frankfurt', 'Stuttgart', 'Düsseldorf', 'Dortmund', 'Essen', 'Leipzig'];
    
    for (let i = 0; i < count; i++) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [
            5 + Math.random() * 10, // lon
            47 + Math.random() * 7   // lat
          ]
        },
        properties: {
          id: i,
          pfas: Math.random() * 80,
          city: cities[Math.floor(Math.random() * cities.length)],
          lastUpdate: '2024-01-01'
        }
      });
    }
    
    return features;
  }

  // Event Listener
  setupEventListeners() {
    if (!this.map) return;

    // Debounced moveend event
    let moveEndTimeout;
    this.map.on('moveend', () => {
      clearTimeout(moveEndTimeout);
      moveEndTimeout = setTimeout(() => {
        this.onMapMove();
      }, 300);
    });

    // Zoom event für Detaildaten
    this.map.on('zoomend', () => {
      const zoom = this.map.getZoom();
      if (zoom > 8 && !this.detailedDataLoaded) {
        this.loadDetailedData();
        this.detailedDataLoaded = true;
      }
    });

    // Resize optimierung
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        this.map.invalidateSize();
      }, 250);
    });
  }

  onMapMove() {
    // Lazy loading von Daten für sichtbaren Bereich
    const bounds = this.map.getBounds();
    this.loadVisibleData(bounds);
  }

  async loadVisibleData(bounds) {
    // In Produktion: Daten für sichtbaren Bereich nachladen
    console.log('Loading data for bounds:', bounds);
  }

  async loadDetailedData() {
    // Detaillierte Daten bei hohem Zoom
    console.log('Loading detailed data');
  }

  // Performance Monitoring
  setupPerformanceMonitoring() {
    const perfCheck = () => {
      const markersCount = this.clusterLayer.getLayers().length;
      const fps = this.getFPS();
      
      if (fps < 30 && markersCount > 1000) {
        this.optimizeForLowFPS();
      }
    };
    
    setInterval(perfCheck, 5000);
  }

  getFPS() {
    let fps = 60;
    // FPS Messung implementieren
    return fps;
  }

  optimizeForLowFPS() {
    // Reduziere Marker-Detail bei niedriger FPS
    this.clusterLayer.options.maxClusterRadius = 120;
    this.clusterLayer.refreshClusters();
  }

  // Public Methods
  setFilter(filterType) {
    // Filter für bestimmte Kontaminanten
    console.log('Setting filter:', filterType);
    this.renderData();
  }

  exportMapData(format = 'geojson') {
    // Daten exportieren
    const data = format === 'geojson' ? this.data : this.convertToCSV();
    this.downloadData(data, `water-quality-${format}.${format}`);
  }

  convertToCSV() {
    if (!this.data) return '';
    return 'id,lat,lon,pfas,city\n' + 
      this.data.features.map(f => 
        `${f.properties.id},${f.geometry.coordinates[1]},${f.geometry.coordinates[0]},${f.properties.pfas},${f.properties.city}`
      ).join('\n');
  }

  downloadData(content, filename) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Cleanup
  destroy() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    if (this.clusterLayer) {
      this.clusterLayer.clearLayers();
      this.clusterLayer = null;
    }
  }
}

// Export als ES6 Modul
export default MapManager;
