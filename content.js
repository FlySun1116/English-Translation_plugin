chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "GET_SELECTION") {
        const selected = window.getSelection().toString().trim();

        if (selected && /^[a-zA-Z\s-]+$/.test(selected)) {
            chrome.runtime.sendMessage({ action: "PROCESS_WORD", data: { word: selected } });
        }
    }

    if (message.action === "SHOW_RESULT") {
        showFloatingPanel(message.word, message.data);
    }

    if (message.action === "TRIGGER_HIGHLIGHT") {
        highlightWords();
    }

    if (message.action === "REMOVE_HIGHLIGHT") {
        removeHighlights();
    }
});

function showFloatingPanel(word, data) {
    let panel = document.getElementById('sun-helper-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'sun-helper-panel';
        document.body.appendChild(panel);
    }
    
    const lookupCount = Number.isFinite(data?.count) ? data.count : 1;
    const translationText = data?.translation || '...';

    panel.replaceChildren();

    const inner = document.createElement('div');
    inner.className = 'sun-inner';

    const header = document.createElement('div');
    header.className = 'sun-header';

    const strong = document.createElement('strong');
    strong.textContent = word;

    const countTag = document.createElement('span');
    countTag.className = 'sun-count-tag';
    countTag.textContent = `第 ${lookupCount} 次查阅`;

    header.appendChild(strong);
    header.appendChild(countTag);

    const body = document.createElement('div');
    body.className = 'sun-body';
    body.textContent = translationText;

    inner.appendChild(header);
    inner.appendChild(body);

    panel.appendChild(inner);
    panel.style.display = 'block';
    
    if (panel.hideTimer) clearTimeout(panel.hideTimer);
    panel.hideTimer = setTimeout(() => { panel.style.display = 'none'; }, 4000);
}

const MAX_TEXT_NODES = 5000;

function highlightWords() {
    chrome.storage.local.get(null, (allData) => {
        const entries = Object.entries(allData).filter(([, value]) => value && typeof value.count === 'number');
        const words = entries.map(([key]) => key);
        if (words.length === 0) return;

        const dataMap = entries.reduce((acc, [key, value]) => {
            acc[key.toLowerCase()] = value;
            return acc;
        }, {});

        const escapeRegExp = (input) => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedWords = words.map((word) => escapeRegExp(word)).sort((a, b) => b.length - a.length);
        const regex = new RegExp(`(?<![A-Za-z0-9_])(${escapedWords.join('|')})(?![A-Za-z0-9_])`, 'gi');
        
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                if (parent.closest && parent.closest('#sun-helper-panel')) return NodeFilter.FILTER_REJECT;
                if (parent.closest && parent.closest('.sun-highlight-mark')) return NodeFilter.FILTER_REJECT;
                if (['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT'].includes(parent.tagName)) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        }, false);
        const nodesToReplace = [];

        let node;
        let visited = 0;
        while ((node = walker.nextNode())) {
            visited += 1;
            if (visited > MAX_TEXT_NODES) break;
            regex.lastIndex = 0;
            if (regex.test(node.nodeValue)) {
                nodesToReplace.push(node);
            }
        }

        const fragmentOps = nodesToReplace.map(node => {
            const text = node.nodeValue;
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            regex.lastIndex = 0;

            let match;
            while ((match = regex.exec(text)) !== null) {
                if (match.index > lastIndex) {
                    fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
                }

                const raw = match[0];
                const normalized = raw.toLowerCase();
                const count = dataMap[normalized]?.count ?? 0;

                const mark = document.createElement('mark');
                mark.className = 'sun-highlight-mark';
                mark.dataset.original = raw;
                mark.appendChild(document.createTextNode(raw));

                const sub = document.createElement('sub');
                sub.className = 'sun-sub';
                sub.textContent = count.toString();
                mark.appendChild(sub);

                fragment.appendChild(mark);
                lastIndex = match.index + raw.length;
            }

            if (lastIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
            }

            return { parent: node.parentNode, fragment, node };
        });

        if (fragmentOps.length) {
            requestAnimationFrame(() => {
                fragmentOps.forEach(op => {
                    if (op.parent) {
                        op.parent.replaceChild(op.fragment, op.node);
                    }
                });
            });
        }
    });
}


function removeHighlights() {
    document.querySelectorAll('.sun-highlight-mark').forEach(mark => {
        const text = mark.dataset.original || mark.firstChild?.nodeValue || '';
        mark.parentNode.replaceChild(document.createTextNode(text), mark);
    });
}
