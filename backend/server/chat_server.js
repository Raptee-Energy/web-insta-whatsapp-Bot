// ================================================================
// 🤖 RAPTEE UNIFIED SERVER (Socket.io + Chatwoot + RAG + Handshake)
// ================================================================

import express from "express";
import axios from "axios";
import cors from "cors";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { CloudClient } from "chromadb";
import { Mistral } from "@mistralai/mistralai";
import { createServer } from "http";
import { Server } from "socket.io";

config();

// ES Module dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.use(express.json());
app.use(cors());

// 📁 STATIC FILE SERVING (React Build)
app.use(express.static(path.join(__dirname, "public")));

// 🔐 CONFIGURATION
const CHATWOOT_BASE_URL = process.env.CHATWOOT_BASE_URL;
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID;
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN;
const INBOX_IDENTIFIER = process.env.INBOX_IDENTIFIER;

const CHROMA_API_KEY = process.env.CHROMA_API_KEY;
const CHROMA_TENANT = process.env.CHROMA_TENANT;
const CHROMA_DATABASE = process.env.CHROMA_DATABASE;
const CHROMA_COLLECTION = process.env.CHROMA_COLLECTION;

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

// 🛡️ Global Error Handlers (prevent crashes on unhandled rejections)
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't crash the server
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't crash the server for recoverable errors
});

// 📊 Session Store
const sessions = new Map();
const recentOutgoingMessages = new Map();

// Cleanup
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of recentOutgoingMessages.entries()) {
    if (now - ts > 5 * 60 * 1000) recentOutgoingMessages.delete(id);
  }
}, 5 * 60 * 1000);

// 🔌 SOCKET HANDLER
io.on("connection", (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
  socket.on("join_conversation", (conversationId, callback) => {
    if (conversationId) {
      const room = conversationId.toString();
      socket.join(room);
      console.log(`👤 Socket ${socket.id} joined room: ${room}`);
      if (callback) callback({ status: "joined" });
    }
  });
  socket.on("disconnect", () => { });
});

// 🔧 UTILS
function getChatwootHeaders() {
  //console.log(`🔑 Using token: ${CHATWOOT_API_TOKEN?.substring(0, 8)}...`);
  return {
    "Content-Type": "application/json",
    "api_access_token": CHATWOOT_API_TOKEN,
  };
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ☁️ CHROMA
let chromaClient;
let collection;
(async () => {
  try {
    chromaClient = new CloudClient({
      tenant: CHROMA_TENANT,
      database: CHROMA_DATABASE,
      apiKey: CHROMA_API_KEY,
    });
    collection = await chromaClient.getCollection({ name: CHROMA_COLLECTION });
    console.log(`✅ Connected to Chroma collection`);
  } catch (err) {
    console.error("Chroma Error", err.message);
  }
})();

// 🤖 MISTRAL
const mistral = new Mistral({ apiKey: MISTRAL_API_KEY });

// 🧠 RAG LOGIC

// Encode with Mistral embeddings (used for both ingestion & retrieval)
async function encodeSentences(texts) {
  const embeddings = [];
  for (const text of texts) {
    try {
      const response = await mistral.embeddings.create({
        model: "mistral-embed",
        inputs: [text],
      });
      embeddings.push(response.data[0].embedding);
      await sleep(100);
    } catch (e) {
      console.error("Embedding error, falling back to zeros:", e.message || e);
      embeddings.push(Array(1024).fill(0));
    }
  }
  return embeddings;
}

// Retrieve top-k relevant chunks from Chroma using queryEmbeddings
async function retrieveRelevantChunks(query, topK = 5) {
  try {
    if (!collection) return [];

    const embeddingList = await encodeSentences([query]); // [[dim]]
    const queryEmbedding = embeddingList[0];

    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
      include: ["documents", "metadatas"], // ids returned automatically
    });

    const docs = results.documents?.[0] || [];
    const metas = results.metadatas?.[0] || [];
    const ids = results.ids?.[0] || [];

    return docs.map((doc, i) => ({
      id: ids[i],
      content: doc,
      title: metas[i]?.title || "",
      tags: metas[i]?.tags || "",
      source_faq_ids: metas[i]?.source_faq_ids || "",
      sample_questions: metas[i]?.sample_questions || "",
    }));
  } catch (e) {
    console.error("retrieveRelevantChunks error:", e.message || e);
    return [];
  }
}

