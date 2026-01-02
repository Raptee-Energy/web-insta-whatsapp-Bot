// ================================================================
// 🚀 UNIFIED SERVER - WhatsApp + Instagram + Website Chatbot
// ================================================================
// Single entry point that combines all 3 bot services

import express from "express";
import cors from "cors";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import axios from "axios";
import { Mistral } from "@mistralai/mistralai";
import { CloudClient } from "chromadb";

// Import bot routers
import whatsappRouter from "./services/whatsappBot.js";
import instaRouter from "./services/instaBot.js";
import { initChroma, retrieveRelevantChunks, getMistral, encodeSentences, initFromConfig, listCollections, getDocuments, addDocument, updateDocument, deleteDocument, clearCollection, createCollection, deleteCollection } from "./services/chromaService.js";
import { getBotSettings, saveBotSettings, deleteBotSettings, getDefaultSettings, getAllChromaConfigs, getChromaConfig, getActiveChromaConfig, saveChromaConfig, updateChromaConfig, deleteChromaConfig, activateChromaConfig, buildPrompt, warmCache, initCatalyst } from "./services/settingsService.js";

config();

// ES Module dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT;

const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(express.json());
app.use(cors());

// Initialize Catalyst SDK from first request (required for AppSail)
app.use((req, res, next) => {
    initCatalyst(req);
    next();
});

app.use(express.static(path.join(__dirname, "public")));


process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

const CHATWOOT_BASE_URL = process.env.CHATWOOT_BASE_URL;
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID;
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN;
const INBOX_IDENTIFIER = 4;

// 📊 Session Store (for website chatbot)
const sessions = new Map();
const recentOutgoingMessages = new Map();

// Conversation state management for web bot
const webBotStates = new Map();
const STATE = {
    IDLE: "IDLE",
    AWAITING_SUPPORT_FORM: "AWAITING_SUPPORT_FORM"
};

function getWebBotState(conversationId) {
    if (!webBotStates.has(conversationId)) {
        webBotStates.set(conversationId, {
            state: STATE.IDLE,
            pendingData: {},
            lastActivity: Date.now()
        });
    }
    return webBotStates.get(conversationId);
}

function updateWebBotState(conversationId, newState, data = {}) {
    const state = getWebBotState(conversationId);
    state.state = newState;
    state.pendingData = { ...state.pendingData, ...data };
    state.lastActivity = Date.now();
}

function clearWebBotState(conversationId) {
    webBotStates.delete(conversationId);
}

// Cleanup old states
setInterval(() => {
    const now = Date.now();
    for (const [id, ts] of recentOutgoingMessages.entries()) {
        if (now - ts > 5 * 60 * 1000) recentOutgoingMessages.delete(id);
    }
    for (const [conversationId, state] of webBotStates.entries()) {
        if (now - state.lastActivity > 30 * 60 * 1000) {
            webBotStates.delete(conversationId);
        }
    }
}, 5 * 60 * 1000);

// Initialize Chroma on startup
initChroma();

// Local Mistral instance for web bot
const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

