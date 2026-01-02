// ================================================================
// 📱 WHATSAPP BOT ROUTER (from app.js)
// ================================================================
import { Router } from "express";
import axios from "axios";
import { retrieveRelevantChunks, getMistral } from "./chromaService.js";
import { getBotSettings } from "./settingsService.js";

const router = Router();

// Configuration
const CHATWOOT_BASE_URL = process.env.CHATWOOT_BASE_URL;
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID;
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN;
const INBOX_ID = 4;

const META_VERIFY_TOKEN = "raptee_2025";
const META_PHONE_ID = "382147674981778";
const META_TOKEN = "EAAG5l58dfGEBQANbk28mvahmQkpz4bxpHNj4VB7PoHlG2u6J9B4IGALZCtMYbh2jgZBVtWCKsjLbntS7ADcqgZBGfF3B3KxLQWwjPuPmYEYqkUB6qcyMAkAOyRZBWOQnZBcVdASdytuX7TegJd6UCsT0qtKK7CQmLRLiq3zJCI5ZC8eQ1aNMTDQwk5vZBtkFSG5gwZDZD";
const FLOW_TEMPLATE_NAME = "book_test_ride";

// Helper Functions
async function generateMistralResponse(context, userMessage) {
    const mistral = getMistral();
    if (!mistral) return "ASSISTANCE_NEEDED";

    // Load dynamic settings for WhatsApp bot
    const settings = await getBotSettings('whatsapp');
    const intro = settings.introduction || "You are Raptee.HV's AI assistant.";
    const dos = Array.isArray(settings.dos) ? settings.dos : [];
    const donts = Array.isArray(settings.donts) ? settings.donts : [];
    const wordLimit = settings.word_limit || 80;

    const dosText = dos.length > 0
        ? dos.map(d => `- ${d}`).join('\n')
        : `- Answer concisely
- Guide users to menu options when relevant
- Be helpful and professional`;

    const dontsText = donts.length > 0
        ? donts.map(d => `- ${d}`).join('\n')
        : `- Don't provide overly long responses
- Don't make up information`;

    const prompt = `${intro}

CONTEXT: ${context}
USER QUERY: ${userMessage}

GUIDELINES - DO:
${dosText}

GUIDELINES - DON'T:
${dontsText}

INTENT DETECTION (FIXED):
- If user asks about Booking, Showrooms, or Specifications, reply ONLY: "SHOW_MENU".
- If unknown or cannot answer confidently, reply ONLY: "ASSISTANCE_NEEDED".

Keep your response under ${wordLimit} words.`;

    try {
        const response = await mistral.chat.complete({
            model: "mistral-small-latest",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
        });
        return response.choices?.[0]?.message?.content || "ASSISTANCE_NEEDED";
    } catch (e) {
        return "ASSISTANCE_NEEDED";
    }
}