// 🧵 Conversation History from Chatwoot (last N messages)
async function fetchRecentMessages(conversationId, limit = 4) {
  try {
    const resp = await axios.get(
      `${CHATWOOT_BASE_URL}/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
      { headers: getChatwootHeaders() }
    );

    const all = resp.data.payload || resp.data || [];
    // Sort oldest → newest by created_at
    const sorted = [...all].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    const last = sorted.slice(-limit);

    // Normalize to simple role/content pairs
    return last.map((msg) => {
      const isUser =
        msg.message_type === "incoming" ||
        msg.message_type === 0 ||
        msg.sender_type === "Contact";

      return {
        role: isUser ? "user" : "agent",
        content: msg.content || "",
      };
    });
  } catch (e) {
    console.error(
      "fetchRecentMessages error:",
      e.response?.data || e.message || e
    );
    return [];
  }
}

// ✅ JSON Output for Assistance Check + Conversation-Aware
async function generateMistralResponse(
  context,
  userMessage,
  conversationHistoryText = ""
) {
  const prompt = `You are Raptee.HV's intelligent assistant for the Raptee T30 electric motorcycle.

CONTEXT FORMAT:
- You are given multiple knowledge chunks about Raptee T30.
- Use ONLY these chunks as your factual source of truth.

RECENT CONVERSATION:
The following is the last few messages in this conversation (oldest first, latest at the bottom):
${conversationHistoryText || "No prior conversation available."}

INSTRUCTIONS:
1. Answer ONLY about Raptee.HV and the Raptee.HV T30 motorcycle (product, app, charging, warranty, etc).
2. Answer only for what the user asks, don't give extra or little information, it should be balanced.
3. If user asks about other brands or comparisons (Ather, Ola, Revolt, Ultraviolette, etc.), reply with:
   "As a Raptee assistant ask me anything about only Raptee and its features."
4. For general greetings like "Hi", "Hello", etc., reply with a friendly greeting and ask how you can help,
   without forcing technical details.
5. If the provided CONTEXT does NOT contain enough information to confidently answer,
   say: "I don't have that specific information, I will connect you with an agent."
   and set "assistance_needed" to true.
   Do NOT mention words like "database", "context", "knowledge base" and don't use rmojis or --- in the final answer.
6. Use the recent conversation only to keep the dialogue coherent (follow-ups, pronouns like "it", etc),
   but do NOT invent new specs or policies that are not present in the CONTEXT.
7. Respond ONLY in valid JSON format.

Context:
${context}

User Question:
${userMessage}

Required Output JSON Format:
{
  "answer": "Your friendly answer here...",
  "assistance_needed": boolean
}`;

  try {
    // Add timeout to prevent hanging on slow LLM responses
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('LLM request timeout')), 30000)
    );

    const response = await Promise.race([
      mistral.chat.complete({
        model: "mistral-medium-latest",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
      timeoutPromise
    ]);

    let rawContent = response.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error("Empty LLM response");

    if (typeof rawContent !== "string") {
      try {
        return rawContent;
      } catch (e) {
        rawContent = String(rawContent);
      }
    }

    // 1) Remove fenced code block markers if present
    const fencedMatch = rawContent.match(
      /```(?:json)?\s*([\s\S]*?)\s*```/i
    );
    let jsonText = fencedMatch ? fencedMatch[1].trim() : null;

    // 2) If no fenced block, take first {...}
    if (!jsonText) {
      const objMatch = rawContent.match(/(\{[\s\S]*\})/);
      if (objMatch) jsonText = objMatch[1];
      else jsonText = rawContent.trim();
    }

    // 3) Fix newlines inside JSON string values (replace literal newlines with \n)
    // This handles when LLM puts actual line breaks inside the answer string
    jsonText = jsonText.replace(/:\s*"([^"]*?)"/gs, (match, content) => {
      const fixed = content.replace(/\r?\n/g, '\\n');
      return `: "${fixed}"`;
    });

    // 4) Attempt parse
    try {
      const parsed = JSON.parse(jsonText);
      return parsed;
    } catch (parseErr) {
      const firstBrace = jsonText.indexOf("{");
      const lastBrace = jsonText.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const candidate = jsonText.slice(firstBrace, lastBrace + 1);
        // Also fix newlines in the candidate
        const fixedCandidate = candidate.replace(/:\s*"([^"]*?)"/gs, (match, content) => {
          const fixed = content.replace(/\r?\n/g, '\\n');
          return `: "${fixed}"`;
        });
        try {
          return JSON.parse(fixedCandidate);
        } catch (e) {
          // fallthrough
        }
      }
      console.error(
        "JSON Parse Failed on LLM output:",
        parseErr,
        "rawContent:",
        rawContent
      );
      return {
        answer:
          "I apologize, I'm having trouble processing that right now.",
        assistance_needed: true,
      };
    }
  } catch (e) {
    console.error("LLM Error", e);
    return {
      answer: "I apologize, I'm having trouble processing that right now.",
      assistance_needed: true,
    };
  }
}

async function sendChatwootMessage(conversationId, text) {
  try {
    const resp = await axios.post(
      `${CHATWOOT_BASE_URL}/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
      { content: text, message_type: "outgoing", private: false },
      { headers: getChatwootHeaders() }
    );

    const id =
      resp?.data?.id || (resp.data.payload && resp.data.payload.id);
    if (id) recentOutgoingMessages.set(String(id), Date.now());
    return resp.data;
  } catch (e) {
    console.error("sendChatwootMessage error:", e.message || e);
    return { id: Date.now() };
  }
}