function getChatwootHeaders() {
    return { "Content-Type": "application/json", "api_access_token": CHATWOOT_API_TOKEN };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 🔌 Socket.io (Website chatbot)
io.on("connection", (socket) => {
    console.log(`🔌 New client connected: ${socket.id}`);

    socket.on("join_conversation", (conversationId, callback) => {
        console.log(`👤 Socket ${socket.id} joining conversation: ${conversationId}`);
        if (conversationId) {
            socket.join(conversationId.toString());
            if (callback) callback({ status: "joined" });
        }
    });

    socket.on("error", (error) => {
        console.error(`❌ Socket error for ${socket.id}:`, error);
    });

    socket.on("disconnect", (reason) => {
        console.log(`🔌 Client disconnected: ${socket.id}, reason: ${reason}`);
    });
});

// ================================================================
// 🌐 WEBSITE CHATBOT API ROUTES
// ================================================================

// Helper: Get conversation details
async function getConversationDetails(conversationId) {
    try {
        const response = await axios.get(
            `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}`,
            { headers: getChatwootHeaders() }
        );
        return response.data;
    } catch (error) {
        console.error("Get conversation error:", error.response?.data || error.message);
        return null;
    }
}

// Helper: Update contact details
async function updateContactDetails(contactId, name, email) {
    try {
        const payload = {};
        if (name) payload.name = name;
        if (email) payload.email = email;

        await axios.put(
            `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/${contactId}`,
            payload,
            { headers: getChatwootHeaders() }
        );
        return true;
    } catch (error) {
        console.error("Update contact error:", error.response?.data || error.message);
        return false;
    }
}

// Helper: Handoff to agent
async function handoffToAgent(conversationId, contactId, reason = "") {
    try {
        // Send handoff message
        const handoffMessage = reason
            ? `I'm transferring you to a human agent. ${reason}`
            : "I'm transferring you to a human agent who can better assist you.";

        await sendChatwootMessage(conversationId, handoffMessage);

        // Add private note for agent
        await axios.post(
            `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
            {
                content: `Bot handoff: ${reason || "User requested human assistance"}`,
                message_type: "outgoing",
                private: true
            },
            { headers: getChatwootHeaders() }
        );

        // Change status to open
        await axios.post(
            `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/toggle_status`,
            { status: "open" },
            { headers: getChatwootHeaders() }
        );

        // Update state
        updateWebBotState(conversationId, STATE.HANDED_OFF);

        console.log(`✅ Handoff completed for conversation ${conversationId}`);
        return true;
    } catch (error) {
        console.error("Handoff error:", error.response?.data || error.message);
        return false;
    }
}

// 🧠 RAG Functions
async function fetchRecentMessages(conversationId, limit = 4) {
    try {
        const response = await axios.get(
            `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
            { headers: getChatwootHeaders() }
        );
        const msgs = response.data?.payload || [];
        const filtered = msgs.filter(m => !m.private && (m.message_type === 0 || m.message_type === 1)).slice(-limit);
        return filtered.map(m => (m.message_type === 0 ? "User" : "Bot") + `: ${m.content || ""}`).join("\n");
    } catch { return ""; }
}

async function generateMistralResponse(context, userMessage, conversationHistoryText = "") {
    // Load dynamic settings for website bot
    const settings = await getBotSettings('website');
    const intro = settings.introduction || "You are RapteeHV's professional AI assistant for the Raptee.HV T30 electric motorcycle.";
    const dos = Array.isArray(settings.dos) ? settings.dos : [];
    const donts = Array.isArray(settings.donts) ? settings.donts : [];
    const wordLimit = settings.word_limit || 100;

    // Build DO's section
    const dosText = dos.length > 0
        ? dos.map((d, i) => `${i + 1}. ${d}`).join('\n')
        : `1. Answer ONLY about Raptee.HV and the T30 motorcycle
2. Answer only for what the user asks, balanced information
3. For greetings, reply friendly and ask how you can help
4. Keep responses concise and professional`;

    // Build DON'Ts section
    const dontsText = donts.length > 0
        ? donts.map((d, i) => `${i + 1}. ${d}`).join('\n')
        : `1. Don't discuss competitor brands (Ather, Ola, Revolt, etc.)
2. Don't use emojis
3. Don't mention words like "database", "context", "knowledge base"
4. Don't invent specs not in CONTEXT`;

    const systemPrompt = `${intro}

CONTEXT FROM KNOWLEDGE BASE:
${context || "No relevant context found."}

CONVERSATION HISTORY:
${conversationHistoryText || "None"}

USER MESSAGE:
${userMessage}

GUIDELINES - DO:
${dosText}

GUIDELINES - DON'T:
${dontsText}

RESPONSE FORMAT (FIXED - JSON):
Respond in JSON: { "needs_handoff": boolean, "reason": string|null, "bot_response": string }

INTENT DETECTION (FIXED):
- Set needs_handoff to true if user explicitly asks for human agent, support, or has issues
- If CONTEXT doesn't contain enough info, say "I don't have that specific information, I will connect you with an agent." and set needs_handoff to true
- If user asks about competitor brands, reply: "As a Raptee assistant ask me anything about only Raptee and its features."

Keep your response under ${wordLimit} words.`;

    try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('LLM timeout')), 30000));
        const llmPromise = mistral.chat.complete({
            model: "mistral-small-latest",
            messages: [{ role: "user", content: systemPrompt }],
            temperature: 0.3,
            response_format: { type: "json_object" }
        });
        const response = await Promise.race([llmPromise, timeoutPromise]);
        let raw = response.choices?.[0]?.message?.content || "";

        // Strip markdown code blocks if present
        raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

        try {
            const parsed = JSON.parse(raw);
            return {
                needs_handoff: parsed.needs_handoff || false,
                reason: parsed.reason || null,
                bot_response: parsed.bot_response || "I'm here to help with any questions about the Raptee T30."
            };
        } catch {
            return { needs_handoff: false, reason: null, bot_response: raw || "I'm having trouble. Please try again." };
        }
    } catch (e) {
        console.error("LLM Error:", e.message);
        return { needs_handoff: true, reason: "Technical issues", bot_response: "I'm experiencing technical difficulties. Let me connect you with support." };
    }
}


