// ================================================================
// 📸 INSTAGRAM BOT ROUTER (from insta.js)
// ================================================================
import { Router } from "express";
import axios from "axios";
import { retrieveRelevantChunks, getMistral } from "./chromaService.js";

const router = Router();

// Configuration
const CHATWOOT_BASE_URL = process.env.CHATWOOT_BASE_URL || "https://support.raptee.in";
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || "2";
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN;
const CHATWOOT_BOT_TOKEN = "5jcP2pkCVB4hzuzuYqrZxTKG";
const INSTAGRAM_INBOX_ID = process.env.INSTAGRAM_INBOX_ID || "9";

const WHATSAPP_REDIRECT_NUMBER = process.env.WHATSAPP_NUMBER || "919344313804";
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_REDIRECT_NUMBER}`;

// In-memory conversation state management
const conversationStates = new Map();
const CONVERSATION_TIMEOUT = 30 * 60 * 1000;

const STATE = {
    IDLE: "IDLE",
    AWAITING_BOOKING_CONFIRMATION: "AWAITING_BOOKING_CONFIRMATION",
    AWAITING_T30_CONFIRMATION: "AWAITING_T30_CONFIRMATION",
    AWAITING_SHOWROOM_CITY: "AWAITING_SHOWROOM_CITY",
    AWAITING_SUPPORT_CONFIRMATION: "AWAITING_SUPPORT_CONFIRMATION"
};

const MENU_OPTIONS = { BOOK_TEST_RIDE: "1", LOCATE_SHOWROOM: "2", BOOK_T30: "3" };

const SHOWROOM_LOCATIONS = {
    chennai: { name: "Chennai Showroom", address: "123 Anna Salai, Nungambakkam, Chennai - 600034", phone: "+91 44 1234 5678", hours: "Mon-Sat: 10:00 AM - 7:00 PM" },
    bangalore: { name: "Bangalore Showroom", address: "456 MG Road, Indiranagar, Bangalore - 560038", phone: "+91 80 9876 5432", hours: "Mon-Sat: 10:00 AM - 7:00 PM" }
};

// State Management
function getConversationState(conversationId) {
    if (!conversationStates.has(conversationId)) {
        conversationStates.set(conversationId, { state: STATE.IDLE, lastActivity: Date.now(), context: {} });
    }
    const state = conversationStates.get(conversationId);
    state.lastActivity = Date.now();
    return state;
}

function updateConversationState(conversationId, newState, context = {}) {
    const state = getConversationState(conversationId);
    state.state = newState;
    state.context = { ...state.context, ...context };
    state.lastActivity = Date.now();
}

function clearConversationState(conversationId) {
    conversationStates.delete(conversationId);
}

// Cleanup old states
setInterval(() => {
    const now = Date.now();
    for (const [id, state] of conversationStates.entries()) {
        if (now - state.lastActivity > CONVERSATION_TIMEOUT) conversationStates.delete(id);
    }
}, 5 * 60 * 1000);

// Format for Instagram (strip markdown)
function formatForInstagram(text) {
    if (!text) return text;
    return text
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/~~([^~]+)~~/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^[\-\*]\s+/gm, '• ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// AI Response
async function generateAIResponse(context, userMessage) {
    const mistral = getMistral();
    if (!mistral) return "ASSISTANCE_NEEDED";

    const prompt = `You are RapteeHV's professional customer service assistant for Instagram.
CONTEXT: ${context}
USER QUERY: ${userMessage}
INSTRUCTIONS:
- If users explicitly ask to connect with an agent, or if they are facing any issues respond with: ASSISTANCE_NEEDED
- If you cannot answer confidently, respond with: ASSISTANCE_NEEDED
- Provide concise, professional responses without emojis
- If the query relates to booking a test ride, respond with: INTENT_BOOKING
- If the query relates to booking/buying T30, respond with: INTENT_T30
- If the query relates to showroom locations, respond with: INTENT_SHOWROOM
- Otherwise, provide a helpful answer and end with: "Type 'menu' to see all available options."`;

    try {
        const response = await mistral.chat.complete({
            model: "mistral-small-latest",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2
        });
        return response.choices?.[0]?.message?.content || "ASSISTANCE_NEEDED";
    } catch (e) {
        console.error("AI Generation Error:", e.message);
        return "Please try again in a moment, or reply 'menu' to see options.";
    }
}

// Chatwoot Functions
async function getConversationDetails(conversationId) {
    try {
        const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}`;
        const response = await axios.get(url, { headers: { api_access_token: CHATWOOT_API_TOKEN, "Content-Type": "application/json" } });
        return response.data;
    } catch (e) {
        return null;
    }
}

