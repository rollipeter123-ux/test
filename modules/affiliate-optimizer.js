/**
 * Affiliate Conversion Optimizer mit A/B Testing
 * Erhöht die Verkaufsrate durch personalisierte Empfehlungen
 */

class AffiliateOptimizer {
  constructor() {
    this.visitorId = this.generateVisitorId();
    this.sessionStart = Date.now();
    this.viewedProducts = new Set();
    this.conversionFunnel = [];
    this.abTests = {};
    
    this.initTracking();
    this.loadPersonalizationRules();
  }

  // Visitor ID generieren
  generateVisitorId() {
    const storedId = localStorage.getItem('visitor_id');
    if (storedId) return storedId;

    const newId = 'vis_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('visitor_id', newId);
    return newId;
  }

  // Tracking initialisieren
  initTracking() {
    // Google Analytics 4
    if (typeof gtag !== 'undefined') {
      gtag('config', 'G-XXXXXXXXXX', {
        user_id: this.visitorId,
        anonymize_ip: true
      });
    }

    // Eigenes Event Tracking
    this.trackEvent('session_start', {
      referrer: document.referrer,
      user_agent: navigator.userAgent,
      screen_resolution: `${window.screen.width}x${window.screen.height}`
    });
  }

  // Produkt-Impression tracken
  trackProductView(productId, productData) {
    this.viewedProducts.add(productId);
    
    this.trackEvent('product_view', {
      product_id: productId,
      product_name: productData.name,
      product_price: productData.price,
      product_category: productData.category,
      risk_level: productData.recommendedFor,
      view_duration: 0 // Wird später aktualisiert
    });

    // In Conversion Funnel eintragen
    this.conversionFunnel.push({
      step: 'product_view',
      productId,
      timestamp: Date.now()
    });

    // Personalisierte Empfehlungen aktualisieren
    this.updateRecommendations();
  }

  // Klick auf Affiliate-Link tracken
  trackAffiliateClick(productId, linkType = 'direct') {
    this.trackEvent('affiliate_click', {
      product_id: productId,
      link_type: linkType,
      click_position: this.getClickPosition(),
      time_on_page: Date.now() - this.sessionStart
    });

    // Conversion Funnel
    this.conversionFunnel.push({
      step: 'affiliate_click',
      productId,
      timestamp: Date.now()
    });

    // Cookie für Tracking setzen (30 Tage)
    this.setAffiliateCookie(productId);

    // A/B Test auswerten
    this.evaluateABTest('link_position', linkType);
  }

  // Cookie für Affiliate-Tracking
  setAffiliateCookie(productId) {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30);
    