async function sendChatwootMessage(conversationId, text) {
    try {
        await axios.post(
            `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
            { content: text, message_type: "outgoing", private: false },
            { headers: getChatwootHeaders() }
        );
        return true;
    } catch (e) {
        return false;
    }
}

async function processWebBotMessage(conversationId, contactId, userMessage) {
    try {
        // Normal RAG flow - bot always responds
        const [chunks, conversationHistoryText] = await Promise.all([
            retrieveRelevantChunks(userMessage, 2),
            fetchRecentMessages(conversationId, 4)
        ]);
        const context = chunks.map(c => c.content).join("\n");
        const mistralResult = await generateMistralResponse(context, userMessage, conversationHistoryText);

        if (mistralResult.needs_handoff) {
            // Show form request and handoff message
            const message = "I'd be happy to connect you with our support team. Please fill in your details using the form below.";
            await sendChatwootMessage(conversationId, message);

            io.to(conversationId.toString()).emit("new_message", {
                type: 'bot',
                content: message,
                showSupportForm: true,  // Frontend shows form
                assistanceNeeded: false
            });
        } else {
            // Send AI response
            if (mistralResult.bot_response) {
                await sendChatwootMessage(conversationId, mistralResult.bot_response);

                io.to(conversationId.toString()).emit("new_message", {
                    type: 'bot',
                    content: mistralResult.bot_response,
                    assistanceNeeded: false
                });
            }
        }

        return mistralResult;
    } catch (e) {
        console.error("Web bot processing error:", e);
        return { needs_handoff: true, bot_response: "I'm having trouble. Let me connect you with support." };
    }
}

// Health check
app.get("/health", (req, res) => res.json({ status: "healthy", services: ["web", "whatsapp", "instagram"] }));

// Chat init
app.post("/api/chat/init", async (req, res) => {
    try {
        const { visitorId, name, email } = req.body;
        const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

        // Check existing session
        if (sessions.has(visitorId)) {
            const session = sessions.get(visitorId);
            if (Date.now() - session.createdAt < SESSION_EXPIRY_MS) {
                return res.json({ success: true, sessionId: visitorId, contactId: session.contactId, conversationId: session.conversationId, existingSession: true });
            }
            sessions.delete(visitorId);
        }

        const userId = visitorId || `visitor_${crypto.randomBytes(4).toString("hex")}`;
        const contactRes = await axios.post(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts`, { name: name || "Website Visitor", email: email || null, identifier: userId }, { headers: getChatwootHeaders() });
        const contactId = contactRes.data.payload.contact.id;

        const convRes = await axios.post(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations`, { source_id: userId, inbox_id: INBOX_IDENTIFIER, contact_id: contactId }, { headers: getChatwootHeaders() });
        const conversationId = convRes.data.id;

        sessions.set(userId, { contactId, conversationId, createdAt: Date.now() });
        res.json({ success: true, sessionId: userId, contactId, conversationId });
    } catch (e) {
        console.error("Init error:", e.response?.data || e.message);
        res.status(500).json({ error: "Init Failed" });
    }
});

// Send message
app.post("/api/chat/message", async (req, res) => {
    try {
        const { sessionId, message, conversationId } = req.body;
        const session = sessions.get(sessionId);
        const contactId = session?.contactId;

        // Send user message to Chatwoot
        await axios.post(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`, { content: message, message_type: "incoming" }, { headers: getChatwootHeaders() });

        res.json({ success: true });

        // Process AI response asynchronously (don't block the response)
        setImmediate(async () => {
            try {
                // Show typing indicator
                io.to(conversationId.toString()).emit("bot_typing", true);

                // Process message
                await processWebBotMessage(conversationId, contactId, message);

                // Hide typing indicator
                io.to(conversationId.toString()).emit("bot_typing", false);
            } catch (e) {
                console.error("AI processing error:", e);
                io.to(conversationId.toString()).emit("bot_typing", false);
            }
        });
    } catch (e) {
        res.status(500).json({ error: "Send Failed" });
    }
});

