// ================================================================
// 🔌 SHARED CHROMA + MISTRAL SERVICE
// ================================================================
import { CloudClient } from "chromadb";
import { Mistral } from "@mistralai/mistralai";
import { config } from "dotenv";

// Load env variables (needed when imported as module)
config();

const CHROMA_API_KEY = process.env.CHROMA_API_KEY;
const CHROMA_TENANT = process.env.CHROMA_TENANT;
const CHROMA_DATABASE = process.env.CHROMA_DATABASE;
const CHROMA_COLLECTION = process.env.CHROMA_COLLECTION;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

let chromaClient = null;
let collection = null;
let mistral = null;

// Initialize Chroma and Mistral
export async function initChroma() {
    try {
        if (CHROMA_API_KEY && CHROMA_TENANT && MISTRAL_API_KEY) {
            chromaClient = new CloudClient({
                tenant: CHROMA_TENANT,
                database: CHROMA_DATABASE,
                apiKey: CHROMA_API_KEY,
            });
            collection = await chromaClient.getCollection({ name: CHROMA_COLLECTION });
            mistral = new Mistral({ apiKey: MISTRAL_API_KEY });
            console.log("✅ Connected to Chroma and Mistral AI");
            return true;
        } else {
            console.log("⚠️ AI features disabled - missing API keys");
            return false;
        }
    } catch (err) {
        console.error("❌ Chroma/Mistral initialization error:", err.message);
        return false;
    }
}

export function getCollection() {
    return collection;
}

export function getMistral() {
    return mistral;
}

// Encode with Mistral embeddings
export async function encodeSentences(texts) {
    if (!mistral) return null;
    const textArray = Array.isArray(texts) ? texts : [texts];
    const res = await mistral.embeddings.create({
        model: "mistral-embed",
        inputs: textArray,
    });
    return res.data.map((d) => d.embedding);
}

// Retrieve top-k relevant chunks from Chroma
export async function retrieveRelevantChunks(query, topK = 5) {
    try {
        if (!collection || !mistral) {
            console.log("⚠️ Chroma not initialized, skipping retrieval");
            return [];
        }
        const embeddings = await encodeSentences([query]);
        if (!embeddings || embeddings.length === 0) return [];

        const results = await collection.query({
            queryEmbeddings: embeddings,
            nResults: topK,
        });

        const docs = results?.documents?.[0] || [];
        const metas = results?.metadatas?.[0] || [];
        return docs.map((doc, i) => ({
            content: doc,
            source: metas[i]?.source || "unknown",
        }));
    } catch (err) {
        console.error("Chroma retrieval error:", err.message);
        return [];
    }
}