    document.cookie = `affiliate_ref=${productId}_${this.visitorId}; expires=${expiry.toUTCString()}; path=/; SameSite=Lax`;
  }

  // Personalisierte Empfehlungen generieren
  getPersonalizedRecommendations(riskLevel, userContext) {
    const allProducts = this.getProductCatalog();
    
    // 1. Filter nach Risiko-Level
    let filtered = allProducts.filter(product => 
      product.recommendedRiskLevels.includes(riskLevel)
    );

    // 2. Personalisierung basierend auf User Context
    filtered = this.applyPersonalizationRules(filtered, userContext);

    // 3. A/B Test Variante anwenden
    filtered = this.applyABTestVariation(filtered, 'recommendation_algorithm');

    // 4. Sortieren nach wahrscheinlichstem Konvertierung
    filtered.sort((a, b) => {
      const scoreA = this.calculateConversionScore(a, userContext);
      const scoreB = this.calculateConversionScore(b, userContext);
      return scoreB - scoreA;
    });

    // 5. Nur Top 3 zurückgeben
    return filtered.slice(0, 3);
  }

  // Conversion Score berechnen
  calculateConversionScore(product, userContext) {
    let score = 0;
    
    // Basis-Score
    score += product.commissionRate * 10;
    
    // Personalisierung
    if (userContext.isTenant && product.tenantFriendly) score += 30;
    if (userContext.hasChildren && product.childSafe) score += 25;
    if (userContext.budget === 'low' && product.price < 300) score += 20;
    if (userContext.budget === 'high' && product.price > 400) score += 15;
    
    // Historische Conversion Rate
    const historicalCR = this.getHistoricalConversionRate(product.id);
    score += historicalCR * 100;
    
    // A/B Test Gewichtung
    if (this.abTests.recommendation_algorithm?.variant === 'aggressive') {
      score += 10;
    }

    return score;
  }

  // A/B Testing
  initABTest(testName, variants) {
    const storedVariant = localStorage.getItem(`ab_test_${testName}`);
    
    if (storedVariant && variants.includes(storedVariant)) {
      this.abTests[testName] = { variant: storedVariant };
    } else {
      // Zufällige Variante zuweisen
      const variant = variants[Math.floor(Math.random() * variants.length)];
      localStorage.setItem(`ab_test_${testName}`, variant);
      this.abTests[testName] = { variant };
    }
    
    this.trackEvent('ab_test_assignment', {
      test_name: testName,
      variant: this.abTests[testName].variant
    });
  }

  applyABTestVariation(products, testName) {
    const test = this.abTests[testName];
    if (!test) return products;

    switch(test.variant) {
      case 'price_low_first':
        return products.sort((a, b) => a.price - b.price);
      case 'commission_high_first':
        return products.sort((a, b) => b.commissionRate - a.commissionRate);
      case 'effectiveness_first':
        return products.sort((a, b) => b.effectiveness - a.effectiveness);
      default:
        return products;
    }
  }

  evaluateABTest(testName, result) {
    const test = this.abTests[testName];
    if (!test) return;

    this.trackEvent('ab_test_result', {
      test_name: testName,
      variant: test.variant,
      result: result
    });
  }

  // Dynamic Pricing Anzeige
  getDynamicPricingDisplay(product) {
    const now = new Date();
    const hour = now.getHours();
    
    // Zeitbasierte Angebote
    if (hour >= 20 || hour < 6) {
      return {
        ...product,
        displayPrice: product.price * 0.95, // 5% Nachtsrabatt
        badge: '🌙 Nachtrandale'
      };
    }
    
    // Wochentag-basierte Angebote
    const day = now.getDay();
    if (day === 0 || day === 6) { // Wochenende
      return {
        ...product,
        displayPrice: product.price * 0.97,
        badge: '🎉 Wochenendangebot'
      };
    }
    
    return product;
  }

  // Urgency & Scarcity Tactics
  addUrgencyElements(productElement, product) {
    // Limited Stock
    const stock = this.getStockLevel(product.id);
    if (stock < 10) {
      const stockEl = document.createElement('div');
      stockEl.className = 'urgency-badge';
      stockEl.innerHTML = `Nur noch ${stock} verfügbar!`;
      stockEl.style.cssText = `
        background: linear-gradient(45deg, #ef4444, #dc2626);
        color: white;
        padding: 8px 12px;
        border-radius: 8px;
        font-weight: bold;
        font-size: 14px;
        margin: 10px 0;
        animation: pulse 2s infinite;
      `;
      productElement.prepend(stockEl);
    }

    // Countdown Timer für Angebote
    this.addCountdownTimer(productElement, product);
  }

  addCountdownTimer(container, product) {
    const endTime = Date.now() + (2 * 60 * 60 * 1000); // 2 Stunden
    const timerEl = document.createElement('div');
    timerEl.className = 'countdown-timer';
    timerEl.innerHTML = `
      <div style="background: #1e3a8a; color: white; padding: 10px; border-radius: 8px; text-align: center;">
        <div style="font-size: 12px; opacity: 0.9;">Sonderangebot endet in</div>
        <div style="font-size: 24px; font-weight: bold; font-family: monospace;" id="timer-${product.id}">02:00:00</div>
      </div>
    `;
    
    container.appendChild(timerEl);
    
    // Timer aktualisieren
    const updateTimer = () => {
      const remaining = endTime - Date.now();
      if (remaining <= 0) {
        timerEl.innerHTML = '<div style="background: #64748b; color: white; padding: 10px; border-radius: 8px; text-align: center;">Angebot abgelaufen</div>';
        return;
      }
      
      const hours = Math.floor(remaining / (1000 * 60 * 60));
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
      
      document.getElementById(`timer-${product.id}`).textContent = 
        `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      
      requestAnimationFrame(updateTimer);
    };
    
    updateTimer();
  }

  // Cross-Sell & Up-Sell
  getCrossSellProducts(mainProduct) {
    const crossSellMap = {
      'lotus_vita': ['filter_cartridges', 'water_test_kit'],
      'aquazero_promax': ['installation_service', 'maintenance_plan', 'smart_monitor'],
      'brita_filter': ['replacement_cartridges', 'water_bottle']
    };
    
    const crossSellIds = crossSellMap[mainProduct.id] || [];
    return this.getProductCatalog().filter(p => crossSellIds.includes(p.id));
  }

  // Exit-Intent Detection
  setupExitIntent() {
    let mouseOut = false;
    
    document.addEventListener('mouseout', (e) => {
      if (!e.toElement && !e.relatedTarget && !mouseOut) {
        mouseOut = true;
        this.showExitOffer();
      }
    });
  }

  showExitOffer() {
    // Nur zeigen, wenn Produkte angeschaut aber nicht gekauft
    if (this.viewedProducts.size > 0 && !this.conversionFunnel.some(f => f.step === 'purchase')) {
      const offer = document.createElement('div');
      offer.id = 'exit-offer';
      offer.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 30px;
        border-radius: 20px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        z-index: 9999;
        max-width: 400px;
        text-align: center;
      `;
      
      offer.innerHTML = `
        <h3 style="color: #dc2626; margin-bottom: 15px;">🚨 Letzte Chance! 🚨</h3>
        <p>Sie haben sich für Wasserfilter interessiert. Hier ist ein exklusives Angebot nur für Sie:</p>
        <div style="background: #fef3c7; padding: 15px; border-radius: 10px; margin: 20px 0;">
          <div style="font-size: 24px; font-weight: bold; color: #dc2626;">10% RABATT</div>
          <div>auf Ihre erste Bestellung</div>
        </div>
        <button onclick="window.location.href='#affiliate'" style="background: linear-gradient(45deg, #dc2626, #ef4444); color: white; border: none; padding: 15px 30px; border-radius: 10px; font-weight: bold; cursor: pointer; width: 100%;">
          Jetzt Rabatt sichern
        </button>
        <button onclick="document.getElementById('exit-offer').remove()" style="background: none; border: none; color: #64748b; margin-top: 15px; cursor: pointer;">
          Nein danke, ich riskiere meine Gesundheit
        </button>
      `;
      
      document.body.appendChild(offer);
      
      this.trackEvent('exit_intent_shown', {
        viewed_products: Array.from(this.viewedProducts)
      });
    }
  }

  // Analytics & Reporting
  trackEvent(eventName, eventData) {
    const event = {
      event: eventName,
      visitor_id: this.visitorId,
      timestamp: new Date().toISOString(),
      session_duration: Date.now() - this.sessionStart,
      page_url: window.location.href,
      ...eventData
    };

    // An Backend senden
    this.sendAnalytics(event);

    // Google Analytics
    if (typeof gtag !== 'undefined') {
      gtag('event', eventName, eventData);
    }

    // Console für Debugging
    if (process.env.NODE_ENV === 'development') {
      console.log('Analytics Event:', event);
    }
  }

  async sendAnalytics(event) {
    try {
      await fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event)
      });
    } catch (error) {
      console.error('Failed to send analytics:', error);
      // In localStorage puffern für späteren Versand
      this.bufferAnalytics(event);
    }
  }

  bufferAnalytics(event) {
    const buffer = JSON.parse(localStorage.getItem('analytics_buffer') || '[]');
    buffer.push(event);
    localStorage.setItem('analytics_buffer', JSON.stringify(buffer.slice(-50))); // Max 50 Events
  }

  // Hilfsfunktionen
  getClickPosition() {
    // Simulierte Position basierend auf Viewport
    return Math.random() > 0.5 ? 'above_fold' : 'below_fold';
  }

  getHistoricalConversionRate(productId) {
    // Aus localStorage oder Backend
    const rates = JSON.parse(localStorage.getItem('conversion_rates') || '{}');
    return rates[productId] || 0.05; // Default 5%
  }

  getStockLevel(productId) {
    // Simulierte Lagerbestände
    const stocks = {
      'lotus_vita': Math.floor(Math.random() * 20),
      'aquazero_promax': Math.floor(Math.random() * 15),
      'brita_filter': 100
    };
    return stocks[productId] || 10;
  }

  getProductCatalog() {
    return [
      {
        id: 'lotus_vita',
        name: 'Lotus Vita Fontana',
        price: 329,
        commissionRate: 12,
        category: 'countertop',
        recommendedRiskLevels: ['low', 'medium'],
        tenantFriendly: true,
        childSafe: true,
        effectiveness: 95
      },
      {
        id: 'aquazero_promax',
        name: 'AquaZero ProMax',
        price: 479,
        commissionRate: 14,
        category: 'reverse_osmosis',
        recommendedRiskLevels: ['high', 'critical'],
        tenantFriendly: false,
        childSafe: true,
        effectiveness: 99
      },
      {
        id: 'brita_filter',
        name: 'Brita Maxtra',
        price: 29,
        commissionRate: 6,
        category: 'pitcher',
        recommendedRiskLevels: ['low'],
        tenantFriendly: true,
        childSafe: true,
        effectiveness: 60
      }
    ];
  }

  applyPersonalizationRules(products, userContext) {
    return products.filter(product => {
      // Mieter-Filter
      if (userContext.isTenant && !product.tenantFriendly) return false;
      
      // Budget-Filter
      if (userContext.budget === 'low' && product.price > 300) return false;
      if (userContext.budget === 'high' && product.price < 400) return false;
      
      // Familien-Filter
      if (userContext.hasChildren && !product.childSafe) return false;
      
      return true;
    });
  }

  loadPersonalizationRules() {
    // Regeln aus Backend oder localStorage laden
    try {
      const rules = JSON.parse(localStorage.getItem('personalization_rules'));
      if (rules) this.personalizationRules = rules;
    } catch (e) {
      this.personalizationRules = {};
    }
  }

  // Session beenden
  endSession() {
    const duration = Date.now() - this.sessionStart;
    this.trackEvent('session_end', {
      duration,
      viewed_products_count: this.viewedProducts.size,
      conversion_funnel: this.conversionFunnel
    });
    
    // Buffer leeren
    this.sendBufferedAnalytics();
  }

  async sendBufferedAnalytics() {
    const buffer = JSON.parse(localStorage.getItem('analytics_buffer') || '[]');
    if (buffer.length === 0) return;

    try {
      await fetch('/api/analytics/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: buffer })
      });
      localStorage.removeItem('analytics_buffer');
    } catch (error) {
      console.error('Failed to send buffered analytics:', error);
    }
  }
}

// Export als ES6 Modul
export default AffiliateOptimizer;
