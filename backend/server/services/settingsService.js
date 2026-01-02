// ================================================================
// ⚙️ SETTINGS SERVICE - Bot Settings & Chroma Config Management
// ================================================================
// Manages bot instructions and Chroma database configurations
// Uses Zoho Catalyst Data Store for persistence

import { config } from "dotenv";
import catalyst from "zcatalyst-sdk-node";
config();

// Table names in Catalyst Data Store
const TABLES = {
    BOT_SETTINGS: "BotSettings",
    CHROMA_CONFIGS: "ChromaConfigs"
};

// In-memory cache with TTL
// Settings rarely change, so we use a longer TTL to minimize queries
const cache = {
    botSettings: new Map(),
    chromaConfigs: null,
    activeChromaConfig: null,
    lastFetch: { botSettings: {}, chromaConfigs: 0 },
    TTL: 300000, // 5 minutes cache for bot settings (rarely change)
    CHROMA_TTL: 60000, // 1 minute for chroma configs (may change more often)
    initialized: false
};

// Default settings for each bot type
const DEFAULT_SETTINGS = {
    website: {
        bot_type: "website",
        introduction: "You are RapteeHV's professional AI assistant for the Raptee.HV T30 electric motorcycle.",
        dos: [
            "Answer ONLY about Raptee.HV and the T30 motorcycle",
            "Be friendly for greetings",
            "Keep responses concise and professional",
            "Use the provided context to answer questions"
        ],
        donts: [
            "Don't discuss competitor brands (Ather, Ola, Revolt, etc.)",
            "Don't use emojis",
            "Don't make up information not in context",
            "Don't mention words like 'database', 'context', 'knowledge base'"
        ],
        word_limit: 100,
        n_results: 2
    },
    instagram: {
        bot_type: "instagram",
        introduction: "You are RapteeHV's professional customer service assistant for Instagram.",
        dos: [
            "Provide concise, professional responses",
            "Guide users to book test rides or find showrooms",
            "Answer questions about T30 features"
        ],
        donts: [
            "Don't use emojis",
            "Don't make up information",
            "Don't provide pricing without context"
        ],
        word_limit: 80,
        n_results: 2
    },
    whatsapp: {
        bot_type: "whatsapp",
        introduction: "You are Raptee.HV's AI assistant for WhatsApp.",
        dos: [
            "Answer concisely",
            "Guide users to menu options when relevant",
            "Be helpful and professional"
        ],
        donts: [
            "Don't provide overly long responses",
            "Don't make up information"
        ],
        word_limit: 80,
        n_results: 2
    }
};

// ================================================================
// CATALYST SDK HELPERS
// ================================================================

let catalystApp = null;
let lastRequestTimestamp = 0;

// Initialize Catalyst app from request (for Catalyst-hosted apps)
// IMPORTANT: Re-initialize on each request to get fresh OAuth token
export function initCatalyst(req) {
    if (req) {
        try {
            // Always re-initialize to get fresh OAuth token
            catalystApp = catalyst.initialize(req);
            lastRequestTimestamp = Date.now();
        } catch (error) {
            console.error("❌ Catalyst SDK initialization failed:", error.message);
        }
    }
}

// Get Catalyst app instance
function getCatalystApp() {
    // Return cached instance if available and recent (within 5 minutes)
    if (catalystApp && (Date.now() - lastRequestTimestamp) < 300000) {
        return catalystApp;
    }

    // If no valid instance, try parameterless init (for non-request contexts)
    try {
        catalystApp = catalyst.initialize();
        lastRequestTimestamp = Date.now();
        return catalystApp;
    } catch {
        // Silent fail - will use file-based fallback
        return null;
    }
}


// Get Data Store table reference
async function getTable(tableName) {
    const app = getCatalystApp();
    if (!app) return null;

    try {
        const datastore = app.datastore();
        return datastore.table(tableName);
    } catch (error) {
        console.error(`Error getting table ${tableName}:`, error.message);
        return null;
    }
}