async function sendToUserWhatsApp(phone, text) {
    try {
        const url = `https://graph.facebook.com/v21.0/${META_PHONE_ID}/messages`;
        const payload = { messaging_product: "whatsapp", to: phone, type: "text", text: { body: text } };
        await axios.post(url, payload, { headers: { 'Authorization': `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' } });
        return true;
    } catch (e) {
        console.error("Meta Send Error:", e.message);
        return false;
    }
}

async function sendFlowViaMeta(userPhone) {
    try {
        const url = `https://graph.facebook.com/v21.0/${META_PHONE_ID}/messages`;
        const payload = {
            messaging_product: "whatsapp", to: userPhone, type: "template",
            template: {
                name: FLOW_TEMPLATE_NAME, language: { code: "en" },
                components: [{ type: "button", sub_type: "flow", index: 0, parameters: [{ type: "action", action: { flow_token: "flow_" + Date.now() } }] }]
            }
        };
        await axios.post(url, payload, { headers: { 'Authorization': `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' } });
        return true;
    } catch (error) {
        return false;
    }
}

async function sendListMenu(phone, customBodyText) {
    try {
        const bodyText = customBodyText || "How can I help you with the T30 today?";
        const url = `https://graph.facebook.com/v21.0/${META_PHONE_ID}/messages`;
        const payload = {
            messaging_product: "whatsapp", to: phone, type: "interactive",
            interactive: {
                type: "list",
                header: { type: "text", text: "RapteeHV Assistant" },
                body: { text: bodyText },
                footer: { text: "Select an option below" },
                action: {
                    button: "Open Menu",
                    sections: [
                        {
                            title: "Main Options", rows: [
                                { id: "menu_book", title: " Book Test Ride", description: "Schedule a slot" },
                                { id: "menu_showroom", title: " Showrooms", description: "Find dealers" },
                                { id: "menu_specs", title: " Specifications", description: "Range & Speed" }
                            ]
                        },
                        {
                            title: "Support", rows: [
                                { id: "menu_agent", title: "👥 Talk to Agent", description: "Human support" }
                            ]
                        }
                    ]
                }
            }
        };
        await axios.post(url, payload, { headers: { 'Authorization': `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' } });
        return true;
    } catch (e) {
        console.error("Meta List Error:", e.message);
        return false;
    }
}

async function syncToChatwoot(phone, messageBody, type = "incoming") {
    try {
        const searchUrl = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/search?q=${phone}`;
        const searchRes = await axios.get(searchUrl, { headers: { 'api_access_token': CHATWOOT_API_TOKEN } });

        let contactId;
        if (searchRes.data.payload.length > 0) {
            contactId = searchRes.data.payload[0].id;
        } else {
            const createRes = await axios.post(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts`,
                { phone_number: `+${phone}`, name: "WhatsApp User" },
                { headers: { 'api_access_token': CHATWOOT_API_TOKEN } }
            );
            contactId = createRes.data.payload.contact.id;
        }

        const convUrl = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations`;
        const convRes = await axios.post(convUrl,
            { source_id: phone, inbox_id: INBOX_ID, contact_id: contactId },
            { headers: { 'api_access_token': CHATWOOT_API_TOKEN } }
        );
        const conversationId = convRes.data.id;

        if (messageBody) {
            await axios.post(`${convUrl}/${conversationId}/messages`,
                { content: messageBody, message_type: type, private: false },
                { headers: { 'api_access_token': CHATWOOT_API_TOKEN } }
            );
        }
        return conversationId;
    } catch (e) {
        console.error("❌ Sync Error:", e.response?.data || e.message);
        return null;
    }
}

// Routes
router.get("/webhooks/meta", (req, res) => {
    if (req.query["hub.verify_token"] === META_VERIFY_TOKEN) {
        res.status(200).send(req.query["hub.challenge"]);
    } else {
        res.sendStatus(403);
    }
});

router.post("/webhooks/meta", async (req, res) => {
    res.sendStatus(200);

    try {
        const body = req.body;
        if (!body.entry?.[0]?.changes?.[0]?.value?.messages) return;

        const message = body.entry[0].changes[0].value.messages[0];
        const userPhone = message.from;
        console.log(`📱 WhatsApp from ${userPhone} [${message.type}]`);

        // Handle Flow Response
        if (message.type === "interactive" && message.interactive.type === "nfm_reply") {
            const rawJson = message.interactive.nfm_reply.response_json;
            const data = JSON.parse(rawJson);

            const bookingId = "TR-" + Math.floor(10000 + Math.random() * 90000);
            const uName = data.name || "Guest";
            const uPhone = data.phone || userPhone;
            const uEmail = data.email || "N/A";
            const uCity = data.city || "Selected City";
            const uDate = data.date || "Pending Date";
            const uTime = data.time || "Pending Time";

            const confirmationMsg = ` *Booking Confirmed!*

 *ID:* ${bookingId}
 *Name:* ${uName}
 *Email:* ${uEmail}
 *Phone:* ${uPhone}
 *City:* ${uCity}
 *Date:* ${uDate}
 *Time:* ${uTime}

Thank you! Our team will contact you shortly to confirm the slot.`;

            await sendToUserWhatsApp(userPhone, confirmationMsg);

            const agentViewData = ` *Test Ride Booking:*\nName: ${uName}\nPhone: ${uPhone}\nEmail: ${uEmail}\nCity: ${uCity}\nDate: ${uDate}\nTime: ${uTime}`;
            await syncToChatwoot(userPhone, agentViewData, "incoming");
            await syncToChatwoot(userPhone, confirmationMsg, "outgoing");
            return;
        }

        // Handle List Reply
        if (message.type === "interactive" && message.interactive.type === "list_reply") {
            const choiceId = message.interactive.list_reply.id;
            const choiceTitle = message.interactive.list_reply.title;

            await syncToChatwoot(userPhone, choiceTitle, "incoming");

            if (choiceId === "menu_book") {
                await sendFlowViaMeta(userPhone);
                await syncToChatwoot(userPhone, "[Bot sent Booking Flow]", "outgoing");
            } else if (choiceId === "menu_showroom") {
                const txt = "We are located at:\n123 High Voltage St, Chennai.";
                await sendToUserWhatsApp(userPhone, txt);
                await syncToChatwoot(userPhone, txt, "outgoing");
            } else if (choiceId === "menu_specs") {
                const txt = "*Raptee T30 Specs*\nRange: 150km\nSpeed: 135km/h\n0-60: 3.5s";
                await sendToUserWhatsApp(userPhone, txt);
                await syncToChatwoot(userPhone, txt, "outgoing");
            } else if (choiceId === "menu_agent") {
                const txt = "Connecting you to a human agent...";
                await sendToUserWhatsApp(userPhone, txt);
                await syncToChatwoot(userPhone, txt, "outgoing");
            }
            return;
        }

        // Handle Text Messages
        if (message.type === "text") {
            const text = message.text.body;
            const lowerText = text.toLowerCase();

            await syncToChatwoot(userPhone, text, "incoming");

            if (lowerText.includes("book") || lowerText.includes("ride")) {
                await sendListMenu(userPhone, "Great! Please select 'Book Test Ride' from the menu below.");
                await syncToChatwoot(userPhone, "[Bot sent Menu for Booking]", "outgoing");
                return;
            }

            if (lowerText.includes("showroom") || lowerText.includes("location") || lowerText.includes("where")) {
                await sendListMenu(userPhone, "You can find our locations in the menu below.");
                await syncToChatwoot(userPhone, "[Bot sent Menu for Showroom]", "outgoing");
                return;
            }

            if (["hi", "hello", "menu", "start"].includes(lowerText)) {
                await sendListMenu(userPhone, "Welcome to RapteeHV! How can I help you today?");
                await syncToChatwoot(userPhone, "[Bot sent Main Menu]", "outgoing");
                return;
            }

            // AI RAG Fallback
            const chunks = await retrieveRelevantChunks(text);
            const context = chunks.map(c => c.content).join("\n");
            const aiResponse = await generateMistralResponse(context, text);

            if (aiResponse.includes("SHOW_MENU") || aiResponse.includes("RIDE_INTENT")) {
                await sendListMenu(userPhone, "I can help with that! Please select an option below.");
                await syncToChatwoot(userPhone, "[Bot sent Menu via AI]", "outgoing");
            } else if (aiResponse.includes("ASSISTANCE_NEEDED")) {
                await sendListMenu(userPhone, "I'm not sure about that. Please select 'Talk to Agent' below.");
                await syncToChatwoot(userPhone, "[Bot sent Menu for Support]", "outgoing");
            } else {
                await sendToUserWhatsApp(userPhone, aiResponse + "\n\n_Type 'Menu' for more options_");
                await syncToChatwoot(userPhone, aiResponse, "outgoing");
            }
        }
    } catch (error) {
        console.error("❌ WhatsApp Webhook Error:", error);
    }
});

export default router;
