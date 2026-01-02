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
let activeConfig = null;

// Initialize Chroma and Mistral from environment variables
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

// Initialize Chroma from a stored config (for dynamic switching)
export async function initFromConfig(chromaConfig, collectionName) {
    try {
        if (!chromaConfig || !chromaConfig.api_key) {
            console.log("⚠️ Invalid Chroma config provided");
            return false;
        }

        chromaClient = new CloudClient({
            tenant: chromaConfig.tenant,
            database: chromaConfig.chromaDatabase,
            apiKey: chromaConfig.api_key,
        });
        collection = await chromaClient.getCollection({ name: collectionName });
        activeConfig = { ...chromaConfig, activeCollection: collectionName };

        // Initialize Mistral if not already done
        if (!mistral && MISTRAL_API_KEY) {
            mistral = new Mistral({ apiKey: MISTRAL_API_KEY });
        }

        console.log(`✅ Chroma switched to: ${chromaConfig.name} / ${collectionName}`);
        return true;
    } catch (err) {
        console.error("❌ Chroma config initialization error:", err.message);
        return false;
    }
}

export function getCollection() {
    return collection;
}

export function getMistral() {
    return mistral;
}

export function getActiveConfig() {
    return activeConfig;
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
        const ids = results?.ids?.[0] || [];
        return docs.map((doc, i) => ({
            id: ids[i],
            content: doc,
            question: metas[i]?.question || doc.substring(0, 100),
            answer: metas[i]?.answer || doc,
            source: metas[i]?.source || "unknown",
        }));
    } catch (err) {
        console.error("Chroma retrieval error:", err.message);
        return [];
    }
}

// ================================================================
// CHROMA MANAGEMENT FUNCTIONS
// ================================================================

// Create a temporary client from config for management operations
function createClientFromConfig(chromaConfig) {
    return new CloudClient({
        tenant: chromaConfig.tenant,
        database: chromaConfig.chromaDatabase,
        apiKey: chromaConfig.api_key,
    });
}

// List all collections for a given config
export async function listCollections(chromaConfig) {
    try {
        const client = createClientFromConfig(chromaConfig);
        const collections = await client.listCollections();
        return collections.map(c => ({ name: c.name, metadata: c.metadata }));
    } catch (err) {
        console.error("List collections error:", err.message);
        throw err;
    }
}

// Create a new collection
export async function createCollection(chromaConfig, collectionName) {
    try {
        const client = createClientFromConfig(chromaConfig);
        await client.createCollection({ name: collectionName });
        console.log(`✅ Created collection: ${collectionName}`);
        return { success: true };
    } catch (err) {
        console.error("Create collection error:", err.message);
        throw err;
    }
}

// Delete a collection
export async function deleteCollection(chromaConfig, collectionName) {
    try {
        const client = createClientFromConfig(chromaConfig);
        await client.deleteCollection({ name: collectionName });
        console.log(`🗑️ Deleted collection: ${collectionName}`);
        return { success: true };
    } catch (err) {
        console.error("Delete collection error:", err.message);
        throw err;
    }
}

// Get all documents from a collection
export async function getDocuments(chromaConfig, collectionName, limit = 100) {
    try {
        const client = createClientFromConfig(chromaConfig);
        const coll = await client.getCollection({ name: collectionName });

        const results = await coll.get({
            limit: limit,
            include: ["documents", "metadatas"]
        });

        const docs = results?.documents || [];
        const metas = results?.metadatas || [];
        const ids = results?.ids || [];

        return docs.map((doc, i) => ({
            id: ids[i],
            content: doc,
            question: metas[i]?.question || '',
            answer: metas[i]?.answer || doc,
        }));
    } catch (err) {
        console.error("Get documents error:", err.message);
        throw err;
    }
}

// Add a document to a collection
export async function addDocument(chromaConfig, collectionName, docData) {
    try {
        const client = createClientFromConfig(chromaConfig);
        const coll = await client.getCollection({ name: collectionName });

        // Generate embedding for the question
        const embedText = docData.question + " " + docData.answer;
        const embeddings = await encodeSentences([embedText]);

        if (!embeddings || embeddings.length === 0) {
            throw new Error("Failed to generate embedding");
        }

        const docId = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        await coll.add({
            ids: [docId],
            documents: [docData.answer],
            embeddings: embeddings,
            metadatas: [{ question: docData.question, answer: docData.answer, source: "settings" }]
        });

        console.log(`✅ Added document: ${docId}`);
        return { success: true, id: docId };
    } catch (err) {
        console.error("Add document error:", err.message);
        throw err;
    }
}

// Update a document in a collection
export async function updateDocument(chromaConfig, collectionName, docId, docData) {
    try {
        const client = createClientFromConfig(chromaConfig);
        const coll = await client.getCollection({ name: collectionName });

        // Generate new embedding
        const embedText = docData.question + " " + docData.answer;
        const embeddings = await encodeSentences([embedText]);

        if (!embeddings || embeddings.length === 0) {
            throw new Error("Failed to generate embedding");
        }

        await coll.update({
            ids: [docId],
            documents: [docData.answer],
            embeddings: embeddings,
            metadatas: [{ question: docData.question, answer: docData.answer, source: "settings" }]
        });

        console.log(`✅ Updated document: ${docId}`);
        return { success: true };
    } catch (err) {
        console.error("Update document error:", err.message);
        throw err;
    }
}

// Delete a document from a collection
export async function deleteDocument(chromaConfig, collectionName, docId) {
    try {
        const client = createClientFromConfig(chromaConfig);
        const coll = await client.getCollection({ name: collectionName });

        await coll.delete({ ids: [docId] });

        console.log(`🗑️ Deleted document: ${docId}`);
        return { success: true };
    } catch (err) {
        console.error("Delete document error:", err.message);
        throw err;
    }
}

// Clear all documents from a collection
export async function clearCollection(chromaConfig, collectionName) {
    try {
        const client = createClientFromConfig(chromaConfig);
        const coll = await client.getCollection({ name: collectionName });

        // Get all document IDs
        const results = await coll.get({ include: [] });
        const ids = results?.ids || [];

        if (ids.length > 0) {
            await coll.delete({ ids: ids });
        }

        console.log(`🗑️ Cleared ${ids.length} documents from ${collectionName}`);
        return { success: true, deleted: ids.length };
    } catch (err) {
        console.error("Clear collection error:", err.message);
        throw err;
    }
}