// 🧠 Main RAG Orchestrator (now context-aware)
async function processRAGLogic(conversationId, userMessage) {
  const room = conversationId.toString();

  try {
    io.to(room).emit("bot_typing", true);

    // 1) Retrieve last few messages for conversational context
    const history = await fetchRecentMessages(conversationId, 4);
    const historyText = history
      .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`)
      .join("\n");

    // 2) Retrieve top chunks from Chroma for factual context
    const chunks = await retrieveRelevantChunks(userMessage, 5);

    if (!chunks || chunks.length === 0) {
      const botResponse =
        "I apologize, but I don't have information about that specific query. I’ll connect you with an agent.";
      await sendChatwootMessage(conversationId, botResponse);
      io.to(room).emit("new_message", {
        id: Date.now(),
        type: "bot",
        content: botResponse,
        timestamp: new Date().toISOString(),
        assistanceNeeded: true,
      });
      io.to(room).emit("bot_typing", false);
      return;
    }

    // 3) Build a rich context string from retrieved chunks
    const context = chunks
      .map((c, idx) => {
        const header = c.title
          ? `[#${idx + 1}] ${c.title}`
          : `[#${idx + 1}] Raptee T30 Info`;
        return `${header}\n${c.content}`;
      })
      .join("\n\n---\n\n");

    // 4) Get answer from Mistral (with both KB context + convo history)
    const result = await generateMistralResponse(
      context,
      userMessage,
      historyText
    );

    // 5) Send to Chatwoot + socket
    await sendChatwootMessage(conversationId, result.answer);

    io.to(room).emit("new_message", {
      id: Date.now(),
      type: "bot",
      content: result.answer,
      timestamp: new Date().toISOString(),
      assistanceNeeded: !!result.assistance_needed,
    });
  } catch (e) {
    console.error("RAG Error", e);
    io.to(room).emit("new_message", {
      id: Date.now(),
      type: "bot",
      content:
        "I’m having trouble fetching information right now. I’ll connect you with an agent.",
      timestamp: new Date().toISOString(),
      assistanceNeeded: true,
    });
  } finally {
    io.to(room).emit("bot_typing", false);
  }
}

// 🚀 API ROUTES

app.get("/health", (req, res) => res.json({ status: "healthy" }));

