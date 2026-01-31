// Serverless Function für Vercel/Netlify
import { createClient } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { plz } = req.body;
  
  if (!plz || plz.length !== 5) {
    return res.status(400).json({ error: 'Invalid PLZ' });
  }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    const client = createClient({
      connectionString: process.env.DATABASE_URL
    });
    await client.connect();

    // 1. PLZ zu Koordinaten konvertieren
    const geoQuery = await client.query(
      `SELECT lat, lon, city FROM plz_coordinates WHERE plz = $1 LIMIT 1`,
      [plz]
    );

    if (geoQuery.rows.length === 0) {
      await client.end();
      return res.status(404).json({ error: 'PLZ not found' });
    }

    const { lat, lon, city } = geoQuery.rows[0];

    // 2. Wasserqualitätsdaten abfragen (simuliert)
    // In Produktion: Echte UBA-Datenbank-Abfrage
    const waterData = await simulateWaterData(lat, lon, plz);

    // 3. Risikobewertung
    const riskAssessment = calculateRisk(waterData);

    // 4. Filter-Empfehlungen basierend auf Risiko
    const recommendations = getFilterRecommendations(riskAssessment.level, plz);

    // 5. In Datenbank loggen (für Analytics)
    await client.query(
      `INSERT INTO analysis_logs (plz, risk_level, created_at) 
       VALUES ($1, $2, NOW())`,
      [plz, riskAssessment.level]
    );

    await client.end();

    return res.status(200).json({
      success: true,
      plz,
      city,
      coordinates: { lat, lon },
      waterData,
      riskAssessment,
      recommendations,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

// Hilfsfunktionen
function simulateWaterData(lat, lon, plz) {
  // Deterministische Simulation basierend auf PLZ
  const hash = plz.split('').reduce((acc, char) => acc * 31 + char.charCodeAt(0), 0);
  const seed = Math.abs(hash % 1000) / 1000;

  return {
    pfas: {
      value: (15 + seed * 25).toFixed(1),
      unit: 'ng/L',
      limit: 20
    },
    nitrate: {
      value: (25 + seed * 20).toFixed(1),
      unit: 'mg/L',
      limit: 50
    },
    arsenic: {
      value: (2 + seed * 6).toFixed(2),
      unit: 'µg/L',
      limit: 10
    },
    lead: {
      value: (3 + seed * 4).toFixed(1),
      unit: 'µg/L',
      limit: 10
    },
    hardness: {
      value: (8 + seed * 12).toFixed(0),
      unit: '°dH'
    },
    ph: {
      value: (7.0 + seed * 0.8).toFixed(1),
      range: '6.5-9.5'
    },
    lastUpdated: new Date().toISOString(),
    dataSource: 'UBA Simulation 2024'
  };
}

function calculateRisk(waterData) {
  let score = 0;
  
  // PFAS Gewichtung: 40%
  if (waterData.pfas.value > 50) score += 40;
  else if (waterData.pfas.value > 20) score += 25;
  else if (waterData.pfas.value > 10) score += 10;
  
  // Nitrat Gewichtung: 25%
  if (waterData.nitrate.value > 40) score += 25;
  else if (waterData.nitrate.value > 30) score += 15;
  
  // Arsen & Blei: 35%
  if (waterData.arsenic.value > 8) score += 20;
  if (waterData.lead.value > 8) score += 15;

  let level = 'low';
  let color = 'green';
  
  if (score >= 50) {
    level = 'critical';
    color = 'red';
  } else if (score >= 30) {
    level = 'medium';
    color = 'orange';
  } else if (score >= 15) {
    level = 'elevated';
    color = 'yellow';
  }

  return {
    score,
    level,
    color,
    description: getRiskDescription(level)
  };
}

function getRiskDescription(level) {
  const descriptions = {
    low: 'Wasserqualität gut. Kein dringender Handlungsbedarf.',
    elevated: 'Leichte Auffälligkeiten. Regelmäßige Kontrolle empfohlen.',
    medium: 'Mäßige Belastung. Filterung wird empfohlen.',
    critical: 'Kritische Werte. Sofortige Filterung dringend empfohlen.'
  };
  return descriptions[level] || 'Unbekanntes Risikoniveau.';
}

function getFilterRecommendations(riskLevel, plz) {
  const baseFilters = [
    {
      id: 'lotus_vita',
      name: 'Lotus Vita Fontana',
      type: 'countertop',
      effectiveness: { pfas: 95, nitrate: 85, arsenic: 90, lead: 95 },
      price: 329,
      commission: 12,
      link: 'https://www.lotus-vita.de/?ref=74674',
      bestFor: ['tenants', 'taste', 'easy_installation']
    },
    {
      id: 'aquazero_promax',
      name: 'AquaZero ProMax',
      type: 'reverse_osmosis',
      effectiveness: { pfas: 99, nitrate: 99, arsenic: 99, lead: 99 },
      price: 479,
      commission: 14,
      link: 'https://www.aquasana.com/ref/wasserwissen2026',
      bestFor: ['critical_areas', 'families', 'comprehensive_protection']
    }
  ];

  // Filter basierend auf Risiko priorisieren
  if (riskLevel === 'critical') {
    return baseFilters.sort((a, b) => b.effectiveness.pfas - a.effectiveness.pfas);
  } else if (riskLevel === 'medium') {
    return [baseFilters[0], baseFilters[1]]; // Beide anzeigen
  } else {
    return [baseFilters[0]]; // Nur Lotus Vita für niedriges Risiko
  }
}

export const config = {
  runtime: 'edge'  // Für Vercel Edge Functions optimiert
};
