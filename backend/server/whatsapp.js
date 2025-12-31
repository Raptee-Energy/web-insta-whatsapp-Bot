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

const PORT = 3000;
const CHATWOOT_BASE_URL = "https://itsviswa.xyz"; 
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || "2";
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN || "q2zguKG4dCHfTwbMD7uurjvK";
const INBOX_ID = 4; 

// Meta Config
const META_VERIFY_TOKEN = "raptee_2025"; 
const META_PHONE_ID = "382147674981778"; 
const META_TOKEN = "EAAG5l58dfGEBQANbk28mvahmQkpz4bxpHNj4VB7PoHlG2u6J9B4IGALZCtMYbh2jgZBVtWCKsjLbntS7ADcqgZBGfF3B3KxLQWwjPuPmYEYqkUB6qcyMAkAOyRZBWOQnZBcVdASdytuX7TegJd6UCsT0qtKK7CQmLRLiq3zJCI5ZC8eQ1aNMTDQwk5vZBtkFSG5gwZDZD";

const FLOW_TEMPLATE_NAME = "book_test_ride"; 
// RAG Config (Placeholders)
const CHROMA_API_KEY = process.env.CHROMA_API_KEY || "ck-GJzP9838Fh2zaVTDYqD7wtTnrwDC4zqyRSFA7AdzoRPk";
const CHROMA_TENANT = process.env.CHROMA_TENANT || "41b639a8-5e0d-4be2-9baf-3d1af3588b35";
const CHROMA_DATABASE = process.env.CHROMA_DATABASE || "bot";
const CHROMA_COLLECTION = process.env.CHROMA_COLLECTION || "raptee_t30_faq_light";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "XW2JnhSibycLLgD1E7xDpomTkYmOa1B8";

let chromaClient, collection;
(async () => {
  try {
    chromaClient = new CloudClient({ tenant: CHROMA_TENANT, database: CHROMA_DATABASE, apiKey: CHROMA_API_KEY });
    collection = await chromaClient.getCollection({ name: CHROMA_COLLECTION });
    console.log(`✅ Connected to Chroma`);
  } catch (err) { console.error("❌ Chroma Error:", err.message); }
})();



const mistral = new Mistral({ apiKey: MISTRAL_API_KEY });

async function retrieveRelevantChunks(query, topK=3) {
    try {
        if(!collection) return [];
        const response = await mistral.embeddings.create({ model: "mistral-embed", inputs: [query] });
        const embedding = response.data[0].embedding;
        const results = await collection.query({ queryEmbeddings: [embedding], nResults: topK });
        return results.documents?.[0] || [];
    } catch(e) { return []; }
}

async function generateMistralResponse(context, userMessage) {
    const prompt = `You are Raptee.HV's AI assistant. 
    CONTEXT: ${context}
    USER QUERY: ${userMessage}
    INSTRUCTIONS: Answer concisely. 
    - If user asks about Booking, Showrooms, or Specifications, reply ONLY: "SHOW_MENU".
    - If unknown, reply ONLY: "ASSISTANCE_NEEDED".`;

    try {
        const response = await mistral.chat.complete({ 
            model: "mistral-small-latest", 
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2, 
        });
        return response.choices?.[0]?.message?.content || "ASSISTANCE_NEEDED";
    } catch(e) { return "ASSISTANCE_NEEDED"; }
}

