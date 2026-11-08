// my wishlist — static site. Gate: guests enter the name of the person they buy for.
// Profiles: only ירדן exists. No personal data beyond the gift list itself.
(function () {
    'use strict';

    var PROFILES = { 'ירדן': 'ירדן', 'yarden': 'ירדן' };

    var API = 'https://wishlist.y0546367987.workers.dev';

    // ils = approximate shekel value for budget grouping only (£1 ≈ ₪4.26, checked 7.11). Displayed prices stay in the store's currency.
    var items = [];

    var categories = ['יופי וטיפוח', 'תכשיטים', 'אופנה', 'הבית', 'אלקטרוניקה'];
    var stores = ['Super-Pharm', 'Sephora UK', 'שני יעקובי', 'SKIMS', 'Nike', 'Pandora', 'Treker', 'KSP', 'LEGO Store Israel'];
    var buckets = [
        { label: 'עד ₪150', test: function (it) { return it.ils <= 150; } },
        { label: '‏₪150 עד ₪300', test: function (it) { return it.ils > 150 && it.ils <= 300; } },
        { label: 'מעל ₪300', test: function (it) { return it.ils > 300; } },
    ];

    var ICONS = {
        home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/></svg>',
        gift: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8"/><path d="M12 8v13"/><path d="M12 8c-1.5 0-4.5.2-4.5-2A1.9 1.9 0 0 1 9.5 4C11 4 12 6 12 8Z"/><path d="M12 8c1.5 0 4.5.2 4.5-2A1.9 1.9 0 0 0 14.5 4C13 4 12 6 12 8Z"/></svg>',
        tag: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 3H20a1 1 0 0 1 1 1v7.5a2 2 0 0 1-.6 1.4l-8.5 8.5a2 2 0 0 1-2.8 0l-5.5-5.5a2 2 0 0 1 0-2.8l8.5-8.5A2 2 0 0 1 12.5 3Z"/><circle cx="16" cy="8" r="1.4"/></svg>',
        heart: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5C7 16.5 3.5 13.3 3.5 9.6A4.6 4.6 0 0 1 8.1 5c1.6 0 3 .8 3.9 2A4.4 4.4 0 0 1 15.9 5a4.6 4.6 0 0 1 4.6 4.6c0 3.7-3.5 6.9-8.5 10.9Z"/></svg>',
        heartFill: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5C7 16.5 3.5 13.3 3.5 9.6A4.6 4.6 0 0 1 8.1 5c1.6 0 3 .8 3.9 2A4.4 4.4 0 0 1 15.9 5a4.6 4.6 0 0 1 4.6 4.6c0 3.7-3.5 6.9-8.5 10.9Z"/></svg>',
        bag: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1.2 12.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9L5 8Z"/><path d="M8.5 10V6.5a3.5 3.5 0 0 1 7 0V10"/></svg>',
    };

    var LS_KEY = 'wishlist-visitor.v1';
    var GUEST_KEY = 'wishlist-guest.v1'; // the guest's own name, used for claims

    function normalize(name) { return name.trim().replace(/\s+/g, ' ').toLowerCase(); }
    function lookup(name) { return PROFILES[normalize(name)] || null; }
    function getVisitor() { try { return localStorage.getItem(LS_KEY) || ''; } catch (e) { return ''; } }
    function getGuest() { try { return localStorage.getItem(GUEST_KEY) || ''; } catch (e) { return ''; } }
    function setGuest(v) { try { if (v) localStorage.setItem(GUEST_KEY, v); } catch (e) {} }
    function setVisitor(v) { try { if (v) localStorage.setItem(LS_KEY, v); else localStorage.removeItem(LS_KEY); } catch (e) {} }
    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    var app = document.getElementById('app');
    var filter = { kind: 'all', value: '' };
    var drawerOpen = false;
    var claimOpenFor = null; // item n whose claim form is open
    var claimError = null;   // { n, msg }

    function navHtml(route) {
        var items_ = [
            { to: '#/', icon: ICONS.home, label: 'בית', r: '/' },
            { to: '#/gifts', icon: ICONS.gift, label: 'כל המתנות', r: '/gifts' },
            { to: '#/top', icon: ICONS.heart, label: 'הרצויים ביותר', r: '/top' },
            { to: '#/budget', icon: ICONS.tag, label: 'לפי תקציב', r: '/budget' },
            { to: '#/how', icon: ICONS.bag, label: 'איך קונים', r: '/how' },
        ];
        return '<nav class="icon-nav bottom" aria-label="ניווט">' + items_.map(function (it) {
            return '<a href="' + it.to + '" class="nav-item' + (route === it.r ? ' active' : '') + '">' + it.icon + '<span>' + it.label + '</span></a>';
        }).join('') + '</nav>';
    }

    function headerHtml(title, fact, intro) {
        return '<header class="site-header"><h1>' + esc(title) + '</h1>' +
            (fact ? '<p class="fact">' + esc(fact) + '</p>' : '') +
            (intro ? '<p class="intro">' + esc(intro) + '</p>' : '') + '</header>';
    }

    function claimRowHtml(it) {
        var guest = getGuest();
        var err = (claimError && String(claimError.n) === String(it.n)) ? '<p class="claim-error" role="alert">' + esc(claimError.msg) + '</p>' : '';
        if (it.claimedBy) {
            if (guest && normalize(it.claimedBy) === normalize(guest)) {
                return '<div class="claim-row mine"><span class="claim-state">שמרתם את המתנה הזאת ✓</span>' +
                    '<button class="claim-cancel" data-unclaim="' + it.n + '">ביטול</button></div>' + err;
            }
            return '<div class="claim-row taken"><span class="claim-state">' + esc(it.claimedBy) + ' קונה את זה ✓</span></div>' + err;
        }
        if (claimOpenFor === String(it.n)) {
            return '<div class="claim-row claim-form">' +
                '<input class="gate-input claim-input" data-for="' + it.n + '" type="text" placeholder="השם שלכם" aria-label="השם שלכם" autocomplete="off" maxlength="60" value="' + esc(guest).replace(/"/g, '&quot;') + '">' +
                '<button class="gate-submit claim-go" data-claim="' + it.n + '">שמירה</button>' +
                '<button class="claim-cancel" data-claim-cancel-form aria-label="ביטול">×</button></div>' + err;
        }
        return '<div class="claim-row"><button class="item-btn claim-btn" data-claim-open="' + it.n + '">אני קונה את זה</button></div>' + err;
    }

    function findItem(n) {
        for (var i = 0; i < items.length; i++) if (String(items[i].n) === String(n)) return items[i];
        return null;
    }

    function refreshItems() {
        fetch(API + '/api/gifts', { headers: { 'X-Wishlist-Client': '1' } })
            .then(function (r) { return r.json(); })
            .then(function (data) { items = (data && data.items) || []; route(); })
            .catch(function () { route(); });
    }

    function doClaim(n) {
        var input = app.querySelector('.claim-input[data-for="' + n + '"]');
        var name = input ? input.value.trim().replace(/\s+/g, ' ') : '';
        if (!name) {
            claimError = { n: n, msg: 'כתבו את השם שלכם כדי לשמור' };
            route();
            var inp = app.querySelector('.claim-input');
            if (inp) inp.focus();
            return;
        }
        claimError = null;
        fetch(API + '/api/gifts/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Wishlist-Client': '1' },
            body: JSON.stringify({ n: Number(n), name: name })
        }).then(function (r) { return r.json().then(function (d) { return { status: r.status, body: d }; }); })
            .then(function (res) {
                if (res.status === 200) {
                    setGuest(name);
                    var it = findItem(n);
                    if (it) it.claimedBy = res.body.claimedBy || name;
                    claimOpenFor = null;
                    route();
                } else if (res.status === 409) {
                    claimOpenFor = null;
                    claimError = { n: n, msg: 'מישהו אחר כבר הספיק לשמור את המתנה הזאת' };
                    refreshItems();
                } else {
                    claimError = { n: n, msg: 'שגיאה, נסו שוב' };
                    route();
                }
            })
            .catch(function () { claimError = { n: n, msg: 'שגיאת רשת, נסו שוב' }; route(); });
    }

    function doUnclaim(n) {
        var name = getGuest();
        if (!name) return;
        fetch(API + '/api/gifts/unclaim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Wishlist-Client': '1' },
            body: JSON.stringify({ n: Number(n), name: name })
        }).then(function (r) {
            if (r.status === 200) {
                var it = findItem(n);
                if (it) delete it.claimedBy;
                route();
            } else {
                refreshItems();
            }
        })
            .catch(function () { route(); });
    }

    function giftCardHtml(it) {
        var photo = it.photo ? '<img src="' + it.photo + '" alt="' + esc(it.name) + '" loading="lazy">' : '<div class="no-photo" aria-hidden="true"></div>';
        var links = '<div class="item-link"><a href="' + it.url + '" target="_blank" rel="noopener">' + (it.secondUrl ? 'לסט Sleepy Girl + Pretzel' : 'לפריט באתר') + '</a></div>';
        if (it.secondUrl) {
            links += '<div class="item-link">' + (it.secondPhoto ? '<img src="' + it.secondPhoto + '" alt="Pocket Pair: Toasted Teddy + Espresso" class="second-thumb">' : '') +
                '<a href="' + it.secondUrl + '" target="_blank" rel="noopener">לסט Toasted Teddy + Espresso</a></div>';
        }
        return '<div class="gift-card" data-n="' + it.n + '">' +
            '<div class="gift-row"><span class="num">' + it.n + '.</span>' + photo +
            '<div><div class="name">' + esc(it.name) + (it.top ? '<span class="top-badge" title="מהרצויים ביותר">' + ICONS.heartFill + '</span>' : '') + '</div><div class="sub">' + esc(it.store) + ' · ' + esc(it.category) + '</div></div>' +
            '<span class="price">' + esc(it.price) + '</span></div>' +
            claimRowHtml(it) +
            '<div class="item-actions">' +
            '<button class="item-btn" data-toggle="details" aria-expanded="false">פירוט המוצר <span class="chev" aria-hidden="true">⌄</span></button>' +
            '<button class="item-btn" data-toggle="links" aria-expanded="false">קישור למוצר <span class="chev" aria-hidden="true">⌄</span></button>' +
            '</div>' +
            '<p class="item-details" hidden>' + esc(it.detail) + '</p>' +
            '<div class="item-links" hidden>' + links + '</div>' +
            '</div>';
    }

    function drawerHtml() {
        var counts = function (kind, value) { return items.filter(function (it) { return kind === 'category' ? it.category === value : it.store === value; }).length; };
        var h = '<div class="drawer' + (drawerOpen ? ' open' : '') + '">' +
            '<div class="drawer-head"><span>סינון הרשימה</span><button class="drawer-close" data-close-drawer aria-label="סגירה">×</button></div>' +
            '<button class="drawer-item' + (filter.kind === 'all' ? ' active' : '') + '" data-filter-kind="all"><span>הכל</span><span class="count">' + items.length + '</span></button>' +
            '<div class="drawer-section">קטגוריות</div>' +
            categories.map(function (c) {
                return '<button class="drawer-item' + (filter.kind === 'category' && filter.value === c ? ' active' : '') + '" data-filter-kind="category" data-filter-value="' + esc(c) + '"><span>' + esc(c) + '</span><span class="count">' + counts('category', c) + '</span></button>';
            }).join('') +
            '<div class="drawer-section">חנויות</div>' +
            stores.map(function (s) {
                return '<button class="drawer-item' + (filter.kind === 'store' && filter.value === s ? ' active' : '') + '" data-filter-kind="store" data-filter-value="' + esc(s) + '"><span>' + esc(s) + '</span><span class="count">' + counts('store', s) + '</span></button>';
            }).join('') + '</div>';
        return (drawerOpen ? '<div class="drawer-overlay" data-close-drawer></div>' : '') + h;
    }

    function visibleItems() {
        if (filter.kind === 'all') return items;
        return items.filter(function (it) { return filter.kind === 'category' ? it.category === filter.value : it.store === filter.value; });
    }

    function homePage() {
        return '<div class="page">' +
            headerHtml('my wishlist', 'ליום ההולדת', 'כל הדברים שאני רוצה, במקום אחד.') +
            '<div class="group-label">בקצרה</div>' +
            '<div class="stats">' +
            '<div class="stat"><span class="stat-num">' + items.length + '</span><span class="stat-label">מתנות</span></div>' +
            '<div class="stat"><span class="stat-num">' + categories.length + '</span><span class="stat-label">קטגוריות</span></div>' +
            '<div class="stat"><span class="stat-num" dir="ltr">₪79.90+</span><span class="stat-label">טווח מחירים</span></div>' +
            '</div>' +
            '<nav class="home-nav" aria-label="דפי האתר">' +
            '<a href="#/gifts" class="home-card">' + ICONS.gift + '<span>כל המתנות</span><small>הרשימה המלאה, עם סינון לפי קטגוריה וחנות</small></a>' +
            '<a href="#/budget" class="home-card">' + ICONS.tag + '<span>לפי תקציב</span><small>אותן מתנות, מחולקות לפי מחיר</small></a>' +
            '<a href="#/top" class="home-card">' + ICONS.heart + '<span>הרצויים ביותר</span><small>המתנות שהכי בא לי לקבל</small></a>' +
            '<a href="#/how" class="home-card">' + ICONS.bag + '<span>איך קונים</span><small>הסבר קצר למי שרוצה לקנות מתנה</small></a>' +
            '</nav>' +
            '<p class="closing">המחירים מעודכנים לתאריך שמצוין בפירוט של כל פריט.</p>' +
            '<button class="switch-name" data-switch-name>כניסה בשם אחר</button>' +
            '</div>' + navHtml('/');
    }

    function giftsPage() {
        var vis = visibleItems();
        var chip = filter.kind !== 'all'
            ? '<div class="filter-chip"><span>' + (filter.kind === 'category' ? 'קטגוריה' : 'חנות') + ': ' + esc(filter.value) + '</span><button data-filter-kind="all" aria-label="הצגת הכל">×</button></div>'
            : '';
        return '<div class="page">' +
            headerHtml('כל המתנות', vis.length + ' פריטים', '') +
            '<div class="controls"><button class="menu-btn" data-open-drawer aria-label="קטגוריות וחנויות"><span></span><span></span><span></span></button>' + chip + '</div>' +
            vis.map(giftCardHtml).join('') +
            '<p class="closing">הרשימה מתעדכנת לפי מה שנשלח, ממוינת מהזול ליקר. המחירים בשקלים (חמישה פריטים בפאונד, מסומן £), כפי שהופיעו באתר בתאריך שמצוין בפירוט של כל פריט. המיון בין המטבעות לפי שער £1 ≈ ₪4.26 מ־7.11, להצגה בלבד.</p>' +
            '<button class="switch-name" data-switch-name>כניסה בשם אחר</button>' +
            '</div>' + navHtml('/gifts') + drawerHtml();
    }

    function budgetPage() {
        var h = '<div class="page">' +
            headerHtml('לפי תקציב', items.length + ' פריטים', 'כל המתנות מהרשימה, מחולקות לפי מחיר. פריטים בפאונד (£) חולקו לפי שער £1 ≈ ₪4.26 מ־7.11, להצגה בלבד - המחיר האמיתי הוא בפאונד.');
        buckets.forEach(function (b) {
            var list = items.filter(b.test);
            h += '<div class="group-label big">' + esc(b.label) + ' · ' + list.length + ' פריטים</div>' + list.map(giftCardHtml).join('');
        });
        h += '<p class="closing">המחירים כפי שהופיעו באתר בתאריך שמצוין בפירוט של כל פריט.</p>' +
            '<button class="switch-name" data-switch-name>כניסה בשם אחר</button>' +
            '</div>' + navHtml('/budget');
        return h;
    }


    function topPage() {
        var list = items.filter(function (it) { return it.top; });
        var body = list.length
            ? list.map(giftCardHtml).join('')
            : '<p class="closing">עוד לא סומנו מתנות בלב. ירדן מסמנת בלב את המתנות שהכי בא לה, והן מופיעות כאן.</p>';
        return '<div class="page">' +
            headerHtml('הרצויים ביותר', list.length + ' פריטים', 'אלו המתנות שהכי בא לי לקבל. סימנתי אותן בלב.') +
            body +
            '<p class="closing">הסימון מתעדכן מעת לעת. שאר המתנות נמצאות בעמוד ״כל המתנות״.</p>' +
            '<button class="switch-name" data-switch-name>כניסה בשם אחר</button>' +
            '</div>' + navHtml('/top');
    }

    function howPage() {
        return '<div class="page">' +
            headerHtml('איך קונים', 'הסבר קצר', 'רוצים לקנות לי מתנה? זה פשוט.') +
            '<div class="group-label big">ארבעה צעדים</div>' +
            '<ol class="steps">' +
            '<li>בוחרים מתנה בעמוד ״כל המתנות״ או ״לפי תקציב״.</li>' +
            '<li>מסמנים ״אני קונה את זה״ וכותבים את השם, כדי שכולם יראו שהמתנה כבר נתפסה.</li>' +
            '<li>לוחצים על ״קישור למוצר״ מתחת למתנה, ועוברים לאתר החנות.</li>' +
            '<li>קונים באתר החנות, כמו כל קנייה רגילה.</li>' +
            '</ol>' +
            '<div class="group-label big">טוב לדעת</div>' +
            '<ul class="notes">' +
            '<li>הקנייה מתבצעת רק באתר החנות. כאן אין תשלום, והשמירה רק מסמנת לאחרים שמתכוונים לקנות - היא לא קנייה בפועל.</li>' +
            '<li>המחירים מעודכנים לתאריך שמצוין בפירוט של כל פריט, ויכולים להשתנות.</li>' +
            '<li>חמש מתנות מאתר Sephora UK, המחיר שלהן בפאונד (£) והמשלוח מבריטניה.</li>' +
            '<li>בחלק מהפריטים עוד לא נבחרו אפשרויות כמו צבע, מידה או גוון - זה כתוב ב״פירוט המוצר״. במקרה של ספק, אפשר לשאול אותי.</li>' +
            '</ul>' +
            '<p class="closing">נבדק ועודכן ב־7.11.</p>' +
            '<button class="switch-name" data-switch-name>כניסה בשם אחר</button>' +
            '</div>' + navHtml('/how');
    }

    function gatePage(error) {
        return '<div class="page"><div class="gate-card">' +
            headerHtml('my wishlist', 'רשימת מתנות ליום הולדת', 'כדי לראות את הרשימה, כתבו את השם של מי שקונים לו מתנה.') +
            '<div class="gate">' +
            '<label class="gate-label" for="gate-name">למי קונים מתנה?</label>' +
            '<input id="gate-name" class="gate-input" type="text" placeholder="כתבו שם פרטי" autocomplete="off">' +
            (error ? '<p role="alert" class="gate-error">' + esc(error) + '</p>' : '') +
            '<button type="button" class="gate-submit" id="gate-submit" disabled>' + ICONS.gift + ' כניסה לרשימה</button>' +
            '</div>' +
            '<p class="closing">הרשימה פתוחה לכל מי שיודע את השם.</p>' +
            '</div></div>';
    }

    function renderGate(error) {
        app.innerHTML = gatePage(error || '');
        var input = document.getElementById('gate-name');
        var btn = document.getElementById('gate-submit');
        input.focus();
        input.addEventListener('input', function () { btn.disabled = !input.value.trim(); });
        var submit = function () {
            var profile = lookup(input.value);
            if (profile) { setVisitor(profile); route(); }
            else if (input.value.trim()) renderGate('לא נמצאה רשימה בשם הזה. בדקו את האיות ונסו שוב.');
        };
        btn.addEventListener('click', submit);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    }

    function currentRoute() {
        var h = location.hash.replace(/^#/, '');
        return (h === '/gifts' || h === '/budget' || h === '/how' || h === '/top') ? h : '/';
    }

    function route() {
        if (!getVisitor()) { renderGate(); return; }
        var r = currentRoute();
        if (r === '/gifts') app.innerHTML = giftsPage();
        else if (r === '/budget') app.innerHTML = budgetPage();
        else if (r === '/how') app.innerHTML = howPage();
        else if (r === '/top') app.innerHTML = topPage();
        else app.innerHTML = homePage();
        window.scrollTo(0, 0);
    }

    // Event delegation: toggles, drawer, filters, switch-name.
    app.addEventListener('click', function (e) {
        var t = e.target;
        var btn = t.closest ? t.closest('[data-toggle],[data-open-drawer],[data-close-drawer],[data-filter-kind],[data-switch-name],[data-claim-open],[data-claim],[data-unclaim],[data-claim-cancel-form]') : null;
        if (!btn) return;
        if (btn.hasAttribute('data-switch-name')) { setVisitor(''); renderGate(); return; }
        if (btn.hasAttribute('data-claim-open')) {
            claimOpenFor = btn.getAttribute('data-claim-open');
            claimError = null;
            route();
            var inp = app.querySelector('.claim-input');
            if (inp) inp.focus();
            return;
        }
        if (btn.hasAttribute('data-claim-cancel-form')) { claimOpenFor = null; claimError = null; route(); return; }
        if (btn.hasAttribute('data-claim')) { doClaim(btn.getAttribute('data-claim')); return; }
        if (btn.hasAttribute('data-unclaim')) { doUnclaim(btn.getAttribute('data-unclaim')); return; }
        if (btn.hasAttribute('data-open-drawer')) { drawerOpen = true; route(); return; }
        if (btn.hasAttribute('data-close-drawer')) { drawerOpen = false; route(); return; }
        if (btn.hasAttribute('data-filter-kind')) {
            filter = { kind: btn.getAttribute('data-filter-kind'), value: btn.getAttribute('data-filter-value') || '' };
            if (filter.kind === 'all') filter.value = '';
            drawerOpen = false; route(); return;
        }
        if (btn.hasAttribute('data-toggle')) {
            var card = btn.closest('.gift-card');
            var panel = btn.getAttribute('data-toggle') === 'details' ? card.querySelector('.item-details') : card.querySelector('.item-links');
            var open = panel.hasAttribute('hidden');
            if (open) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
            btn.classList.toggle('open', open);
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
    });

    app.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target && e.target.classList && e.target.classList.contains('claim-input')) {
            e.preventDefault();
            doClaim(e.target.getAttribute('data-for'));
        }
    });

    window.addEventListener('hashchange', function () { filter = { kind: 'all', value: '' }; drawerOpen = false; route(); });
    fetch(API + '/api/gifts', { headers: { 'X-Wishlist-Client': '1' } })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (data) { items = (data && data.items) || []; route(); })
        .catch(function () {
            app.innerHTML = '<div class="gate-card"><h1 class="site-header">my wishlist</h1><p class="gate-error">לא הצלחנו לטעון את הרשימה, נסו לרענן.</p></div>';
        });
})();