async function sendChatwootMessage(conversationId, content, messageType = "outgoing", isHandoff = false) {
    try {
        const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`;
        const formattedContent = formatForInstagram(content);
        const token = (CHATWOOT_BOT_TOKEN && !isHandoff) ? CHATWOOT_BOT_TOKEN : CHATWOOT_API_TOKEN;
        await axios.post(url, { content: formattedContent, message_type: messageType, private: false, content_type: "text" }, { headers: { api_access_token: token, "Content-Type": "application/json" } });
        return true;
    } catch (e) {
        console.error("Instagram Chatwoot error:", e.message);
        return false;
    }
}

async function handoffToAgent(conversationId, reason = "") {
    try {
        const msg = reason ? `I'm transferring you to a human agent. ${reason}` : "I'm transferring you to a human agent.";
        await sendChatwootMessage(conversationId, msg, "outgoing", false);

        const noteUrl = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`;
        await axios.post(noteUrl, { content: `Bot handoff: ${reason || "User requested human assistance"}`, message_type: "outgoing", private: true }, { headers: { api_access_token: CHATWOOT_API_TOKEN, "Content-Type": "application/json" } });

        const statusUrl = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/toggle_status`;
        await axios.post(statusUrl, { status: "open" }, { headers: { api_access_token: CHATWOOT_API_TOKEN, "Content-Type": "application/json" } });

        clearConversationState(conversationId);
        console.log(`✅ Instagram handoff for ${conversationId}`);
        return true;
    } catch (e) {
        return false;
    }
}

// Message Templates
function getMainMenu() {
    return `Welcome to RapteeHV!\n\nAsk me anything about Raptee.HV T30!\n\n1. Book a Test Ride\n2. Locate Showroom\n3. Book T30\n\nReply with a number or type your question.`;
}

function getShowroomCityMenu() {
    return `Please select your preferred city:\n\n1. Chennai\n2. Bangalore\n\nReply with the number.`;
}

function getShowroomDetails(city) {
    const loc = SHOWROOM_LOCATIONS[city.toLowerCase()];
    if (!loc) return "Sorry, we don't have a showroom there yet.\n\nType 'menu' to return.";
    return `${loc.name}\n\nAddress: ${loc.address}\nPhone: ${loc.phone}\nHours: ${loc.hours}\n\nType 'menu' to return.`;
}

function getBookingRedirectMessage(type) {
    const text = type === "t30" ? "Book T30" : "Book Test Ride";
    return `To complete your booking, please continue on WhatsApp:\n\n${WHATSAPP_LINK}?text=${encodeURIComponent(text)}\n\nSend "${text}" to begin.`;
}

