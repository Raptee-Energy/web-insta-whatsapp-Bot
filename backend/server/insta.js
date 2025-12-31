import express from "express";
import axios from "axios";
import cors from "cors";
import { config } from "dotenv";
import { CloudClient } from "chromadb";
import { Mistral } from "@mistralai/mistralai";

config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = 3001;
const CHATWOOT_BASE_URL = "https://support.raptee.in";
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || "2";
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN;
const CHATWOOT_BOT_TOKEN = "5jcP2pkCVB4hzuzuYqrZxTKG"; // Bot-specific access token
const INSTAGRAM_INBOX_ID = process.env.INSTAGRAM_INBOX_ID || "9";

const WHATSAPP_REDIRECT_NUMBER = process.env.WHATSAPP_NUMBER || "919344313804";
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_REDIRECT_NUMBER}`;

const CHROMA_API_KEY = process.env.CHROMA_API_KEY;
const CHROMA_TENANT = process.env.CHROMA_TENANT;
const CHROMA_DATABASE = process.env.CHROMA_DATABASE || "bot";
const CHROMA_COLLECTION = process.env.CHROMA_COLLECTION || "raptee_t30_faq_light";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

// In-memory conversation state management
const conversationStates = new Map();

const CONVERSATION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// State machine for conversation flows
const STATE = {
    IDLE: "IDLE",
    AWAITING_BOOKING_CONFIRMATION: "AWAITING_BOOKING_CONFIRMATION",
    AWAITING_T30_CONFIRMATION: "AWAITING_T30_CONFIRMATION",
    AWAITING_SHOWROOM_CITY: "AWAITING_SHOWROOM_CITY",
    AWAITING_SUPPORT_CONFIRMATION: "AWAITING_SUPPORT_CONFIRMATION"
};

const MENU_OPTIONS = {
    BOOK_TEST_RIDE: "1",
    LOCATE_SHOWROOM: "2",
    BOOK_T30: "3"
};

const SHOWROOM_LOCATIONS = {
    chennai: {
        name: "Chennai Showroom",
        address: "123 Anna Salai, Nungambakkam, Chennai - 600034",
        phone: "+91 44 1234 5678",
        hours: "Mon-Sat: 10:00 AM - 7:00 PM, Sun: 10:00 AM - 5:00 PM"
    },
    bangalore: {
        name: "Bangalore Showroom",
        address: "456 MG Road, Indiranagar, Bangalore - 560038",
        phone: "+91 80 9876 5432",
        hours: "Mon-Sat: 10:00 AM - 7:00 PM, Sun: 10:00 AM - 5:00 PM"
    }
};

// Initialize Chroma and Mistral
let chromaClient, collection, mistral;

(async () => {
    try {
        if (CHROMA_API_KEY && CHROMA_TENANT && MISTRAL_API_KEY) {
            chromaClient = new CloudClient({
                tenant: CHROMA_TENANT,
                database: CHROMA_DATABASE,
                apiKey: CHROMA_API_KEY
            });
            collection = await chromaClient.getCollection({ name: CHROMA_COLLECTION });
            mistral = new Mistral({ apiKey: MISTRAL_API_KEY });
            console.log("Connected to Chroma and Mistral AI");
        } else {
            console.log("AI features disabled - missing API keys");
        }
    } catch (err) {
        console.error("AI initialization error:", err.message);
    }
})();

// Conversation state management
function getConversationState(conversationId) {
    if (!conversationStates.has(conversationId)) {
        conversationStates.set(conversationId, {
            state: STATE.IDLE,
            lastActivity: Date.now(),
            context: {}
        });
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

// Cleanup old conversation states
setInterval(() => {
    const now = Date.now();
    for (const [conversationId, state] of conversationStates.entries()) {
        if (now - state.lastActivity > CONVERSATION_TIMEOUT) {
            conversationStates.delete(conversationId);
        }
    }
}, 5 * 60 * 1000); // Run every 5 minutes

// Instagram Text Formatting Helper
// Strips markdown symbols that Instagram doesn't render
function formatForInstagram(text) {
    if (!text) return text;

    return text
        // Remove bold markdown: **text** or __text__
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        // Remove italic markdown: *text* or _text_
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        // Remove strikethrough: ~~text~~
        .replace(/~~([^~]+)~~/g, '$1')
        // Remove inline code: `text`
        .replace(/`([^`]+)`/g, '$1')
        // Remove headers: # text, ## text, etc.
        .replace(/^#{1,6}\s+/gm, '')
        // Remove bullet points: - item or * item (at start of line)
        .replace(/^[\-\*]\s+/gm, '• ')
        // Clean up extra whitespace
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// AI Helper Functions
async function retrieveRelevantChunks(query, topK = 5) {
    try {
        if (!collection || !mistral) return [];
        const response = await mistral.embeddings.create({
            model: "mistral-embed",
            inputs: [query]
        });
        const embedding = response.data[0].embedding;
        const results = await collection.query({
            queryEmbeddings: [embedding],
            nResults: topK
        });
        return results.documents?.[0] || [];
    } catch (e) {
        console.error("Chunk retrieval error:", e.message);
        return [];
    }
}

async function generateAIResponse(context, userMessage) {
    const prompt = `You are RapteeHV's professional customer service assistant for Instagram.

CONTEXT: ${context}
USER QUERY: ${userMessage}

INSTRUCTIONS:
- Provide concise, professional responses without emojis
- If the query relates to booking a test ride, respond with: INTENT_BOOKING
- If the query relates to booking/buying T30, respond with: INTENT_T30
- If the query relates to showroom locations, respond with: INTENT_SHOWROOM
- If the query relates to support issues like booking problems, payment issues, refunds, delivery issues, service complaints, order status, cancellations, or any issue requiring customer assistance, first provide a brief helpful response about their issue, then end with: INTENT_SUPPORT
- If users explicitly ask to connect with an agent/human/staff, respond with: INTENT_SUPPORT_DIRECT
- If you cannot answer confidently about product information, respond with: ASSISTANCE_NEEDED
- Otherwise, provide a helpful answer and end with: "Type 'menu' to see all available options."`;

    try {
        if (!mistral) return "ASSISTANCE_NEEDED";

        const response = await mistral.chat.complete({
            model: "mistral-small-latest",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2
        });
        return response.choices?.[0]?.message?.content || "ASSISTANCE_NEEDED";
    } catch (e) {
        console.error("AI response error:", e.message);
        return "ASSISTANCE_NEEDED";
    }
}

// Chatwoot API Functions
async function getConversationDetails(conversationId) {
    try {
        const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}`;
        const response = await axios.get(url, {
            headers: {
                api_access_token: CHATWOOT_API_TOKEN,
                "Content-Type": "application/json"
            }
        });
        return response.data;
    } catch (error) {
        console.error("Get conversation error:", error.response?.data || error.message);
        return null;
    }
}

async function sendChatwootMessage(conversationId, content, messageType = "outgoing", isHandoff = false) {
    try {
        const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`;

        // Format content for Instagram (strip markdown symbols)
        const formattedContent = formatForInstagram(content);

        const payload = {
            content: formattedContent,
            message_type: messageType,
            private: false,
            content_type: "text"
        };

        // Determine which token to use
        const token = (CHATWOOT_BOT_TOKEN && !isHandoff) ? CHATWOOT_BOT_TOKEN : CHATWOOT_API_TOKEN;

        await axios.post(url, payload, {
            headers: {
                api_access_token: token,
                "Content-Type": "application/json"
            }
        });
        return true;
    } catch (error) {
        console.error("Chatwoot message error:", error.response?.data || error.message);
        return false;
    }
}

async function handoffToAgent(conversationId, reason = "") {
    try {
        // Send handoff message as bot
        const handoffMessage = reason
            ? `I'm transferring you to a human agent. ${reason}`
            : "I'm transferring you to a human agent who can better assist you.";

        await sendChatwootMessage(conversationId, handoffMessage, "outgoing", false);

        // Add internal note for agent context
        const noteUrl = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`;
        await axios.post(
            noteUrl,
            {
                content: `Bot handoff: ${reason || "User requested human assistance"}`,
                message_type: "outgoing",
                private: true
            },
            {
                headers: {
                    api_access_token: CHATWOOT_API_TOKEN,
                    "Content-Type": "application/json"
                }
            }
        );

        // Change conversation status to "open" (this stops the bot from responding)
        const statusUrl = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/toggle_status`;
        await axios.post(statusUrl, { status: "open" }, {
            headers: {
                api_access_token: CHATWOOT_API_TOKEN,
                "Content-Type": "application/json"
            }
        });

        // Clear conversation state since agent is taking over
        clearConversationState(conversationId);

        console.log(`✅ Handoff completed for conversation ${conversationId} - Status changed to "open"`);
        return true;
    } catch (error) {
        console.error("Handoff error:", error.response?.data || error.message);
        return false;
    }
}

// Message Templates
function getMainMenu() {
    return `Welcome to RapteeHV!

Ask me anything about Raptee.HV T30 - I'm here to help with your questions!

You can also explore the menu options below:

1. Book a Test Ride
2. Locate Showroom
3. Book T30

Reply with the number of your choice, or simply type your question.`;
}

function getShowroomCityMenu() {
    return `Please select your preferred city:

1. Chennai
2. Bangalore

Reply with the number of your choice.`;
}

function getShowroomDetails(city) {
    const location = SHOWROOM_LOCATIONS[city.toLowerCase()];
    if (!location) {
        return "Sorry, we don't have a showroom in that location yet. Our current locations are Chennai and Bangalore.\n\nType 'menu' to return to the main menu.";
    }

    return `${location.name}

Address: ${location.address}
Phone: ${location.phone}
Hours: ${location.hours}

Type 'menu' to return to the main menu.`;
}

function getBookingRedirectMessage(type) {
    const messages = {
        test_ride: `To complete your test ride booking, please continue on WhatsApp where we can collect your details and schedule your appointment.

Click here to continue: ${WHATSAPP_LINK}?text=Book%20Test%20Ride

Once on WhatsApp, send the message "Book Test Ride" to begin the booking process.`,

        t30: `To complete your T30 booking, please continue on WhatsApp where our team can assist you with the purchase process.

Click here to continue: ${WHATSAPP_LINK}?text=Book%20T30

Once on WhatsApp, send the message "Book T30" to begin.`
    };

    return messages[type] || messages.test_ride;
}

// Message Processing Logic
async function processUserMessage(conversationId, messageContent) {
    const normalizedMessage = messageContent.trim().toLowerCase();
    const conversationState = getConversationState(conversationId);

    // Handle menu command
    if (normalizedMessage === "menu" || normalizedMessage === "start" || normalizedMessage === "hi" || normalizedMessage === "hello") {
        updateConversationState(conversationId, STATE.IDLE);
        await sendChatwootMessage(conversationId, getMainMenu());
        return;
    }

    // Handle state-based responses
    switch (conversationState.state) {
        case STATE.AWAITING_BOOKING_CONFIRMATION:
            if (normalizedMessage === "yes" || normalizedMessage === "y") {
                await sendChatwootMessage(conversationId, getBookingRedirectMessage("test_ride"));
                updateConversationState(conversationId, STATE.IDLE);
            } else if (normalizedMessage === "no" || normalizedMessage === "n") {
                await sendChatwootMessage(conversationId, "No problem. Is there anything else I can help you with?\n\nType 'menu' to see all available options.");
                updateConversationState(conversationId, STATE.IDLE);
            } else {
                await sendChatwootMessage(conversationId, "Please reply with 'yes' to proceed with booking or 'no' to cancel.");
            }
            return;

        case STATE.AWAITING_T30_CONFIRMATION:
            if (normalizedMessage === "yes" || normalizedMessage === "y") {
                await sendChatwootMessage(conversationId, getBookingRedirectMessage("t30"));
                updateConversationState(conversationId, STATE.IDLE);
            } else if (normalizedMessage === "no" || normalizedMessage === "n") {
                await sendChatwootMessage(conversationId, "No problem. Is there anything else I can help you with?\n\nType 'menu' to see all available options.");
                updateConversationState(conversationId, STATE.IDLE);
            } else {
                await sendChatwootMessage(conversationId, "Please reply with 'yes' to proceed with booking or 'no' to cancel.");
            }
            return;

        case STATE.AWAITING_SHOWROOM_CITY:
            if (normalizedMessage === "1" || normalizedMessage.includes("chennai")) {
                await sendChatwootMessage(conversationId, getShowroomDetails("chennai"));
                updateConversationState(conversationId, STATE.IDLE);
            } else if (normalizedMessage === "2" || normalizedMessage.includes("bangalore") || normalizedMessage.includes("bengaluru")) {
                await sendChatwootMessage(conversationId, getShowroomDetails("bangalore"));
                updateConversationState(conversationId, STATE.IDLE);
            } else {
                await sendChatwootMessage(conversationId, "Please select a valid option (1 for Chennai or 2 for Bangalore).");
            }
            return;

        case STATE.AWAITING_SUPPORT_CONFIRMATION:
            if (normalizedMessage === "yes" || normalizedMessage === "y") {
                // User confirmed they want to connect with support
                await sendChatwootMessage(
                    conversationId,
                    "I've forwarded your request to our customer support team. They will get back to you shortly to assist you further. Thank you for your patience!"
                );
                await handoffToAgent(conversationId, conversationState.context.supportReason || "Customer requested support assistance.");
            } else if (normalizedMessage === "no" || normalizedMessage === "n") {
                await sendChatwootMessage(
                    conversationId,
                    "No problem! Is there anything else I can help you with?\n\nType 'menu' to see all available options."
                );
                updateConversationState(conversationId, STATE.IDLE);
            } else {
                await sendChatwootMessage(
                    conversationId,
                    "Please reply with 'yes' to connect with our customer support team or 'no' to continue chatting with me."
                );
            }
            return;
    }

    // Handle menu selections in IDLE state
    if (conversationState.state === STATE.IDLE) {
        if (normalizedMessage === MENU_OPTIONS.BOOK_TEST_RIDE) {
            updateConversationState(conversationId, STATE.AWAITING_BOOKING_CONFIRMATION);
            await sendChatwootMessage(
                conversationId,
                "Would you like to book a test ride for the Raptee T30?\n\nPlease reply with 'yes' to continue or 'no' to cancel."
            );
            return;
        }

        if (normalizedMessage === MENU_OPTIONS.LOCATE_SHOWROOM) {
            updateConversationState(conversationId, STATE.AWAITING_SHOWROOM_CITY);
            await sendChatwootMessage(conversationId, getShowroomCityMenu());
            return;
        }

        if (normalizedMessage === MENU_OPTIONS.BOOK_T30) {
            updateConversationState(conversationId, STATE.AWAITING_T30_CONFIRMATION);
            await sendChatwootMessage(
                conversationId,
                "Would you like to proceed with booking the Raptee T30?\n\nPlease reply with 'yes' to continue or 'no' to cancel."
            );
            return;
        }
    }

    // AI-powered response for general queries
    const chunks = await retrieveRelevantChunks(messageContent);
    const aiResponse = await generateAIResponse(chunks.join("\n"), messageContent);

    if (aiResponse.includes("INTENT_BOOKING")) {
        updateConversationState(conversationId, STATE.AWAITING_BOOKING_CONFIRMATION);
        await sendChatwootMessage(
            conversationId,
            "Would you like to book a test ride for the Raptee T30?\n\nPlease reply with 'yes' to continue or 'no' to cancel."
        );
    } else if (aiResponse.includes("INTENT_T30")) {
        updateConversationState(conversationId, STATE.AWAITING_T30_CONFIRMATION);
        await sendChatwootMessage(
            conversationId,
            "Would you like to proceed with booking the Raptee T30?\n\nPlease reply with 'yes' to continue or 'no' to cancel."
        );
    } else if (aiResponse.includes("INTENT_SHOWROOM")) {
        updateConversationState(conversationId, STATE.AWAITING_SHOWROOM_CITY);
        await sendChatwootMessage(conversationId, getShowroomCityMenu());
    } else if (aiResponse.includes("INTENT_SUPPORT_DIRECT")) {
        // User explicitly asked to connect with support - ask for confirmation
        updateConversationState(conversationId, STATE.AWAITING_SUPPORT_CONFIRMATION, {
            supportReason: "User requested to speak with customer support."
        });
        await sendChatwootMessage(
            conversationId,
            "I'd be happy to connect you with our customer support team.\n\nWould you like me to connect you with our customer support to assist you better?\n\nPlease reply with 'yes' or 'no'."
        );
    } else if (aiResponse.includes("INTENT_SUPPORT")) {
        // Support-related query - provide response and offer to connect
        const cleanResponse = aiResponse.replace(/INTENT_SUPPORT/g, '').trim();
        const supportMessage = cleanResponse
            ? `${cleanResponse}\n\nWould you like me to connect you with our customer support to assist you better?\n\nPlease reply with 'yes' or 'no'.`
            : "I understand you're facing an issue. Would you like me to connect you with our customer support to assist you better?\n\nPlease reply with 'yes' or 'no'.";

        updateConversationState(conversationId, STATE.AWAITING_SUPPORT_CONFIRMATION, {
            supportReason: `Customer inquiry: ${messageContent.substring(0, 100)}`
        });
        await sendChatwootMessage(conversationId, supportMessage);
    } else if (aiResponse.includes("ASSISTANCE_NEEDED")) {
        // Bot can't answer - offer to connect with support
        updateConversationState(conversationId, STATE.AWAITING_SUPPORT_CONFIRMATION, {
            supportReason: "Bot could not answer customer query."
        });
        await sendChatwootMessage(
            conversationId,
            "I'm not able to answer that question at the moment. Would you like me to connect you with our customer support to assist you better?\n\nPlease reply with 'yes' or 'no'."
        );
    } else {
        // Send AI-generated response
        await sendChatwootMessage(conversationId, aiResponse);
    }
}

// Webhook endpoint for Chatwoot
app.post("/webhooks/chatwoot", async (req, res) => {
    res.sendStatus(200);

    try {
        const event = req.body;

        // Handle conversation status changes (resolved/closed)
        if (event.event === "conversation_status_changed") {
            const conversationId = event.id;
            const newStatus = event.status;

            console.log(`🔄 Conversation ${conversationId} status changed to: ${newStatus}`);

            // If conversation is resolved/closed, clear the handoff state
            if (newStatus === "resolved" || newStatus === "closed") {
                clearConversationState(conversationId);
                console.log(`🧹 Cleared state for conversation ${conversationId}`);
            }

            return;
        }

        // Only process incoming messages from Instagram inbox
        if (
            event.event !== "message_created" ||
            event.message_type !== "incoming" ||
            event.inbox?.id !== parseInt(INSTAGRAM_INBOX_ID)
        ) {
            return;
        }

        const conversationId = event.conversation?.id;
        const messageContent = event.content;

        if (!conversationId || !messageContent) {
            return;
        }

        console.log(`\n📨 Incoming message from conversation ${conversationId}: "${messageContent}"`);

        // Check conversation status from Chatwoot
        const conversationDetails = await getConversationDetails(conversationId);

        if (!conversationDetails) {
            console.log(`⚠️ Could not fetch conversation details for ${conversationId}`);
            return;
        }

        const conversationStatus = conversationDetails.status;

        // Log conversation details for debugging
        console.log(`📊 Conversation Status: ${conversationStatus}`);

        // Bot only responds to "pending" conversations
        // "open" = Agent is handling, "resolved" = Closed
        if (conversationStatus !== "pending") {
            console.log(`❌ Conversation status is "${conversationStatus}". Bot only responds to "pending" conversations.`);
            return;
        }

        console.log(`✅ Status is "pending". Bot will process this message.`);

        // Process the message
        await processUserMessage(conversationId, messageContent);

    } catch (error) {
        console.error("❌ Webhook processing error:", error);
    }
});

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({
        status: "healthy",
        service: "Instagram Chatwoot Bot",
        timestamp: new Date().toISOString(),
        activeConversations: conversationStates.size
    });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Instagram Chatwoot Bot Server running on port ${PORT}`);
    console.log(`Webhook endpoint: http://localhost:${PORT}/webhooks/chatwoot`);
});