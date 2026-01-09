const getLocalDate = (date) => date.toLocaleDateString('en-CA');
const MAX_WORD_LENGTH = 50;
const MIN_WORD_LENGTH = 1;
const WORD_PATTERN = /^[A-Za-z][A-Za-z\s-]*$/;
const CLEANUP_DAYS = 30;
const TRANSLATE_TIMEOUT = 6000;
const MAX_TRANSLATE_RETRY = 2;

const inFlightTranslations = new Map();

const isValidWord = (word) => {
    if (!word || typeof word !== 'string') return false;
    const normalized = word.trim();
    const len = normalized.length;
    if (len < MIN_WORD_LENGTH || len > MAX_WORD_LENGTH) return false;
    return WORD_PATTERN.test(normalized);
};

const fetchJsonWithTimeout = async (url, timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
};

async function translateWord(word) {
    if (inFlightTranslations.has(word)) {
        return inFlightTranslations.get(word);
    }

    const promise = (async () => {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(word)}`;
        for (let attempt = 1; attempt <= MAX_TRANSLATE_RETRY; attempt++) {
            try {
                const result = await fetchJsonWithTimeout(url, TRANSLATE_TIMEOUT);
                return result?.[0]?.[0]?.[0] || "翻译暂不可用";
            } catch (err) {
                if (attempt === MAX_TRANSLATE_RETRY) return "翻译暂不可用";
            }
        }
        return "翻译暂不可用";
    })().finally(() => inFlightTranslations.delete(word));

    inFlightTranslations.set(word, promise);
    return promise;
}

async function cleanupStats() {
    const data = await chrome.storage.local.get(null);
    const cutoff = Date.now() - CLEANUP_DAYS * 24 * 60 * 60 * 1000;
    const updates = {};
    let dirty = false;

    Object.entries(data).forEach(([key, value]) => {
        if (!value || !value.stats) return;
        const freshStats = {};
        Object.entries(value.stats).forEach(([date, count]) => {
            const time = new Date(date).getTime();
            if (!Number.isNaN(time) && time >= cutoff) {
                freshStats[date] = count;
            }
        });
        if (Object.keys(freshStats).length !== Object.keys(value.stats).length) {
            dirty = true;
            updates[key] = { ...value, stats: freshStats };
        }
    });

    if (dirty) {
        await chrome.storage.local.set(updates);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "PROCESS_WORD") {
        (async () => {
            const rawWord = (request.data?.word || "").trim();
            if (!isValidWord(rawWord)) {
                return;
            }

            const word = rawWord.toLowerCase();
            const result = await chrome.storage.local.get([word]);

            let wordData = result[word] || { count: 0, translation: "", stats: {}, lastSeen: "", lastUrl: "" };
            wordData.stats = wordData.stats || {};

            const today = getLocalDate(new Date()); 
            wordData.stats[today] = (wordData.stats[today] || 0) + 1;

            if (!wordData.translation || wordData.translation === "翻译暂不可用") {
                wordData.translation = await translateWord(word);
            }

            wordData.count += 1;
            wordData.lastSeen = new Date().toLocaleString();
            wordData.lastUrl = sender?.tab?.url || wordData.lastUrl || "";

            await chrome.storage.local.set({ [word]: wordData });

            if (sender?.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, { 
                    action: "SHOW_RESULT", 
                    data: wordData, 
                    word: word 
                });
            }
        })();
        return true;
    }
});


chrome.commands.onCommand.addListener((command) => {
    if (command === "lookup-word") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: "GET_SELECTION" });
        });
    }
});

cleanupStats().catch(() => {});
