/* ==========================================================================
   书循环 · 前端交互
   ========================================================================== */

(function () {
  'use strict';

  /* ---------------------------------------------------------------- 状态 */
  const state = {
    q: '',
    category: '全部',
    sort: 'recommend',
    books: [],
    counts: {},
    detail: null,
    buyBook: null,
    loading: false,
    error: null,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const grid = $('#bookGrid');
  const emptyState = $('#emptyState');
  const resultCount = $('#resultCount');
  const chips = $('#categoryChips');
  const sortSelect = $('#sortSelect');
  const searchInput = $('#searchInput');
  const toastEl = $('#toast');

  /* ---------------------------------------------------------------- 工具 */
  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function money(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return '0';
    return Number.isInteger(num) ? String(num) : num.toFixed(2);
  }

  function avatarColor(name) {
    const palette = ['#0f6b52', '#2a5d8f', '#b4761d', '#7a4b8f', '#a8452f', '#3f6b4a'];
    let hash = 0;
    for (let i = 0; i < String(name).length; i += 1) {
      hash = (hash * 31 + String(name).charCodeAt(i)) % 9973;
    }
    return palette[hash % palette.length];
  }

  function initial(name) {
    const str = String(name || '?').trim();
    return str.slice(0, 1).toUpperCase();
  }

  let toastTimer = null;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => { toastEl.hidden = true; }, 260);
    }, 2600);
  }

  async function api(path, options) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    let payload = null;
    try {
      payload = await res.json();
    } catch (err) {
      payload = { ok: false, message: '服务器返回异常' };
    }
    if (!res.ok || payload.ok === false) {
      const error = new Error(payload.message || `请求失败（${res.status}）`);
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  /* ---------------------------------------------------------------- 渲染卡片 */
  function cardHTML(book) {
    const reserved = book.status === '已预订';
    const saved = book.originalPrice ? Math.round((1 - book.price / book.originalPrice) * 100) : 0;

    return `
      <article class="card ${reserved ? 'is-reserved' : ''}" data-id="${esc(book.id)}">
        <div class="card-cover cat-${esc(book.category)}">
          <span class="cover-spine"></span>
          <span class="cover-emoji">${esc(book.icon || '📚')}</span>
          ${book.wantCount > 0 ? `<span class="tag-want">🔥 ${book.wantCount} 人求购</span>` : ''}
          ${reserved
            ? '<span class="ribbon reserved">已预订</span>'
            : (saved >= 55 ? `<span class="ribbon">省 ${saved}%</span>` : '')}
        </div>

        <div class="card-body">
          <div class="card-kicker">
            <span class="cat">${esc(book.category)}</span>
            <span class="cond">${esc(book.condition)}</span>
          </div>

          <h3 class="card-title">${esc(book.title)}</h3>

          <p class="card-course">
            <span>📖 ${esc(book.subject)}</span>
            ${book.course && book.course !== book.subject ? `<span class="dot"></span><span>${esc(book.course)}</span>` : ''}
          </p>

          <p class="card-note">${esc(book.note || '卖家没有留下补充说明')}</p>

          <div class="card-foot">
            <div class="seller">
              <span class="avatar" style="background:${avatarColor(book.seller?.name || '')}">${esc(initial(book.seller?.name))}</span>
              <span class="seller-meta">
                <b>${esc(book.seller?.grade || '在校生')} · ${esc(book.seller?.name || '同学')}</b>
                <span>${esc(book.campus || '校内自提')}</span>
              </span>
            </div>
            <div class="price-block">
              <div class="price"><span class="cur">¥</span>${money(book.price)}</div>
              ${book.originalPrice ? `<div class="price-old">¥${money(book.originalPrice)}</div>` : ''}
            </div>
          </div>
        </div>

        <div class="card-actions">
          <button class="btn btn-detail" data-action="detail" data-id="${esc(book.id)}">详情</button>
          <button class="btn btn-buy" data-action="buy" data-id="${esc(book.id)}" ${reserved ? 'disabled' : ''}>
            ${reserved ? '已被预订' : '💳 购买'}
          </button>
        </div>
      </article>
    `;
  }

  function renderSkeleton() {
    grid.innerHTML = Array.from({ length: 6 })
      .map(() => '<div class="skeleton"></div>')
      .join('');
    emptyState.hidden = true;
  }

  function renderList() {
    if (state.loading) return;

    if (state.error) {
      grid.innerHTML = '';
      emptyState.hidden = false;
      $('.empty h3').textContent = '加载失败';
      $('.empty p').textContent = state.error;
      resultCount.textContent = '加载失败';
      return;
    }

    if (!state.books.length) {
      grid.innerHTML = '';
      emptyState.hidden = false;
      $('.empty h3').textContent = '没找到这本书';
      $('.empty p').textContent = '换个关键词试试，或者直接发布一条求购，让有书的同学看到你。';
      resultCount.textContent = '共 0 本';
      return;
    }

    emptyState.hidden = true;
    grid.innerHTML = state.books.map(cardHTML).join('');
    resultCount.textContent = `共 ${state.books.length} 本在售`;
  }

  function renderChips() {
    $$('.chip', chips).forEach((chip) => {
      const cat = chip.dataset.category;
      const count = state.counts[cat];
      const label = cat === '全部' ? '全部' : cat;
      chip.innerHTML = `${label}${count != null ? `<span class="count">${count}</span>` : ''}`;
      chip.classList.toggle('active', state.category === cat);
    });
  }

  async function renderStats() {
    try {
      const { data } = await api('/api/stats');
      $('#statOnSale').textContent = data.onSale;
      $('#statSaved').textContent = data.saved;
      $('#statOrders').textContent = data.orders;
    } catch (err) {
      /* 统计失败不影响主流程 */
    }
  }

  async function renderOrders() {
    const list = $('#orderList');
    try {
      const { data } = await api('/api/orders?limit=6');
      if (!data.length) {
        list.innerHTML = '<li class="order-empty">还没有预订记录，做第一个吧。</li>';
        return;
      }
      list.innerHTML = data
        .map(
          (o) => `
          <li class="order-item">
            <span class="od-mark">📗</span>
            <span class="od-main">
              <b>${esc(o.bookTitle)}</b>
              <span>${esc(o.buyerName)} · ${esc(o.buyerContact)} · ${esc(o.orderNo)}</span>
            </span>
            <span class="od-status">${esc(o.status)}</span>
          </li>`
        )
        .join('');
    } catch (err) {
      list.innerHTML = '<li class="order-empty">动态加载失败</li>';
    }
  }

  /* ---------------------------------------------------------------- 拉数据 */
  async function loadBooks() {
    state.loading = true;
    renderSkeleton();

    const params = new URLSearchParams({
      q: state.q,
      category: state.category,
      sort: state.sort,
    });

    try {
      const { data, counts } = await api(`/api/books?${params.toString()}`);
      state.books = data;
      state.counts = counts || {};
      state.error = null;
      renderChips();
    } catch (err) {
      state.books = [];
      state.error = err.message;
    } finally {
      state.loading = false;
      renderList();
    }
  }

  /* ---------------------------------------------------------------- 详情 */
  const detailModal = $('#detailModal');
  const detailBody = $('#detailBody');

  function openModal(el) {
    el.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal(el) {
    el.hidden = true;
    if (!$$('.modal').some((m) => !m.hidden)) {
      document.body.style.overflow = '';
    }
  }

  async function openDetail(id) {
    openModal(detailModal);
    detailBody.innerHTML = '<p class="muted" style="padding:30px">正在打开…</p>';

    try {
      const { data: book, related } = await api(`/api/books/${encodeURIComponent(id)}`);
      state.detail = book;
      const reserved = book.status === '已预订';
      const saved = book.originalPrice ? Math.round(book.originalPrice - book.price) : 0;
      const off = book.originalPrice ? Math.round((1 - book.price / book.originalPrice) * 100) : 0;

      detailBody.innerHTML = `
        <div class="detail-cover cat-${esc(book.category)}">
          <span class="cover-spine"></span>
          <span class="cover-emoji">${esc(book.icon || '📚')}</span>
        </div>

        <div class="detail-info">
          <h2>${esc(book.title)}</h2>

          <div class="detail-tags">
            <span class="tag green">${esc(book.category)}</span>
            <span class="tag">${esc(book.condition)}</span>
            ${book.wantCount ? `<span class="tag price-tag">🔥 ${book.wantCount} 人求购</span>` : ''}
            ${reserved ? '<span class="tag">已预订</span>' : '<span class="tag green">在售</span>'}
          </div>

          <dl class="detail-rows">
            <div class="detail-row"><dt>课程</dt><dd>${esc(book.subject)}</dd></div>
            ${book.course ? `<div class="detail-row"><dt>班级</dt><dd>${esc(book.course)}</dd></div>` : ''}
            <div class="detail-row"><dt>取书</dt><dd>${esc(book.campus || '校内自提')}</dd></div>
            <div class="detail-row"><dt>说明</dt><dd>${esc(book.note || '暂无补充说明')}</dd></div>
          </dl>

          <div class="detail-price">
            <span class="price"><span class="cur">¥</span>${money(book.price)}</span>
            ${book.originalPrice ? `<span class="price-old" style="font-size:13px">原价 ¥${money(book.originalPrice)}</span>` : ''}
            ${saved > 0 ? `<span class="save">省 ¥${money(saved)}${off > 0 ? ` · ${off}% off` : ''}</span>` : ''}
          </div>

          <div class="detail-seller">
            <span class="avatar" style="background:${avatarColor(book.seller?.name || '')}">${esc(initial(book.seller?.name))}</span>
            <span class="seller-meta">
              <b>${esc(book.seller?.grade || '在校生')} · ${esc(book.seller?.name || '同学')}</b>
              <span>${esc(book.seller?.contact || '站内留言联系')}</span>
            </span>
          </div>

          <div class="detail-actions">
            <button class="btn btn-ghost" data-action="want" data-id="${esc(book.id)}">我也想要</button>
            <button class="btn btn-primary" data-action="buy" data-id="${esc(book.id)}" ${reserved ? 'disabled' : ''}>
              ${reserved ? '已被预订' : '💳 立即预订'}
            </button>
          </div>
        </div>

        ${related && related.length ? `
          <div class="related">
            <h4>同分类的其他书</h4>
            <div class="related-grid">
              ${related.map((r) => `
                <button class="related-item" data-action="detail" data-id="${esc(r.id)}">
                  <b>${esc(r.title)}</b>
                  <span>¥${money(r.price)} · ${esc(r.condition)}</span>
                </button>`).join('')}
            </div>
          </div>` : ''}
      `;
    } catch (err) {
      detailBody.innerHTML = `<p class="muted" style="padding:30px">${esc(err.message)}</p>`;
    }
  }

  /* ---------------------------------------------------------------- 下单 */
  const buyModal = $('#buyModal');
  const buyForm = $('#buyForm');
  const buyFormWrap = $('#buyFormWrap');
  const buySuccess = $('#buySuccess');
  const buyError = $('#buyError');

  function openBuy(book) {
    state.buyBook = book;
    buyForm.reset();
    buyFormWrap.hidden = false;
    buySuccess.hidden = true;
    buyError.hidden = true;
    $('#buyBookId').value = book.id;
    $('#buyTitle').textContent = '预订这本书';
    $('#buySubtitle').textContent = `${book.title} · ¥${money(book.price)}`;
    openModal(buyModal);
    setTimeout(() => buyForm.querySelector('input[name="buyerName"]').focus(), 120);
  }

  buyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = $('#buySubmit');
    const formData = new FormData(buyForm);
    const payload = Object.fromEntries(formData.entries());

    buyError.hidden = true;
    submit.disabled = true;
    submit.textContent = '提交中…';

    try {
      const { data } = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      buyFormWrap.hidden = true;
      buySuccess.hidden = false;
      $('#buyTitle').textContent = '预订成功';
      $('#buySubtitle').textContent = '把订单号发给卖家，约个时间当面验书。';

      buySuccess.innerHTML = `
        <div class="success">
          <div class="success-icon">✓</div>
          <h3>已经帮你留住了</h3>
          <p>卖家确认后会通过你留的方式联系你。</p>
          <div class="order-box">
            <div class="row"><span>订单号</span><span class="order-no">${esc(data.orderNo)}</span></div>
            <div class="row"><span>书名</span><span>${esc(data.bookTitle)}</span></div>
            <div class="row"><span>金额</span><span>¥${money(data.price)}（当面支付）</span></div>
            <div class="row"><span>卖家</span><span>${esc(data.sellerName || '同学')}</span></div>
            <div class="row"><span>状态</span><span>${esc(data.status)}</span></div>
          </div>
          <button class="btn btn-primary btn-block" data-close="buy">知道了</button>
        </div>
      `;

      toast('预订成功，这本书已经为你留住');
      closeModal(detailModal);
      loadBooks();
      renderStats();
      renderOrders();
    } catch (err) {
      buyError.textContent = err.message;
      buyError.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = '确认预订';
    }
  });

  /* ---------------------------------------------------------------- 发布 */
  const publishModal = $('#publishModal');
  const publishForm = $('#publishForm');
  const publishError = $('#publishError');

  $('#btnOpenPublish').addEventListener('click', () => {
    publishForm.reset();
    publishError.hidden = true;
    openModal(publishModal);
  });

  publishForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = $('#publishSubmit');
    const payload = Object.fromEntries(new FormData(publishForm).entries());

    publishError.hidden = true;
    submit.disabled = true;
    submit.textContent = '发布中…';

    try {
      const { data } = await api('/api/books', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      closeModal(publishModal);
      toast(`「${data.title}」已发布`);
      state.category = '全部';
      state.q = '';
      searchInput.value = '';
      sortSelect.value = 'recommend';
      state.sort = 'recommend';
      await loadBooks();
      renderStats();
    } catch (err) {
      publishError.textContent = err.message;
      publishError.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = '发布到首页';
    }
  });

  /* ---------------------------------------------------------------- 事件委托 */
  document.addEventListener('click', async (event) => {
    const closeTarget = event.target.closest('[data-close]');
    if (closeTarget) {
      const name = closeTarget.dataset.close;
      const map = { detail: detailModal, buy: buyModal, publish: publishModal };
      if (map[name]) closeModal(map[name]);
      return;
    }

    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    const id = actionEl.dataset.id;

    if (action === 'detail') {
      openDetail(id);
      return;
    }

    if (action === 'buy') {
      if (state.detail && state.detail.id === id) {
        openBuy(state.detail);
        return;
      }
      const cached = state.books.find((b) => b.id === id);
      if (cached) {
        openBuy(cached);
      } else {
        try {
          const { data } = await api(`/api/books/${encodeURIComponent(id)}`);
          openBuy(data);
        } catch (err) {
          toast(err.message);
        }
      }
      return;
    }

    if (action === 'want') {
      try {
        const { data } = await api(`/api/books/${encodeURIComponent(id)}/want`, { method: 'POST' });
        toast(`已记录，这本书现在有 ${data.wantCount} 人想要`);
        if (state.detail) state.detail.wantCount = data.wantCount;
        loadBooks();
      } catch (err) {
        toast(err.message);
      }
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      $$('.modal').forEach((m) => { if (!m.hidden) closeModal(m); });
    }
  });

  /* ---------------------------------------------------------------- 筛选交互 */
  chips.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    state.category = chip.dataset.category;
    loadBooks();
  });

  sortSelect.addEventListener('change', () => {
    state.sort = sortSelect.value;
    loadBooks();
  });

  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = searchInput.value.trim();
      loadBooks();
    }, 260);
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      clearTimeout(searchTimer);
      state.q = searchInput.value.trim();
      loadBooks();
      document.getElementById('list').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  $('#btnSearch').addEventListener('click', () => {
    state.q = searchInput.value.trim();
    loadBooks();
    document.getElementById('list').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#btnResetFilter').addEventListener('click', () => {
    state.q = '';
    state.category = '全部';
    state.sort = 'recommend';
    searchInput.value = '';
    sortSelect.value = 'recommend';
    loadBooks();
  });

  $('#btnReset').addEventListener('click', async () => {
    if (!window.confirm('确定把示例数据恢复成初始状态吗？新增的书和订单会被清空。')) return;
    try {
      await api('/api/admin/reset', { method: 'POST' });
      toast('示例数据已重置');
      await Promise.all([loadBooks(), renderStats(), renderOrders()]);
    } catch (err) {
      toast(err.message);
    }
  });

  /* ---------------------------------------------------------------- 启动 */
  loadBooks();
  renderStats();
  renderOrders();
})();
