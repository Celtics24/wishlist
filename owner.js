// Owner area — login + add/edit/delete + private note.
// All rendering uses textContent (no innerHTML with data) to prevent XSS.
// Session token lives in sessionStorage only (tab-scoped).
(function () {
  var API = 'https://wishlist.y0546367987.workers.dev'; // wishlist worker route prefix added at deploy
  var app = document.getElementById('app');

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function token() { return sessionStorage.getItem('wl_owner_token') || ''; }

  function api(path, method, body) {
    return fetch(API + path, {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'X-Wishlist-Client': '1',
        'Authorization': 'Bearer ' + token()
      },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 401) { sessionStorage.removeItem('wl_owner_token'); renderLogin(); throw new Error('unauthorized'); }
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    });
  }

  function renderLogin() {
    app.textContent = '';
    var card = el('div', 'gate-card');
    card.appendChild(el('h1', 'site-header', 'אזור בעלים'));
    var label = el('label', 'gate-label', 'שם');
    var input = el('input', 'gate-input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.placeholder = 'כתבי את שם מי שהרשימה שלו';
    var err = el('p', 'gate-error', '');
    var btn = el('button', 'gate-submit', 'כניסה');
    function go() {
      err.textContent = '';
      btn.disabled = true;
      fetch(API + '/api/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Wishlist-Client': '1' },
        body: JSON.stringify({ name: input.value })
      }).then(function (r) {
        if (r.status === 429) { err.textContent = 'יותר מדי ניסיונות — נועל ל-15 דקות'; return null; }
        if (r.status === 401) { err.textContent = 'השם לא מתאים לאזור הבעלים. בדקי את האיות ונסי שוב.'; return null; }
        if (!r.ok) { err.textContent = 'שגיאה, נסי שוב'; return null; }
        return r.json();
      }).then(function (data) {
        if (data && data.token) { sessionStorage.setItem('wl_owner_token', data.token); renderList(); }
      }).catch(function () { err.textContent = 'שגיאת רשת'; })
        .finally(function () { btn.disabled = false; });
    }
    btn.addEventListener('click', go);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    var hint = el('p', 'closing', 'הכניסה לפי שם בלבד, בלי סיסמה.');
    card.appendChild(label); card.appendChild(input); card.appendChild(btn); card.appendChild(err); card.appendChild(hint);
    app.appendChild(card);
  }

  function renderList() {
    app.textContent = '';
    Promise.all([api('/api/owner/list', 'GET'), api('/api/owner/profile', 'GET').catch(function () { return { ownerNote: '' }; })])
      .then(function (res) { renderEditor(res[0], res[1]); })
      .catch(function (e) { if (e.message !== 'unauthorized') { app.appendChild(el('p', 'gate-error', 'שגיאה בטעינה')); } });
  }

  function renderEditor(data, profile) {
    app.textContent = '';
    var head = el('div', 'site-header');
    head.appendChild(el('h1', '', 'הרשימה שלי — עריכה'));
    var logout = el('button', 'switch-name', 'יציאה');
    logout.addEventListener('click', function () { sessionStorage.removeItem('wl_owner_token'); renderLogin(); });
    head.appendChild(logout);
    app.appendChild(head);

    // private owner note
    var noteCard = el('div', 'gate-card');
    noteCard.appendChild(el('div', 'gate-label', 'פתק פרטי (רק את רואה)'));
    var note = el('textarea', 'gate-input');
    note.rows = 3; note.value = (profile && profile.ownerNote) || '';
    var saveNote = el('button', 'gate-submit', 'שמירת פתק');
    var noteMsg = el('p', 'gate-error', '');
    saveNote.addEventListener('click', function () {
      api('/api/owner/profile', 'PUT', { ownerNote: note.value })
        .then(function () { noteMsg.textContent = 'נשמר ✓'; })
        .catch(function () { noteMsg.textContent = 'שגיאה'; });
    });
    noteCard.appendChild(note); noteCard.appendChild(saveNote); noteCard.appendChild(noteMsg);
    app.appendChild(noteCard);

    // items
    var items = (data && data.items) || [];
    items.forEach(function (it, idx) {
      var card = el('div', 'gift-card');
      card.appendChild(el('div', 'name', it.name));
      if (it.detail) card.appendChild(el('div', 'sub', it.detail));
      if (it.price) card.appendChild(el('div', 'price', it.price));
      var row = el('div', 'item-actions');
      var del = el('button', 'item-btn', 'מחיקה');
      del.addEventListener('click', function () {
        if (!confirm('למחוק את "' + it.name + '"?')) return;
        items.splice(idx, 1);
        save(items);
      });
      row.appendChild(del);
      card.appendChild(row);
      app.appendChild(card);
    });

    // add new
    var addCard = el('div', 'gate-card');
    addCard.appendChild(el('div', 'gate-label', 'הוספת פריט'));
    var name = el('input', 'gate-input'); name.placeholder = 'שם הפריט';
    var detail = el('input', 'gate-input'); detail.placeholder = 'פרטים (גוון, מידה, מלאי…)';
    var price = el('input', 'gate-input'); price.placeholder = 'מחיר (למשל ₪79.90)';
    var url = el('input', 'gate-input'); url.placeholder = 'קישור';
    var addMsg = el('p', 'gate-error', '');
    var addBtn = el('button', 'gate-submit', 'הוספה');
    addBtn.addEventListener('click', function () {
      if (!name.value.trim()) { addMsg.textContent = 'חסר שם'; return; }
      var max = items.reduce(function (m, i) { return Math.max(m, i.n || 0); }, 0);
      items.push({ n: max + 1, name: name.value.trim(), detail: detail.value.trim(), price: price.value.trim(), url: url.value.trim() });
      save(items, function () { renderList(); });
    });
    [name, detail, price, url, addBtn, addMsg].forEach(function (e) { addCard.appendChild(e); });
    app.appendChild(addCard);

    function save(list, after) {
      api('/api/owner/list', 'PUT', { items: list })
        .then(function () { if (after) after(); else renderList(); })
        .catch(function (e) { if (e.message !== 'unauthorized') alert('שמירה נכשלה'); });
    }
  }

  if (token()) { renderList(); } else { renderLogin(); }
})();