app.post("/api/chat/init", async (req, res) => {
  const url = `${CHATWOOT_BASE_URL}/accounts/${CHATWOOT_ACCOUNT_ID}/contacts`;
  //console.log(`📤 Sending to: ${url}`);
  try {
    const { visitorId, name, email } = req.body;

    // Session expiry: 24 hours in milliseconds
    const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

    // Check if existing session is valid and not expired
    if (visitorId && sessions.has(visitorId)) {
      const existingSession = sessions.get(visitorId);
      const sessionAge = Date.now() - existingSession.createdAt;

      if (sessionAge < SESSION_EXPIRY_MS) {
        // Session is still valid, return it
        return res.json({
          success: true,
          sessionId: visitorId,
          ...existingSession,
        });
      } else {
        // Session expired, remove it and create new one
        console.log(`🔄 Session expired for ${visitorId}, creating new ticket...`);
        sessions.delete(visitorId);
      }
    }

    const userId =
      visitorId ||
      `visitor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const URL = `${CHATWOOT_BASE_URL}/accounts/${CHATWOOT_ACCOUNT_ID}/contacts`;
    //(`📤 Sending to: ${URL}`);
    const contactRes = await axios.post(
      URL,
      {
        inbox_id: INBOX_IDENTIFIER,
        name: name || "Website Visitor",
        email: email || `${userId}@raptee.guest`,
        identifier: userId,
      },
      { headers: getChatwootHeaders() }
    );
    const contactId = contactRes.data.payload.contact.id;

    const convURL = `${CHATWOOT_BASE_URL}/accounts/${CHATWOOT_ACCOUNT_ID}/conversations`;
    //console.log(`📤 Sending to: ${convURL}`);
    const convRes = await axios.post(
      convURL,
      {
        source_id: userId,
        inbox_id: INBOX_IDENTIFIER,
        contact_id: contactId,
      },
      { headers: getChatwootHeaders() }
    );
    const conversationId = convRes.data.id;

    sessions.set(userId, {
      contactId,
      conversationId,
      createdAt: Date.now(),
    });
    console.log(
      `✅ New Session: ${conversationId} (Contact: ${contactId})`
    );
    res.json({
      success: true,
      sessionId: userId,
      contactId,
      conversationId,
    });
  } catch (error) {
    console.error("Init error:", error.response?.data || error.message);
    res.status(500).json({ error: "Init Failed" });
  }
});

app.post("/api/chat/message", async (req, res) => {
  try {
    const { sessionId, message, conversationId } = req.body;

    const url = `${CHATWOOT_BASE_URL}/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`;


    await axios.post(
      url,
      { content: message, message_type: "incoming", private: false },
      { headers: getChatwootHeaders() }
    );

    // Fire and forget RAG processing
    processRAGLogic(conversationId, message);
    res.json({ success: true });
  } catch (error) {
    console.error("Send message error:", error.response?.status, error.response?.data || error.message);
    res.status(500).json({ error: "Send Failed" });
  }
});

// ✅ Update Contact Info (Ticket Raising)
app.post("/api/contact/update", async (req, res) => {
  try {
    const { sessionId, name, email, phone } = req.body;
    const session = sessions.get(sessionId);

    if (!session || !session.contactId) {
      return res.status(404).json({ error: "Session not found" });
    }

    await axios.put(
      `${CHATWOOT_BASE_URL}/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/${session.contactId}`,
      { name, email, phone_number: phone },
      { headers: getChatwootHeaders() }
    );

    await axios.post(
      `${CHATWOOT_BASE_URL}/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${session.conversationId}/messages`,
      {
        content: `🚨 TICKET RAISED\nName: ${name}\nPhone: ${phone}\nEmail: ${email}`,
        message_type: "outgoing",
        private: true,
      },
      { headers: getChatwootHeaders() }
    );

    console.log(`📝 Contact updated for ID ${session.contactId}`);
    res.json({ success: true });
  } catch (error) {
    console.error(
      "Update Contact Failed:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Update Failed" });
  }
});

app.get("/api/chat/messages/:conversationId", async (req, res) => {
  try {
    const response = await axios.get(
      `${CHATWOOT_BASE_URL}/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${req.params.conversationId}/messages`,
      { headers: getChatwootHeaders() }
    );

    // Filter out system/activity messages
    const systemPatterns = [
      /^Automation System/i,
      /^Assigned to .* by/i,
      /^Unassigned from .* by/i,
      /changed the priority/i,
      /removed the priority/i,
      /added .* label/i,
      /removed .* label/i,
      /added booking/i,
      /removed booking/i,
      /removed service/i,
      /added service/i,
    ];

    const isSystemMessage = (content) => {
      if (!content) return true; // Filter empty messages too
      return systemPatterns.some(pattern => pattern.test(content));
    };

    const messages = (response.data.payload || response.data)
      .filter((msg) => !isSystemMessage(msg.content) && msg.message_type !== 2) // message_type 2 is activity
      .map((msg) => ({
        id: msg.id,
        content: msg.content,
        type:
          msg.message_type === "outgoing" || msg.message_type === 1
            ? "bot"
            : "user",
        timestamp: msg.created_at,
      }));
    res.json({ success: true, messages });
  } catch (error) {
    console.error(
      "Fetch messages error:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Fetch Failed" });
  }
});

app.post("/api/webhook/chatwoot", async (req, res) => {
  const payload = req.body;

  if (payload?.event === "message_created" && payload.message_type === "outgoing") {
    const msgId = String(payload.id);
    if (recentOutgoingMessages.has(msgId))
      return res.json({ status: "duplicate" });

    recentOutgoingMessages.set(msgId, Date.now());
    const convId = payload.conversation.id;

    io.to(convId.toString()).emit("new_message", {
      id: payload.id,
      type: "bot",
      content: payload.content,
      timestamp: new Date().toISOString(),
      assistanceNeeded: false,
    });
    io.to(convId.toString()).emit("bot_typing", false);
  }

  res.json({ status: "received" });
});

// Session cleanup: Remove sessions older than 24 hours
const SESSION_CLEANUP_MS = 24 * 60 * 60 * 1000; // 24 hours
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_CLEANUP_MS) {
      console.log(`🧹 Cleaning up expired session for ${userId}`);
      sessions.delete(userId);
    }
  }
}, 60 * 60 * 1000); // Check every hour

// ===========================================
// 🔌 API PROXY ROUTES (Server-side API calls)
// ===========================================

const CHARGER_API_URL = 'https://charging-stations-50025464585.development.catalystappsail.in';
const CHARGER_API_KEY = 'time-to-be-more';
const TEST_RIDE_API_KEY = 'AIzaSyDvzeKCQ-4bdT3WERsc6r6BMv236W0XXRY';
const OTP_API_URL = 'https://otp-final-50025655265.catalystappsail.in/accounts/authenticate';
const BOOKING_API_URL = 'https://cx.rapteelabs.com/v1';

// 🔋 Chargers API Proxy
app.get('/api/chargers/nearby/:lat/:lng/:range/:count', async (req, res) => {
  try {
    const { lat, lng, range, count } = req.params;
    const response = await axios.get(
      `${CHARGER_API_URL}/chargers/nearby/${lat}/${lng}/${range}/${count}`,
      { headers: { 'api_key': CHARGER_API_KEY } }
    );
    // Log full response to see available fields
    //console.log('Charger API Response:', JSON.stringify(response.data, null, 2));
    res.json(response.data);
  } catch (error) {
    console.error('Charger API error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch chargers' });
  }
});

// 🏍️ Test Ride Slot Check
app.post('/api/testride/slots', async (req, res) => {
  try {
    const response = await axios.post(
      `${BOOKING_API_URL}/fetch-test-ride-slots`,
      req.body,
      { headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_RIDE_API_KEY } }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Slot API error:', error.message);
    res.status(500).json({ status: false, error: 'Failed to fetch slots' });
  }
});

// 📱 OTP Generate
app.post('/api/otp/generate', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    // Don't encode - the API expects literal + sign
    const url = `${OTP_API_URL}/generateOtp?phoneNumber=${phoneNumber}`;
    //console.log('OTP API URL:', url);
    const response = await axios.get(url);
    res.json(response.data);
  } catch (error) {
    console.error('OTP generate error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: 'Failed to send OTP' });
  }
});

// ✅ OTP Validate
app.post('/api/otp/validate', async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;
    const validateBody = {
      phoneNumber,
      otp,
      source: 'creator',
      jwt_expiry: '30'
    };
    console.log('OTP Validate request body:', validateBody);
    const response = await axios.post(`${OTP_API_URL}/validateOtp`, validateBody, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('OTP Validate response:', response.data);
    res.json(response.data);
  } catch (error) {
    console.error('OTP validate error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: 'Failed to validate OTP' });
  }
});

// 📝 Book Test Ride
app.post('/api/testride/book', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    // console.log('Booking Auth Header:', authHeader);
    // console.log('Booking Body:', req.body);
    const response = await axios.post(`${BOOKING_API_URL}/book-test-ride`, req.body, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      }
    });
    console.log('Booking response:', response.data);
    res.json(response.data);
  } catch (error) {
    console.error('Booking API error:', error.response?.data || error.message);
    // Return actual API error message if available
    const apiError = error.response?.data;
    if (apiError && apiError.message) {
      res.status(400).json({ status: false, error: apiError.message });
    } else {
      res.status(500).json({ status: false, error: 'Failed to book test ride' });
    }
  }
});

// 📋 Get My Bookings
app.get('/api/bookings/my-bookings', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const response = await axios.get(`${BOOKING_API_URL}/bike/booking/my-bookings`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('My Bookings API error:', error.response?.data || error.message);
    const apiError = error.response?.data;
    if (apiError && apiError.message) {
      res.status(400).json({ status: false, error: apiError.message });
    } else {
      res.status(500).json({ status: false, error: 'Failed to fetch bookings' });
    }
  }
});

// 🌐 SPA Catch-all Route (must be last)
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT;
httpServer.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Server on ${PORT}`)
);
