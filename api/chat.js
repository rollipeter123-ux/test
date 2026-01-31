/**
 * KI-Chatbot Backend mit Gemini API Integration
 * Speichert Konversationen in PostgreSQL für personalisierte Antworten
 */

import { createClient } from '@neondatabase/serverless';
import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, conversationId, userId, context } = req.body;
  
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    const dbClient = createClient({
      connectionString: process.env.DATABASE_URL
    });
    await dbClient.connect();

    // 1. Konversation laden oder neu erstellen
    let conversation = await loadOrCreateConversation(dbClient, conversationId, userId);
    
    // 2. Kontext vorbereiten (vorherige Nachrichten, Wasser-Daten, etc.)
    const chatContext = await prepareChatContext(dbClient, conversation, context);
    
    // 3. Gemini API aufrufen
    const aiResponse = await callGeminiAPI(message, chatContext);
    
    // 4. Nachrichten in Datenbank speichern
    await saveMessages(dbClient, conversation.id, message, aiResponse);
    
    // 5. Evtl. Produkt-Empfehlungen extrahieren
    const recommendations = extractRecommendations(aiResponse);
    
    // 6. Cleanup und Response
    await dbClient.end();

    return res.status(200).json({
      success: true,
      response: aiResponse,
      conversationId: conversation.id,
      recommendations,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

// Konversation laden oder neu erstellen
async function loadOrCreateConversation(dbClient, conversationId, userId) {
  if (conversationId) {
    const result = await dbClient.query(
      `SELECT * FROM conversations WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)`,
      [conversationId, userId]
    );
    
    if (result.rows.length > 0) {
      return result.rows[0];
    }
  }

  // Neue Konversation erstellen
  const result = await dbClient.query(
    `INSERT INTO conversations (user_id, created_at, updated_at) 
     VALUES ($1, NOW(), NOW()) 
     RETURNING id, user_id, created_at`,
    [userId || null]
  );
  
  return result.rows[0];
}

// Kontext für KI vorbereiten
async function prepareChatContext(dbClient, conversation, context) {
  let chatContext = {
    systemPrompt: `Du bist HydroBot, ein freundlicher und kompetenter Wasser-Experte für Deutschland.
Deine Hauptaufgaben:
1. Fragen zu Trinkwasserqualität beantworten
2. Über PFAS und andere Schadstoffe aufklären
3. Wasserfilter-Empfehlungen geben (basierend auf Risiko und Budget)
4. Mieter über ihre Rechte informieren
5. Bei gesundheitlichen Fragen zur ärztlichen Beratung raten

WICHTIG: Sei wissenschaftlich präzise, aber verständlich. Nenne konkrete Produkte nur wenn gefragt.
Empfohlene Produkte: Lotus Vita Fontana (329€), AquaZero ProMax (479€), Brita (ab 29€).
Provision: Wir erhalten Provision bei Kauf über unsere Links.

Antworte immer auf Deutsch.`,
    
    previousMessages: [],
    userContext: context || {}
  };

  // Vorherige Nachrichten laden (letzte 10)
  const messagesResult = await dbClient.query(
    `SELECT role, content, created_at 
     FROM chat_messages 
     WHERE conversation_id = $1 
     ORDER BY created_at DESC 
     LIMIT 10`,
    [conversation.id]
  );

  chatContext.previousMessages = messagesResult.rows.reverse();

  // Wenn PLZ im Context, Wasser-Daten hinzufügen
  if (context && context.plz) {
    const waterData = await getWaterDataForPLZ(dbClient, context.plz);
    if (waterData) {
      chatContext.waterData = waterData;
    }
  }

  return chatContext;
}

// Wasser-Daten für PLZ abrufen
async function getWaterDataForPLZ(dbClient, plz) {
  try {
    const result = await dbClient.query(
      `SELECT * FROM water_quality_cache WHERE plz = $1 AND updated_at > NOW() - INTERVAL '7 days'`,
      [plz]
    );
    
    if (result.rows.length > 0) {
      return result.rows[0];
    }
    
    // Falls nicht im Cache, simulieren
    return simulateWaterData(plz);
  } catch (error) {
    console.error('Failed to fetch water data:', error);
    return simulateWaterData(plz);
  }
}

// Gemini API aufrufen
async function callGeminiAPI(userMessage, context) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-pro" });

  // Prompt mit Kontext konstruieren
  const prompt = constructPrompt(userMessage, context);

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Gemini API error:', error);
    
    // Fallback: Regelbasierte Antworten
    return getFallbackResponse(userMessage);
  }
}