// Process Message
async function processUserMessage(conversationId, messageContent) {
    const msg = messageContent.trim().toLowerCase();
    const state = getConversationState(conversationId);

    if (["menu", "start", "hi", "hello"].includes(msg)) {
        updateConversationState(conversationId, STATE.IDLE);
        await sendChatwootMessage(conversationId, getMainMenu());
        return;
    }

    // Handle state-based flows
    if (state.state === STATE.AWAITING_BOOKING_CONFIRMATION) {
        if (msg === "yes" || msg === "y") { await sendChatwootMessage(conversationId, getBookingRedirectMessage("test_ride")); updateConversationState(conversationId, STATE.IDLE); }
        else if (msg === "no" || msg === "n") { await sendChatwootMessage(conversationId, "No problem. Type 'menu' for options."); updateConversationState(conversationId, STATE.IDLE); }
        else await sendChatwootMessage(conversationId, "Please reply 'yes' or 'no'.");
        return;
    }

    if (state.state === STATE.AWAITING_T30_CONFIRMATION) {
        if (msg === "yes" || msg === "y") { await sendChatwootMessage(conversationId, getBookingRedirectMessage("t30")); updateConversationState(conversationId, STATE.IDLE); }
        else if (msg === "no" || msg === "n") { await sendChatwootMessage(conversationId, "No problem. Type 'menu' for options."); updateConversationState(conversationId, STATE.IDLE); }
        else await sendChatwootMessage(conversationId, "Please reply 'yes' or 'no'.");
        return;
    }

    if (state.state === STATE.AWAITING_SHOWROOM_CITY) {
        if (msg === "1" || msg.includes("chennai")) { await sendChatwootMessage(conversationId, getShowroomDetails("chennai")); updateConversationState(conversationId, STATE.IDLE); }
        else if (msg === "2" || msg.includes("bangalore")) { await sendChatwootMessage(conversationId, getShowroomDetails("bangalore")); updateConversationState(conversationId, STATE.IDLE); }
        else await sendChatwootMessage(conversationId, "Please select 1 or 2.");
        return;
    }

    if (state.state === STATE.AWAITING_SUPPORT_CONFIRMATION) {
        if (msg === "yes" || msg === "y") { await sendChatwootMessage(conversationId, "I've forwarded your request to our team. We'll get back to you as soon as possible."); await handoffToAgent(conversationId, state.context.supportReason); }
        else if (msg === "no" || msg === "n") { await sendChatwootMessage(conversationId, "No problem. Type 'menu' for options."); updateConversationState(conversationId, STATE.IDLE); }
        else await sendChatwootMessage(conversationId, "Please reply 'yes' or 'no'.");
        return;
    }

    // Menu selections
    if (msg === MENU_OPTIONS.BOOK_TEST_RIDE) { updateConversationState(conversationId, STATE.AWAITING_BOOKING_CONFIRMATION); await sendChatwootMessage(conversationId, "Would you like to book a test ride? Reply 'yes' or 'no'."); return; }
    if (msg === MENU_OPTIONS.LOCATE_SHOWROOM) { updateConversationState(conversationId, STATE.AWAITING_SHOWROOM_CITY); await sendChatwootMessage(conversationId, getShowroomCityMenu()); return; }
    if (msg === MENU_OPTIONS.BOOK_T30) { updateConversationState(conversationId, STATE.AWAITING_T30_CONFIRMATION); await sendChatwootMessage(conversationId, "Would you like to book the T30? Reply 'yes' or 'no'."); return; }

    // AI Response
    try {
        const chunks = await retrieveRelevantChunks(messageContent);
        const context = chunks.map(c => c.content).join("\n");
        const aiResponse = await generateAIResponse(context, messageContent);

        if (aiResponse.includes("INTENT_BOOKING")) { updateConversationState(conversationId, STATE.AWAITING_BOOKING_CONFIRMATION); await sendChatwootMessage(conversationId, "Would you like to book a test ride? Reply 'yes' or 'no'."); }
        else if (aiResponse.includes("INTENT_T30")) { updateConversationState(conversationId, STATE.AWAITING_T30_CONFIRMATION); await sendChatwootMessage(conversationId, "Would you like to book the T30? Reply 'yes' or 'no'."); }
        else if (aiResponse.includes("INTENT_SHOWROOM")) { updateConversationState(conversationId, STATE.AWAITING_SHOWROOM_CITY); await sendChatwootMessage(conversationId, getShowroomCityMenu()); }
        else if (aiResponse.includes("INTENT_SUPPORT_DIRECT") || aiResponse.includes("ASSISTANCE_NEEDED")) {
            updateConversationState(conversationId, STATE.AWAITING_SUPPORT_CONFIRMATION, { supportReason: "User query" });
            await sendChatwootMessage(conversationId, "Would you like me to connect you with support? Reply 'yes' or 'no'.");
        } else {
            await sendChatwootMessage(conversationId, aiResponse);
        }
    } catch (error) {
        console.error("Error processing AI response:", error);
        await sendChatwootMessage(conversationId, "I'm sorry, I encountered a temporary error. Please try again explicitly or type 'menu'.");
    }
}

// Routes
router.post("/webhooks/instagram", async (req, res) => {
    res.sendStatus(200);
    try {
        const event = req.body;

        if (event.event === "conversation_status_changed") {
            const { id, status } = event;
            console.log(`📸 Instagram: Conversation ${id} status: ${status}`);
            if (status === "resolved" || status === "closed") clearConversationState(id);
            return;
        }

        if (event.event !== "message_created" || event.message_type !== "incoming" || event.inbox?.id !== parseInt(INSTAGRAM_INBOX_ID)) return;

        const conversationId = event.conversation?.id;
        const messageContent = event.content;
        if (!conversationId || !messageContent) return;

        console.log(`📸 Instagram from ${conversationId}: "${messageContent}"`);

        const details = await getConversationDetails(conversationId);
        if (!details || details.status !== "pending") {
            console.log(`❌ Instagram: Status not pending, skipping`);
            return;
        }

        await processUserMessage(conversationId, messageContent);
    } catch (e) {
        console.error("❌ Instagram webhook error:", e);
    }
});

export default router;
