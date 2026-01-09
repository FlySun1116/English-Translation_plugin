const TODAY_LIMIT = 100;
const HISTORY_LIMIT = 50;
const VIEW = { TODAY: 'today', HISTORY: 'history' };
let currentView = VIEW.TODAY;

const listEl = document.getElementById('list');
const chartView = document.getElementById('chartView');
const listTitle = document.getElementById('listTitle');
const todayBtn = document.getElementById('todayBtn');
const historyBtn = document.getElementById('historyBtn');
const searchInput = document.getElementById('searchInput');

Chart.defaults.font.family = '"Space Grotesk", "IBM Plex Sans", "Segoe UI", sans-serif';

const sendToContent = (action) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action });
    });
};

document.getElementById('highlightBtn').onclick = () => sendToContent("TRIGGER_HIGHLIGHT");
document.getElementById('removeBtn').onclick = () => sendToContent("REMOVE_HIGHLIGHT");
document.getElementById('closeChart').onclick = () => { chartView.style.display = 'none'; };
document.getElementById('showChartBtn').onclick = () => {
    chartView.style.display = 'flex';
    renderTrend();
};
todayBtn.onclick = () => setView(VIEW.TODAY);
historyBtn.onclick = () => setView(VIEW.HISTORY);
searchInput.oninput = () => renderList();

const getLocalDate = (d) => d.toLocaleDateString('en-CA');
const collectWordEntries = (data) => Object.entries(data)
    .filter(([, value]) => value && typeof value.count === 'number')
    .map(([word, value]) => ({ word, ...value }));

function setView(view) {
    currentView = view;
    todayBtn.classList.toggle('active', view === VIEW.TODAY);
    historyBtn.classList.toggle('active', view === VIEW.HISTORY);
    renderList();
}

function renderList() {
    listEl.innerHTML = '<div class="empty">加载中...</div>';
    chrome.storage.local.get(null, (data) => {
        const entries = collectWordEntries(data);
        const todayKey = getLocalDate(new Date());
        const query = searchInput.value.trim().toLowerCase();

        let baseList = [];
        let titleText = '';
        let emptyText = '';

        if (currentView === VIEW.TODAY) {
            baseList = entries
                .map(item => ({ ...item, todayCount: item.stats?.[todayKey] || 0 }))
                .filter(item => item.todayCount > 0)
                .sort((a, b) => b.todayCount - a.todayCount);
            titleText = '今日查询';
            emptyText = '今天还没有查询记录';
        } else {
            baseList = entries
                .sort((a, b) => b.count - a.count);
            titleText = '历史次数榜';
            emptyText = '暂无历史记录';
        }

        let filtered = baseList;
        if (query) {
            filtered = baseList.filter(item => item.word.toLowerCase().includes(query));
            titleText = filtered.length ? `搜索结果 (${filtered.length})` : '未找到相关单词';
            emptyText = '未找到相关单词';
        }

        const limit = currentView === VIEW.TODAY ? TODAY_LIMIT : HISTORY_LIMIT;
        const list = filtered.slice(0, limit);

        listTitle.textContent = titleText;

        if (!list.length) {
            listEl.innerHTML = `<div class="empty">${emptyText}</div>`;
            return;
        }

        listEl.textContent = '';
        const fragment = document.createDocumentFragment();

        list.forEach((item, i) => {
            const countLabel = currentView === VIEW.TODAY
                ? `${item.todayCount} 次今日`
                : `${item.count} 次总计`;

            const wrap = document.createElement('div');
            wrap.className = 'word-item';
            wrap.style.setProperty('--delay', `${i * 40}ms`);
            wrap.dataset.word = item.word;

            const meaning = document.createElement('div');
            meaning.className = 'meaning-tag';
            meaning.textContent = item.translation || '...';

            const main = document.createElement('div');
            main.className = 'word-main';
            main.textContent = item.word;

            const meta = document.createElement('div');
            meta.className = 'word-meta';

            const countSpan = document.createElement('span');
            countSpan.textContent = countLabel;

            const del = document.createElement('span');
            del.className = 'del-btn';
            del.dataset.word = item.word;
            del.textContent = '×';

            meta.appendChild(countSpan);
            meta.appendChild(del);

            wrap.appendChild(meaning);
            wrap.appendChild(main);
            wrap.appendChild(meta);

            fragment.appendChild(wrap);
        });

        listEl.appendChild(fragment);

        document.querySelectorAll('.word-item').forEach(el => {
            el.onclick = function(e) {
                if (e.target.classList.contains('del-btn')) return;
                const tag = this.querySelector('.meaning-tag');
                const isVisible = tag.style.display === 'block';
                document.querySelectorAll('.meaning-tag').forEach(t => t.style.display = 'none');
                tag.style.display = isVisible ? 'none' : 'block';
            };
        });

        document.querySelectorAll('.del-btn').forEach(b => {
            b.onclick = (e) => {
                e.stopPropagation();
                chrome.storage.local.remove(b.dataset.word, renderList);
            };
        });
    });
}

let myChart = null;
async function renderTrend() {
    const data = await chrome.storage.local.get(null);
    const daily = {};
    const todayStr = getLocalDate(new Date());

    collectWordEntries(data).forEach(it => {
        if (it.stats) {
            Object.entries(it.stats).forEach(([d, c]) => {
                daily[d] = (daily[d] || 0) + c;
            });
        } else {
            daily[todayStr] = (daily[todayStr] || 0) + it.count;
        }
    });

    const labels = [];
    const values = [];
    for (let i = -5; i <= 5; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const key = getLocalDate(d);
        labels.push(i === 0 ? "今日" : key.slice(5));
        values.push(daily[key] || 0);
    }

    const ctx = document.getElementById('lineChart').getContext('2d');
    if (myChart) myChart.destroy();
    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data: values,
                borderColor: '#007acc',
                backgroundColor: 'rgba(0,122,204,0.12)',
                pointRadius: 3,
                pointBackgroundColor: '#007acc',
                tension: 0.35,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false } },
                y: { grid: { color: 'rgba(0, 0, 0, 0.06)' }, ticks: { precision: 0 } }
            }
        }
    });
}

document.addEventListener('click', (event) => {
    if (!event.target.closest('.word-item')) {
        document.querySelectorAll('.meaning-tag').forEach(t => t.style.display = 'none');
    }
});

setView(VIEW.TODAY);