async function sendToUserWhatsApp(phone, text) {
    try {
        const url = `https://graph.facebook.com/v21.0/${META_PHONE_ID}/messages`;
        const payload = { messaging_product: "whatsapp", to: phone, type: "text", text: { body: text } };
        await axios.post(url, payload, { headers: { 'Authorization': `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' } });
        return true;
    } catch (e) { console.error("Meta Send Error:", e.message); return false; }
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
  } catch (error) { return false; }
}

// ✅ UPDATED: Dynamic List Menu
async function sendListMenu(phone, customBodyText) {
    try {
        // Default text if none provided
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
                        { title: "Main Options", rows: [
                            { id: "menu_book", title: "📅 Book Test Ride", description: "Schedule a slot" },
                            { id: "menu_showroom", title: "📍 Showrooms", description: "Find dealers" },
                            { id: "menu_specs", title: "⚡ Specifications", description: "Range & Speed" }
                        ]},
                        { title: "Support", rows: [
                            { id: "menu_agent", title: "👥 Talk to Agent", description: "Human support" }
                        ]}
                    ]
                }
            }
        };
        await axios.post(url, payload, { headers: { 'Authorization': `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' } });
        return true;
    } catch (e) { console.error("Meta List Error:", e.message); return false; }
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

app.get("/webhooks/meta", (req, res) => {
  if (req.query["hub.verify_token"] === META_VERIFY_TOKEN) {
    res.status(200).send(req.query["hub.challenge"]);
  } else { res.sendStatus(403); }
});

app.post("/webhooks/meta", async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;
    if (!body.entry?.[0]?.changes?.[0]?.value?.messages) return;

    const message = body.entry[0].changes[0].value.messages[0];
    const userPhone = message.from; 
    console.log(`📥 Received from ${userPhone} [${message.type}]`);

  if (message.type === "interactive" && message.interactive.type === "nfm_reply") {
    const rawJson = message.interactive.nfm_reply.response_json;
    const data = JSON.parse(rawJson);
    
    console.log("📥 Raw Flow Data:", data);

    const bookingId = "TR-" + Math.floor(10000 + Math.random() * 90000);

    // ✅ Updated field names
    const uName = data.name || "Guest";
    const uPhone = data.phone || userPhone;
    const uEmail = data.email || "N/A";
    const uCity = data.city || "Selected City";
    const uDate = data.date || "Pending Date";
    const uTime = data.time || "Pending Time";

    const confirmationMsg = `✅ *Booking Confirmed!*

🆔 *ID:* ${bookingId}
👤 *Name:* ${uName}
📧 *Email:* ${uEmail}
📱 *Phone:* ${uPhone}
📍 *City:* ${uCity}
📅 *Date:* ${uDate}
⏰ *Time:* ${uTime}

Thank you! Our team will contact you shortly to confirm the slot.`;
    
    await sendToUserWhatsApp(userPhone, confirmationMsg);
    
    const agentViewData = `📝 *Test Ride Booking:*\nName: ${uName}\nPhone: ${uPhone}\nEmail: ${uEmail}\nCity: ${uCity}\nDate: ${uDate}\nTime: ${uTime}`;
    await syncToChatwoot(userPhone, agentViewData, "incoming");
    await syncToChatwoot(userPhone, confirmationMsg, "outgoing");
    
    return;
}

    // --- CASE B: USER CLICKED LIST MENU ---
    if (message.type === "interactive" && message.interactive.type === "list_reply") {
        const choiceId = message.interactive.list_reply.id;
        const choiceTitle = message.interactive.list_reply.title;

        await syncToChatwoot(userPhone, choiceTitle, "incoming");

        if (choiceId === "menu_book") {
            // Now we trigger the Flow because they explicitly clicked it in the menu
            await sendFlowViaMeta(userPhone);
            await syncToChatwoot(userPhone, "[Bot sent Booking Flow]", "outgoing");
        } 
        else if (choiceId === "menu_showroom") {
            const txt = "📍 We are located at:\n123 High Voltage St, Chennai.";
            await sendToUserWhatsApp(userPhone, txt);
            await syncToChatwoot(userPhone, txt, "outgoing");
        }
        else if (choiceId === "menu_specs") {
            const txt = "⚡ *Raptee T30 Specs*\nRange: 150km\nSpeed: 135km/h\n0-60: 3.5s";
            await sendToUserWhatsApp(userPhone, txt);
            await syncToChatwoot(userPhone, txt, "outgoing");
        }
        else if (choiceId === "menu_agent") {
            const txt = "👥 Connecting you to a human agent...";
            await sendToUserWhatsApp(userPhone, txt);
            await syncToChatwoot(userPhone, txt, "outgoing");
        }
        return;
    }

    // --- CASE C: TEXT MESSAGE ---
    if (message.type === "text") {
        const text = message.text.body;
        const lowerText = text.toLowerCase();
        
        await syncToChatwoot(userPhone, text, "incoming");

        // ✅ LOGIC UPDATE: Use Menu for Everything
        
        // 1. Booking Intent? -> Show Menu with custom text
        if (lowerText.includes("book") || lowerText.includes("ride")) {
            await sendListMenu(userPhone, "Great! Please select 'Book Test Ride' from the menu below.");
            await syncToChatwoot(userPhone, "[Bot sent Menu for Booking]", "outgoing");
            return;
        }

        // 2. Showroom Intent? -> Show Menu
        if (lowerText.includes("showroom") || lowerText.includes("location") || lowerText.includes("where")) {
            await sendListMenu(userPhone, "You can find our locations in the menu below.");
            await syncToChatwoot(userPhone, "[Bot sent Menu for Showroom]", "outgoing");
            return;
        }

        // 3. Greeting/General Menu
        if (["hi", "hello", "menu", "start"].includes(lowerText)) {
            await sendListMenu(userPhone, "Welcome to RapteeHV! How can I help you today?");
            await syncToChatwoot(userPhone, "[Bot sent Main Menu]", "outgoing");
            return;
        }

        // 4. AI RAG Fallback
        const chunks = await retrieveRelevantChunks(text);
        const aiResponse = await generateMistralResponse(chunks.join("\n"), text);
        
        if (aiResponse.includes("SHOW_MENU") || aiResponse.includes("RIDE_INTENT")) {
            // If AI thinks the user wants a core service, show the menu
            await sendListMenu(userPhone, "I can help with that! Please select an option below.");
            await syncToChatwoot(userPhone, "[Bot sent Menu via AI]", "outgoing");
        } else if (aiResponse.includes("ASSISTANCE_NEEDED")) {
            await sendListMenu(userPhone, "I'm not sure about that. Please select 'Talk to Agent' below.");
            await syncToChatwoot(userPhone, "[Bot sent Menu for Support]", "outgoing");
        } else {
            // Valid AI Answer -> Send text + Reminder to check menu
            await sendToUserWhatsApp(userPhone, aiResponse + "\n\n_Type 'Menu' for more options_");
            await syncToChatwoot(userPhone, aiResponse, "outgoing");
        }
    }

  } catch (error) {
    console.error("❌ Webhook Logic Error:", error);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Middleman Server Active on Port ${PORT}`);
});