// Execute ZCQL query
async function executeQuery(query) {
    const app = getCatalystApp();
    if (!app) return null;

    try {
        const zcql = app.zcql();
        const result = await zcql.executeZCQLQuery(query);
        return result || [];
    } catch (error) {
        console.error(`ZCQL query error:`, error.message);
        return [];
    }
}

// ================================================================
// FILE-BASED FALLBACK (for local development)
// ================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getFilePath(tableName) {
    return path.join(DATA_DIR, `${tableName}.json`);
}

function readTable(tableName) {
    const filePath = getFilePath(tableName);
    if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    return [];
}

function writeTable(tableName, data) {
    const filePath = getFilePath(tableName);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ================================================================
// BOT SETTINGS API
// ================================================================

export async function getBotSettings(botType) {
    // Check cache first
    const now = Date.now();
    if (cache.botSettings.has(botType) && (now - cache.lastFetch.botSettings[botType]) < cache.TTL) {
        return cache.botSettings.get(botType);
    }

    try {
        const app = getCatalystApp();

        if (app) {
            // Catalyst Data Store query using ZCQL
            const query = `SELECT * FROM ${TABLES.BOT_SETTINGS} WHERE bot_type = '${botType}'`;
            const result = await executeQuery(query);

            if (result && result.length > 0) {
                const row = result[0][TABLES.BOT_SETTINGS];
                const settings = {
                    ROWID: row.ROWID,
                    bot_type: row.bot_type,
                    introduction: row.introduction,
                    dos: typeof row.dos === 'string' ? JSON.parse(row.dos) : row.dos,
                    donts: typeof row.donts === 'string' ? JSON.parse(row.donts) : row.donts,
                    word_limit: row.word_limit,
                    n_results: row.n_results
                };
                cache.botSettings.set(botType, settings);
                cache.lastFetch.botSettings[botType] = now;
                return settings;
            }
        } else {
            // File-based fallback
            const records = readTable(TABLES.BOT_SETTINGS);
            const found = records.find(r => r.bot_type === botType);
            if (found) {
                const settings = {
                    ...found,
                    dos: typeof found.dos === 'string' ? JSON.parse(found.dos) : found.dos,
                    donts: typeof found.donts === 'string' ? JSON.parse(found.donts) : found.donts
                };
                cache.botSettings.set(botType, settings);
                cache.lastFetch.botSettings[botType] = now;
                return settings;
            }
        }
    } catch (error) {
        console.error(`Error fetching ${botType} settings:`, error.message);
    }

    // Return defaults if not found
    return DEFAULT_SETTINGS[botType] || DEFAULT_SETTINGS.website;
}

export async function saveBotSettings(botType, settings) {
    try {
        const dataToSave = {
            bot_type: botType,
            introduction: settings.introduction || '',
            dos: JSON.stringify(settings.dos || []),
            donts: JSON.stringify(settings.donts || []),
            word_limit: parseInt(settings.word_limit) || 100,
            n_results: parseInt(settings.n_results) || 2
        };

        const table = await getTable(TABLES.BOT_SETTINGS);

        if (table) {
            // Check if exists using ZCQL
            const query = `SELECT ROWID FROM ${TABLES.BOT_SETTINGS} WHERE bot_type = '${botType}'`;
            const existing = await executeQuery(query);

            if (existing && existing.length > 0) {
                // Update existing row
                const rowId = existing[0][TABLES.BOT_SETTINGS].ROWID;
                console.log(`📝 Updating existing row ${rowId} for ${botType}`);
                await table.updateRow({ ROWID: rowId, ...dataToSave });
            } else {
                // Insert new row
                console.log(`➕ Inserting new row for ${botType}`);
                await table.insertRow(dataToSave);
            }
        } else {
            // File-based fallback
            let records = readTable(TABLES.BOT_SETTINGS);
            const idx = records.findIndex(r => r.bot_type === botType);
            if (idx >= 0) {
                records[idx] = { ...records[idx], ...dataToSave, MODIFIEDTIME: new Date().toISOString() };
            } else {
                records.push({ ...dataToSave, ROWID: Date.now().toString(), CREATEDTIME: new Date().toISOString() });
            }
            writeTable(TABLES.BOT_SETTINGS, records);
        }

        // Immediately invalidate and refresh cache
        cache.botSettings.delete(botType);
        delete cache.lastFetch.botSettings[botType];

        // Re-fetch fresh data to ensure cache is in sync with DB
        const freshData = await getBotSettings(botType);
        console.log(`🔄 Cache refreshed for ${botType} settings`);

        return { success: true, data: freshData };
    } catch (error) {
        console.error(`Error saving ${botType} settings:`, error.message);
        throw error;
    }
}



export async function deleteBotSettings(botType) {
    try {
        const table = await getTable(TABLES.BOT_SETTINGS);

        if (table) {
            const query = `SELECT ROWID FROM ${TABLES.BOT_SETTINGS} WHERE bot_type = '${botType}'`;
            const existing = await executeQuery(query);

            if (existing && existing.length > 0) {
                const rowId = existing[0][TABLES.BOT_SETTINGS].ROWID;
                await table.deleteRow(rowId);
            }
        } else {
            // File-based fallback
            let records = readTable(TABLES.BOT_SETTINGS);
            records = records.filter(r => r.bot_type !== botType);
            writeTable(TABLES.BOT_SETTINGS, records);
        }

        cache.botSettings.delete(botType);
        return { success: true };
    } catch (error) {
        console.error(`Error deleting ${botType} settings:`, error.message);
        throw error;
    }
}


export function getDefaultSettings(botType) {
    return DEFAULT_SETTINGS[botType] || DEFAULT_SETTINGS.website;
}

// ================================================================
// CACHE MANAGEMENT
// ================================================================

// Preload all bot settings into cache at startup
export async function warmCache() {
    if (cache.initialized) return;

    console.log('🔥 Warming settings cache...');
    const botTypes = ['website', 'instagram', 'whatsapp'];

    for (const botType of botTypes) {
        try {
            const settings = await getBotSettings(botType);
            cache.botSettings.set(botType, settings);
            cache.lastFetch.botSettings[botType] = Date.now();
            console.log(`  ✓ Loaded ${botType} settings`);
        } catch (error) {
            // Use defaults on error
            cache.botSettings.set(botType, DEFAULT_SETTINGS[botType]);
            cache.lastFetch.botSettings[botType] = Date.now();
            console.log(`  ⚠️ Using default ${botType} settings (error: ${error.message})`);
        }
    }

    cache.initialized = true;
    console.log('✅ Settings cache warmed');
}

// Force refresh cache (call after external updates)
export function invalidateCache(type = 'all') {
    if (type === 'all' || type === 'botSettings') {
        cache.botSettings.clear();
        cache.lastFetch.botSettings = {};
    }
    if (type === 'all' || type === 'chromaConfigs') {
        cache.chromaConfigs = null;
        cache.activeChromaConfig = null;
        cache.lastFetch.chromaConfigs = 0;
    }
}

// Get cache status (for debugging)
export function getCacheStatus() {
    return {
        initialized: cache.initialized,
        botSettingsCount: cache.botSettings.size,
        chromaConfigsCached: cache.chromaConfigs !== null,
        ttl: cache.TTL,
        chromaTtl: cache.CHROMA_TTL
    };
}

// ================================================================
// CHROMA CONFIG API
// ================================================================

export async function getAllChromaConfigs() {
    const now = Date.now();
    if (cache.chromaConfigs && (now - cache.lastFetch.chromaConfigs) < cache.CHROMA_TTL) {
        return cache.chromaConfigs;
    }

    try {
        const table = await getTable(TABLES.CHROMA_CONFIGS);

        if (table) {
            const result = await table.getAllRows();
            cache.chromaConfigs = Array.isArray(result) ? result : [];
        } else {
            // File-based fallback
            cache.chromaConfigs = readTable(TABLES.CHROMA_CONFIGS);
        }

        cache.lastFetch.chromaConfigs = now;
        return cache.chromaConfigs;
    } catch (error) {
        console.error('Error fetching Chroma configs:', error.message);
        return [];
    }
}

export async function getChromaConfig(configId) {
    try {
        const table = await getTable(TABLES.CHROMA_CONFIGS);

        if (table) {
            return await table.getRow(configId);
        } else {
            // File-based fallback
            const records = readTable(TABLES.CHROMA_CONFIGS);
            return records.find(r => r.ROWID === configId) || null;
        }
    } catch (error) {
        console.error('Error fetching Chroma config:', error.message);
        return null;
    }
}

export async function getActiveChromaConfig() {
    const configs = await getAllChromaConfigs();
    return configs.find(c => c.is_active) || null;
}

export async function saveChromaConfig(configData) {
    try {
        const table = await getTable(TABLES.CHROMA_CONFIGS);

        if (table) {
            const result = await table.insertRow({
                ...configData,
                is_active: false,
                active_collection: null
            });
            cache.chromaConfigs = null; // Invalidate cache
            return result;
        } else {
            // File-based fallback
            const records = readTable(TABLES.CHROMA_CONFIGS);
            const newRecord = {
                ...configData,
                ROWID: Date.now().toString(),
                CREATEDTIME: new Date().toISOString(),
                is_active: false,
                active_collection: null
            };
            records.push(newRecord);
            writeTable(TABLES.CHROMA_CONFIGS, records);
            cache.chromaConfigs = null;
            return newRecord;
        }
    } catch (error) {
        console.error('Error saving Chroma config:', error.message);
        throw error;
    }
}

export async function updateChromaConfig(configId, configData) {
    try {
        const table = await getTable(TABLES.CHROMA_CONFIGS);

        if (table) {
            const result = await table.updateRow({ ROWID: configId, ...configData });
            cache.chromaConfigs = null;
            return result;
        } else {
            // File-based fallback
            let records = readTable(TABLES.CHROMA_CONFIGS);
            const idx = records.findIndex(r => r.ROWID === configId);
            if (idx >= 0) {
                records[idx] = { ...records[idx], ...configData, MODIFIEDTIME: new Date().toISOString() };
                writeTable(TABLES.CHROMA_CONFIGS, records);
                cache.chromaConfigs = null;
                return records[idx];
            }
            return null;
        }
    } catch (error) {
        console.error('Error updating Chroma config:', error.message);
        throw error;
    }
}

export async function deleteChromaConfig(configId) {
    try {
        const table = await getTable(TABLES.CHROMA_CONFIGS);

        if (table) {
            await table.deleteRow(configId);
        } else {
            // File-based fallback
            let records = readTable(TABLES.CHROMA_CONFIGS);
            records = records.filter(r => r.ROWID !== configId);
            writeTable(TABLES.CHROMA_CONFIGS, records);
        }

        cache.chromaConfigs = null;
        return { success: true };
    } catch (error) {
        console.error('Error deleting Chroma config:', error.message);
        throw error;
    }
}

export async function activateChromaConfig(configId, collectionName) {
    try {
        // Deactivate all configs first
        const configs = await getAllChromaConfigs();
        for (const config of configs) {
            if (config.is_active) {
                await updateChromaConfig(config.ROWID, { is_active: false });
            }
        }

        // Activate the selected config
        const result = await updateChromaConfig(configId, {
            is_active: true,
            active_collection: collectionName
        });

        cache.chromaConfigs = null;
        return result;
    } catch (error) {
        console.error('Error activating Chroma config:', error.message);
        throw error;
    }
}

// ================================================================
// PROMPT BUILDER
// ================================================================

export function buildPrompt(settings, context, userMessage, conversationHistory = "") {
    const { introduction, dos, donts, word_limit } = settings;

    const dosText = Array.isArray(dos) ? dos.map((d, i) => `${i + 1}. ${d}`).join('\n') : '';
    const dontsText = Array.isArray(donts) ? donts.map((d, i) => `${i + 1}. ${d}`).join('\n') : '';

    return `${introduction}

CONTEXT FROM KNOWLEDGE BASE:
${context || 'No relevant context found.'}

CONVERSATION HISTORY:
${conversationHistory || 'None'}

USER MESSAGE:
${userMessage}

GUIDELINES - DO:
${dosText}

GUIDELINES - DON'T:
${dontsText}

Keep your response under ${word_limit} words.`;
}