// Update contact
app.post("/api/contact/update", async (req, res) => {
    try {
        const { sessionId, name, email, phone } = req.body;
        const session = sessions.get(sessionId);
        if (!session?.contactId) return res.status(400).json({ error: "Invalid session" });

        await axios.put(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/${session.contactId}`, { name, email, phone_number: phone }, { headers: getChatwootHeaders() });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "Update Failed" });
    }
});

// Support request (form submission)
app.post("/api/support/request", async (req, res) => {
    try {
        const { sessionId, conversationId, contactId, name, email, issue } = req.body;
        //console.log(`📋 Support request received: contactId=${contactId}, name=${name}, email=${email}`);

        // Update contact details using internal API
        if (contactId) {
            try {
                await axios.put(
                    `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/${contactId}`,
                    { name, email },
                    { headers: getChatwootHeaders() }
                );
                //console.log(`✅ Contact ${contactId} updated with name: ${name}, email: ${email}`);
            } catch (e) {
                console.error("Contact update error:", e.response?.data || e.message);
            }
        }

        // Add private note for agent with user details
        await axios.post(
            `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
            {
                content: `📋 Support Request\n\nName: ${name}\nEmail: ${email}\nIssue: ${issue}`,
                message_type: "outgoing",
                private: true
            },
            { headers: getChatwootHeaders() }
        );

        // Change status to open for agent
        await axios.post(
            `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/toggle_status`,
            { status: "open" },
            { headers: getChatwootHeaders() }
        );

        // Send confirmation to user
        const confirmMessage = `Thank you, ${name}. I've forwarded your request to our support team. They will contact you at ${email} shortly. Is there anything else I can help you with?`;
        await sendChatwootMessage(conversationId, confirmMessage);

        io.to(conversationId.toString()).emit("new_message", {
            type: 'bot',
            content: confirmMessage,
            assistanceNeeded: false
        });

        res.json({ success: true });
    } catch (e) {
        console.error("Support request error:", e);
        res.status(500).json({ error: "Support request failed" });
    }
});

