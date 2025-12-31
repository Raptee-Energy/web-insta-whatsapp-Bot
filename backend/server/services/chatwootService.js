// ================================================================
// 📡 SHARED CHATWOOT SERVICE
// ================================================================
import axios from "axios";

const CHATWOOT_BASE_URL = process.env.CHATWOOT_BASE_URL;
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID;
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN;

export function getChatwootHeaders() {
    return {
        "Content-Type": "application/json",
        api_access_token: CHATWOOT_API_TOKEN,
    };
}

export function getChatwootConfig() {
    return {
        baseUrl: CHATWOOT_BASE_URL,
        accountId: CHATWOOT_ACCOUNT_ID,
        token: CHATWOOT_API_TOKEN,
    };
}

// Send message to Chatwoot conversation
export async function sendChatwootMessage(conversationId, content, messageType = "outgoing", isPrivate = false) {
    try {
        const url = `${CHATWOOT_BASE_URL}/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`;
        const payload = {
            content,
            message_type: messageType,
            private: isPrivate,
            content_type: "text"
        };
        const response = await axios.post(url, payload, { headers: getChatwootHeaders() });
        return response.data;
    } catch (error) {
        console.error("Chatwoot send error:", error.response?.data || error.message);
        throw error;
    }
}

// Get conversation details
export async function getConversationDetails(conversationId) {
    try {
        const url = `${CHATWOOT_BASE_URL}/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}`;
        const response = await axios.get(url, { headers: getChatwootHeaders() });
        return response.data;
    } catch (error) {
        console.error("Chatwoot getConversation error:", error.response?.data || error.message);
        return null;
    }
}

// Get conversation messages
export async function getConversationMessages(conversationId) {
    try {
        const url = `${CHATWOOT_BASE_URL}/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`;
        const response = await axios.get(url, { headers: getChatwootHeaders() });
        return response.data?.payload || [];
    } catch (error) {
        console.error("Chatwoot getMessages error:", error.response?.data || error.message);
        return [];
    }
}

// Toggle conversation status
export async function toggleConversationStatus(conversationId, status = "open") {
    try {
        const url = `${CHATWOOT_BASE_URL}/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/toggle_status`;
        const response = await axios.post(url, { status }, { headers: getChatwootHeaders() });
        return response.data;
    } catch (error) {
        console.error("Chatwoot toggleStatus error:", error.response?.data || error.message);
        throw error;
    }
}

// Create contact
export async function createContact(name, identifier, email = null, phone = null) {
    try {
        const url = `${CHATWOOT_BASE_URL}/accounts/${CHATWOOT_ACCOUNT_ID}/contacts`;
        const payload = { name, identifier };
        if (email) payload.email = email;
        if (phone) payload.phone_number = phone;
        const response = await axios.post(url, payload, { headers: getChatwootHeaders() });
        return response.data?.payload?.contact;
    } catch (error) {
        console.error("Chatwoot createContact error:", error.response?.data || error.message);
        throw error;
    }
}

// Create conversation
export async function createConversation(sourceId, inboxId, contactId) {
    try {
        const url = `${CHATWOOT_BASE_URL}/accounts/${CHATWOOT_ACCOUNT_ID}/conversations`;
        const payload = { source_id: sourceId, inbox_id: inboxId, contact_id: contactId };
        const response = await axios.post(url, payload, { headers: getChatwootHeaders() });
        return response.data;
    } catch (error) {
        console.error("Chatwoot createConversation error:", error.response?.data || error.message);
        throw error;
    }
}