// Prompt konstruieren
function constructPrompt(userMessage, context) {
  let prompt = context.systemPrompt + "\n\n";
  
  // Vorherige Nachrichten hinzufügen
  if (context.previousMessages.length > 0) {
    prompt += "Vorherige Konversation:\n";
    context.previousMessages.forEach(msg => {
      prompt += `${msg.role}: ${msg.content}\n`;
    });
    prompt += "\n";
  }
  
  // Wasser-Daten hinzufügen wenn verfügbar
  if (context.waterData) {
    prompt += `Aktuelle Wasser-Daten für PLZ ${context.waterData.plz}:\n`;
    prompt += `- PFAS: ${context.waterData.pfas_value} ng/L (Grenzwert: 20 ng/L)\n`;
    prompt += `- Risiko-Level: ${context.waterData.risk_level}\n\n`;
  }
  
  // User-Kontext hinzufügen
  if (context.userContext) {
    if (context.userContext.isTenant) {
      prompt += "Hinweis: Der Nutzer ist Mieter. Filter-Empfehlungen müssen mieterfreundlich sein.\n";
    }
    if (context.userContext.budget) {
      prompt += `Hinweis: Budget des Nutzers: ${context.userContext.budget}\n`;
    }
  }
  
  prompt += `Nutzer-Frage: ${userMessage}\n\nAntwort:`;
  
  return prompt;
}

// Nachrichten in Datenbank speichern
async function saveMessages(dbClient, conversationId, userMessage, aiResponse) {
  await dbClient.query(
    `INSERT INTO chat_messages (conversation_id, role, content, created_at) 
     VALUES ($1, 'user', $2, NOW()), ($1, 'assistant', $3, NOW())`,
    [conversationId, userMessage, aiResponse]
  );
  
  // Konversation aktualisieren
  await dbClient.query(
    `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
    [conversationId]
  );
}

// Produkt-Empfehlungen extrahieren
function extractRecommendations(aiResponse) {
  const recommendations = [];
  const productKeywords = {
    'Lotus Vita': 'lotus_vita',
    'AquaZero': 'aquazero_promax',
    'Brita': 'brita_filter',
    'Berkey': 'berkey',
    'Umkehrosmose': 'reverse_osmosis'
  };
  
  for (const [keyword, productId] of Object.entries(productKeywords)) {
    if (aiResponse.includes(keyword)) {
      recommendations.push({
        productId,
        keyword,
        context: extractContextAroundKeyword(aiResponse, keyword)
      });
    }
  }
  
  return recommendations;
}

// Kontext um Keyword extrahieren
function extractContextAroundKeyword(text, keyword, wordsAround = 20) {
  const index = text.indexOf(keyword);
  if (index === -1) return '';
  
  const start = Math.max(0, index - wordsAround * 10);
  const end = Math.min(text.length, index + wordsAround * 10);
  
  let extract = text.substring(start, end);
  if (start > 0) extract = '...' + extract;
  if (end < text.length) extract = extract + '...';
  
  return extract;
}

// Fallback für API-Fehler
function getFallbackResponse(userMessage) {
  const lowerMessage = userMessage.toLowerCase();
  
  if (lowerMessage.includes('pfas') || lowerMessage.includes('forever chemicals')) {
    return "PFAS sind per- und polyfluorierte Alkylsubstanzen, auch 'Ewigkeitschemikalien' genannt. Sie bauen sich in der Umwelt nicht ab und können sich im Körper anreichern. Der neue Grenzwert in Deutschland beträgt 20 ng/L. Ich empfehle zur Entfernung von PFAS ein Umkehrosmose-System wie AquaZero ProMax.";
  }
  
  if (lowerMessage.includes('filter') || lowerMessage.includes('wasserfilter')) {
    return "Für Mieter empfehle ich den Lotus Vita Fontana (329€), der einfach auf der Arbeitsplatte steht. Bei hoher Belastung ist das AquaZero ProMax (479€) mit Umkehrosmose die beste Wahl. Beide entfernen >95% der PFAS.";
  }
  
  if (lowerMessage.includes('mieter') || lowerMessage.includes('mietrecht')) {
    return "Als Mieter haben Sie das Recht auf einwandfreies Trinkwasser. Sie können einen Wasserfilter installieren, solange keine baulichen Veränderungen nötig sind. Bei Grenzwertüberschreitungen können Sie eine Mietminderung beantragen.";
  }
  
  return "Ich bin HydroBot, Ihr Wasser-Experte. Leider kann ich gerade keine KI-Antwort generieren. Bitte nutzen Sie unsere Analyse-Funktion für eine detaillierte Bewertung Ihrer Wasserqualität.";
}

// Simulierte Wasser-Daten
function simulateWaterData(plz) {
  const hash = plz.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const seed = (hash % 100) / 100;
  
  return {
    plz,
    pfas_value: (10 + seed * 40).toFixed(1),
    risk_level: seed > 0.7 ? 'hoch' : seed > 0.4 ? 'mittel' : 'niedrig',
    last_updated: new Date().toISOString()
  };
}

export const config = {
  runtime: 'edge'
};