// Get messages
app.get("/api/chat/messages/:conversationId", async (req, res) => {
    try {
        const response = await axios.get(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${req.params.conversationId}/messages`, { headers: getChatwootHeaders() });
        const systemPatterns = [
            /Conversation was created/i,
            /assigned to/i,
            /self-assigned/i,
            /unassigned/i,
            /changed the priority/i,
            /added .* label/i,
            /resolved this conversation/i,
            /reopened this conversation/i,
            /changed the status/i,
            /Automation System/i,
            /Conversation/i
        ];
        const isSystemMessage = (content) => !content || systemPatterns.some(p => p.test(content));
        const filtered = (response.data?.payload || []).filter(msg => !msg.private && !isSystemMessage(msg.content)).map(msg => ({
            id: msg.id,
            content: msg.content,
            sender: msg.sender?.name || (msg.message_type === 0 ? "You" : "Bot"),
            isBot: msg.message_type === 1,
            type: msg.message_type === 0 ? 'user' : 'bot',
            timestamp: msg.created_at
        }));
        res.json({ success: true, messages: filtered });
    } catch (e) {
        res.status(500).json({ error: "Fetch Failed" });
    }
});

// Chatwoot webhook (website)
app.post("/webhooks/chatwoot", async (req, res) => {
    res.status(200).send("OK");

    try {
        const event = req.body;

        // Handle status changes
        if (event.event === "conversation_status_changed") {
            const conversationId = event.id;
            const newStatus = event.status;

            console.log(`🔄 Conversation ${conversationId} status changed to: ${newStatus}`);

            if (newStatus === "resolved" || newStatus === "closed") {
                clearWebBotState(conversationId);
                console.log(`🧹 Cleared state for conversation ${conversationId}`);
            }

            return;
        }

        if (event.event !== "message_created" || event.message_type !== "incoming" || event.inbox?.id !== INBOX_IDENTIFIER) return;

        const conversationId = event.conversation?.id;
        const userMessage = event.content;
        const contactId = event.conversation?.contact_id;

        if (!conversationId || !userMessage || !contactId) return;

        console.log(`\n📨 Website bot - Incoming message from conversation ${conversationId}: "${userMessage}"`);

        // Check conversation status
        const conversationDetails = await getConversationDetails(conversationId);

        if (!conversationDetails) {
            console.log(`⚠️ Could not fetch conversation details for ${conversationId}`);
            return;
        }

        const conversationStatus = conversationDetails.status;
        console.log(`📊 Conversation Status: ${conversationStatus}`);

        // Bot only responds to "pending" conversations
        if (conversationStatus !== "pending") {
            console.log(`❌ Conversation status is "${conversationStatus}". Bot only responds to "pending" conversations.`);
            return;
        }

        console.log(`✅ Status is "pending". Bot will process this message.`);

        io.to(conversationId.toString()).emit("bot_typing", true);
        await processWebBotMessage(conversationId, contactId, userMessage);
        io.to(conversationId.toString()).emit("bot_typing", false);

    } catch (e) {
        console.error("Webhook error:", e);
    }
});

// ================================================================
// 🔌 API PROXY ROUTES
// ================================================================
const CHARGER_API_URL = 'https://charging-stations-50025464585.development.catalystappsail.in';
const CHARGER_API_KEY = 'time-to-be-more';
const TEST_RIDE_API_KEY = 'AIzaSyDvzeKCQ-4bdT3WERsc6r6BMv236W0XXRY';
const OTP_API_URL = 'https://otp-final-50025655265.catalystappsail.in/accounts/authenticate';
const BOOKING_API_URL = 'https://cx.rapteelabs.com/v1';

app.get('/api/chargers/nearby/:lat/:lng/:range/:count', async (req, res) => {
    try {
        const { lat, lng, range, count } = req.params;
        const response = await axios.get(`${CHARGER_API_URL}/chargers/nearby/${lat}/${lng}/${range}/${count}`, { headers: { 'api_key': CHARGER_API_KEY } });
        res.json(response.data);
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to fetch chargers' });
    }
});

app.post('/api/testride/slots', async (req, res) => {
    try {
        const response = await axios.post(`${BOOKING_API_URL}/fetch-test-ride-slots`, req.body, { headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_RIDE_API_KEY } });
        res.json(response.data);
    } catch (e) {
        res.status(500).json({ status: false, error: 'Failed to fetch slots' });
    }
});

app.post('/api/otp/generate', async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        const url = `${OTP_API_URL}/generateOtp?phoneNumber=${phoneNumber}`;
        const response = await axios.get(url);
        res.json(response.data);
    } catch (e) {
        console.error('OTP generate error:', e.response?.data || e.message);
        res.status(500).json({ success: false, error: 'Failed to send OTP' });
    }
});

app.post('/api/otp/validate', async (req, res) => {
    try {
        const { phoneNumber, otp } = req.body;
        const validateBody = { phoneNumber, otp, source: 'creator', jwt_expiry: '30' };
        const response = await axios.post(`${OTP_API_URL}/validateOtp`, validateBody, { headers: { 'Content-Type': 'application/json' } });
        res.json(response.data);
    } catch (e) {
        console.error('OTP validate error:', e.response?.data || e.message);
        res.status(500).json({ success: false, error: 'Failed to validate OTP' });
    }
});

app.post('/api/testride/book', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const response = await axios.post(`${BOOKING_API_URL}/book-test-ride`, req.body, { headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_RIDE_API_KEY, 'Authorization': authHeader } });
        res.json(response.data);
    } catch (e) {
        console.error('Test ride booking error:', e.response?.data || e.message);
        const errMsg = e.response?.data?.error?.message || e.response?.data?.message || 'Failed to book test ride';
        res.status(e.response?.status || 500).json({ status: false, error: errMsg });
    }
});

app.get('/api/bookings/my-bookings', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const response = await axios.get(`${BOOKING_API_URL}/bike/booking/my-bookings`, { headers: { 'Content-Type': 'application/json', 'Authorization': authHeader } });
        res.json(response.data);
    } catch (e) {
        console.error('My Bookings API error:', e.response?.data || e.message);
        res.status(e.response?.status || 500).json({ success: false, error: e.response?.data?.message || 'Failed to fetch bookings' });
    }
});

// ================================================================
// ⚙️ SETTINGS API ROUTES
// ================================================================

// Settings page
app.get('/settings', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'settings.html'));
});

// Bot Settings CRUD
app.get('/api/settings/:botType', async (req, res) => {
    try {
        const settings = await getBotSettings(req.params.botType);
        res.json(settings);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/settings/:botType', async (req, res) => {
    try {
        const result = await saveBotSettings(req.params.botType, req.body);
        res.json({ success: true, data: result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/settings/:botType', async (req, res) => {
    try {
        await deleteBotSettings(req.params.botType);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Chroma Configs CRUD
app.get('/api/chroma/configs', async (req, res) => {
    try {
        const configs = await getAllChromaConfigs();
        res.json(configs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/chroma/configs', async (req, res) => {
    try {
        const result = await saveChromaConfig(req.body);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/chroma/configs/:configId', async (req, res) => {
    try {
        const result = await updateChromaConfig(req.params.configId, req.body);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/chroma/configs/:configId', async (req, res) => {
    try {
        await deleteChromaConfig(req.params.configId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/chroma/activate/:configId/:collection', async (req, res) => {
    try {
        const result = await activateChromaConfig(req.params.configId, req.params.collection);
        // Re-initialize Chroma with new config
        const config = await getChromaConfig(req.params.configId);
        if (config) {
            await initFromConfig(config, req.params.collection);
        }
        res.json({ success: true, data: result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Chroma Collections
app.get('/api/chroma/collections/:configId', async (req, res) => {
    try {
        const config = await getChromaConfig(req.params.configId);
        if (!config) return res.status(404).json({ error: 'Config not found' });
        const collections = await listCollections(config);
        res.json(collections);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/chroma/collections/:configId', async (req, res) => {
    try {
        const config = await getChromaConfig(req.params.configId);
        if (!config) return res.status(404).json({ error: 'Config not found' });
        await createCollection(config, req.body.name);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/chroma/collections/:configId/:collectionName', async (req, res) => {
    try {
        const config = await getChromaConfig(req.params.configId);
        if (!config) return res.status(404).json({ error: 'Config not found' });
        await deleteCollection(config, req.params.collectionName);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Chroma Documents
app.get('/api/chroma/documents/:configId/:collection', async (req, res) => {
    try {
        const config = await getChromaConfig(req.params.configId);
        if (!config) return res.status(404).json({ error: 'Config not found' });
        const documents = await getDocuments(config, req.params.collection);
        res.json(documents);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/chroma/documents/:configId/:collection', async (req, res) => {
    try {
        const config = await getChromaConfig(req.params.configId);
        if (!config) return res.status(404).json({ error: 'Config not found' });
        const result = await addDocument(config, req.params.collection, req.body);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/chroma/documents/:configId/:collection/:docId', async (req, res) => {
    try {
        const config = await getChromaConfig(req.params.configId);
        if (!config) return res.status(404).json({ error: 'Config not found' });
        const result = await updateDocument(config, req.params.collection, req.params.docId, req.body);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/chroma/documents/:configId/:collection/:docId', async (req, res) => {
    try {
        const config = await getChromaConfig(req.params.configId);
        if (!config) return res.status(404).json({ error: 'Config not found' });
        await deleteDocument(config, req.params.collection, req.params.docId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/chroma/documents/:configId/:collection/clear', async (req, res) => {
    try {
        const config = await getChromaConfig(req.params.configId);
        if (!config) return res.status(404).json({ error: 'Config not found' });
        const result = await clearCollection(config, req.params.collection);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ================================================================
// 📱 MOUNT BOT ROUTERS
// ================================================================
app.use('/', whatsappRouter);    // WhatsApp: /webhooks/meta
app.use('/', instaRouter);       // Instagram: /webhooks/instagram

// 📄 SPA Catch-all
app.use((req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 🚀 START
httpServer.listen(PORT, "0.0.0.0", async () => {
    console.log(`Server running on port ${PORT}`);

    // Initialize Chroma connection
    await initChroma();

    // Warm the settings cache at startup
    await warmCache();
});
