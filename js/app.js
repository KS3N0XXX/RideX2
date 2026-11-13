const iconPaths = {
    bike: '<circle cx="5" cy="17" r="4"/><circle cx="19" cy="17" r="4"/><path d="m5 17 5-8 4 8H5m14 0L15 6h4M8 9h5"/>',
    cart: '<path d="M2 3h3l3 12h11l3-9H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
    heart: '<path d="M20.8 5.8a5.3 5.3 0 0 0-7.5 0L12 7.1l-1.3-1.3a5.3 5.3 0 0 0-7.5 7.5l1.3 1.3L12 22l7.5-7.4 1.3-1.3a5.3 5.3 0 0 0 0-7.5Z"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    truck: '<path d="M2 5h13v13H2m13-9h4l3 4v5h-7M2 9h6M1 13h5"/><circle cx="6" cy="18" r="2" fill="white"/><circle cx="18" cy="18" r="2" fill="white"/>',
    shield: '<path d="m12 2 8 4v6c0 4-4 8-8 10-4-2-8-6-8-10V6l8-4Z"/><path d="m8 12 3 3 5-6"/>',
    support: '<path d="M4 13v-2a8 8 0 0 1 16 0v4a5 5 0 0 1-5 5h-3"/><rect x="3" y="11" width="4" height="6" rx="1"/><rect x="17" y="11" width="4" height="6" rx="1"/>',
    return: '<path d="M4 10a9 9 0 1 1 1 8M4 4v6h6"/>'
};
const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + iconPaths[name] + '</svg>';
const get = id => document.getElementById(id);
const {page, base, catalog} = document.body.dataset;
const params = new URLSearchParams(location.search);
const money = amount => new Intl.NumberFormat('ru-RU').format(amount) + ' ₽';
const photo = product => base + 'images/' + product.image + '.webp';
const filterForm = get('filters');
const checkout = get('checkout');

const directFile = location.protocol === 'file:';
const searchForm = document.querySelector('.search-bar');
let fileState = {};

if (directFile && location.hash.startsWith('#ridex=')) {
    try {
        fileState = JSON.parse(decodeURIComponent(location.hash.slice(7))) || {};
    } catch {
        fileState = {};
    }
}

function read(key, fallback) {
    if (directFile) return fileState[key] ?? fallback;
    try {
        return JSON.parse(localStorage.getItem('ridex.' + key)) ?? fallback;
    } catch {
        return fallback;
    }
}

function carryFileState() {
    const hash = '#ridex=' + encodeURIComponent(JSON.stringify(fileState));
    document.querySelectorAll('a[href]').forEach(link => {
        const target = new URL(link.getAttribute('href'), location.href);
        if (target.protocol !== 'file:' || !target.pathname.endsWith('.html')) return;
        if (target.hash && !target.hash.startsWith('#ridex=')) return;
        target.hash = hash;
        link.href = target.href;
    });
}

function save(key, value) {
    if (directFile) {
        fileState[key] = value;
        history.replaceState(null, '', '#ridex=' + encodeURIComponent(JSON.stringify(fileState)));
        carryFileState();
        return;
    }
    try {
        localStorage.setItem('ridex.' + key, JSON.stringify(value));
    } catch {
        toast('Браузер ограничил сохранение данных.');
    }
}

let favorites = read('favorites', []);
let cart = read('cart', {});
let skipped = new Set();
let promo = '';
let toastTimer;

function toast(message) {
    get('toast').textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { get('toast').textContent = ''; }, 2400);
}

function header() {
    const count = products.reduce((sum, item) => sum + (cart[item.id] || 0), 0);
    get('count').textContent = count;
    get('count').hidden = count === 0;
}

function empty(title, description, link = catalog, label = 'В каталог →') {
    return `
    <div class="empty">
        <h2>${title}</h2>
        <p>${description}</p>
        <a class="button" href="${link}">${label}</a>
    </div>
    `;
}

function card(product) {
    const {id, name, type, price, old, badge} = product;
    return `
    <article class="card">
        <span class="badge">${badge}</span>
        <button
            class="favorite"
            data-favorite="${id}"
            type="button"
            aria-label="Избранное: ${name}"
            aria-pressed="${favorites.includes(id)}"
        >
            ${icon('heart')}
        </button>
        <img src="${photo(product)}" alt="${name}">
        <small>${type}</small>
        <h3>${name}</h3>
        <p class="rating">★ 4.9 · 87 отзывов</p>
        <div class="price-row">
            <div>
                <strong>${money(price)}</strong>
                ${old ? '<del>' + money(old) + '</del>' : ''}
            </div>
            <button
                class="add"
                type="button"
                data-add="${id}"
                aria-label="В корзину: ${name}"
            >
                ${icon('cart')}
            </button>
        </div>
    </article>
    `;
}
let search = (params.get('q') || '').trim().toLowerCase();

function renderProducts() {
    let list = products.slice();
    if (page === 'home') list = list.slice(0, 4);
    if (page === 'favorites') list = list.filter(item => favorites.includes(item.id));
    if (filterForm) {
        const form = new FormData(filterForm);
        const category = form.get('category');
        const brands = form.getAll('brand');
        const min = Number(form.get('min')) || 0;
        const max = form.get('max') === '' ? Infinity : Number(form.get('max'));
        const sale = form.has('sale');
        list = list.filter(item => (!category || item.category === category) &&
            (!brands.length || brands.includes(item.brand)) && item.price >= min && item.price <= max &&
            (!sale || item.old) && (item.name + ' ' + item.type).toLowerCase().includes(search));
        const sort = get('sort').value;
        if (sort) list.sort((a, b) => sort === 'low' ? a.price - b.price : b.price - a.price);
        get('results').textContent = 'Найдено: ' + list.length;
    }
    const noItems = page === 'favorites'
        ? empty('Пока пусто', 'Нажми на сердечко в карточке велосипеда, чтобы сохранить его.')
        : empty('Велосипеды не найдены', 'Измени запрос или сбрось фильтры.', catalog, 'Сбросить поиск');
    get('products').innerHTML = list.length ? list.map(card).join('') : noItems;
    if (directFile) carryFileState();
}

function changeCart(id, amount) {
    const quantity = (cart[id] || 0) + amount;
    if (quantity > 0) cart[id] = quantity;
    else {
        delete cart[id];
        skipped.delete(id);
    }
    save('cart', cart);
    header();
    if (page === 'cart') renderCart();
}

function cartSelection() {
    return products.filter(item => cart[item.id] > 0 && !skipped.has(item.id));
}

function renderCart() {
    const items = products.filter(item => cart[item.id] > 0);
    const count = items.reduce((sum, item) => sum + cart[item.id], 0);
    get('cart-intro').textContent = count ? 'Товаров в корзине: ' + count + ' · До новых маршрутов один шаг' : 'До новых маршрутов один шаг.';
    if (!items.length) {
        get('cart').innerHTML = empty('Корзина пуста', 'Выбери велосипед в каталоге.');
        if (directFile) carryFileState();
        return;
    }
    const selection = cartSelection();
    const quantity = selection.reduce((sum, item) => sum + cart[item.id], 0);
    const full = selection.reduce((sum, item) => sum + (item.old || item.price) * cart[item.id], 0);
    const subtotal = selection.reduce((sum, item) => sum + item.price * cart[item.id], 0);
    const total = promo ? Math.round(subtotal * 0.95) : subtotal;
    const rows = items.map(item => `
    <article class="cart-row panel">
        <input
            type="checkbox"
            data-select="${item.id}"
            aria-label="Выбрать ${item.name}"
            ${skipped.has(item.id) ? '' : 'checked'}
        >
        <img src="${photo(item)}" alt="">
        <div>
            <small>${item.type}</small>
            <h3>${item.name}</h3>
            <small>${item.specs || item.brand}</small>
            <span class="availability">В наличии</span>
        </div>
        <div class="cart-right">
            <strong>${money(item.price * cart[item.id])}</strong>
            <div class="quantity">
                <button
                    data-id="${item.id}"
                    data-quantity="-1"
                    aria-label="Уменьшить количество ${item.name}"
                >
                    −
                </button>
                <span>${cart[item.id]}</span>
                <button
                    data-id="${item.id}"
                    data-quantity="1"
                    aria-label="Увеличить количество ${item.name}"
                >
                    +
                </button>
            </div>
            <button
                class="text"
                data-remove="${item.id}"
                aria-label="Удалить ${item.name}"
            >
                Удалить
            </button>
        </div>
    </article>
    `).join('');
    get('cart').innerHTML = `
    <div class="cart-layout">
        <div>
            <div class="section-head">
                <p>Выбрано: ${quantity}</p>
                <button class="text" id="remove-selected" ${quantity ? '' : 'disabled'}>Удалить выбранное</button>
            </div>
            ${rows}
            <form class="promo" id="promo-form">
                <input
                    name="promo"
                    aria-label="Промокод"
                    placeholder="Введи промокод"
                    value="${promo}"
                >
                <button class="button outline">Применить</button>
            </form>
            <p class="promo-note muted">Демо-промокод RIDEX5 даёт скидку 5%.</p>
        </div>
        <aside class="summary">
            <h2>Твой заказ</h2>
            <p>
                <span>Товары, ${quantity} шт.</span>
                <span>${money(full)}</span>
            </p>
            <p>
                <span>Скидка</span>
                <span>−${money(full-total)}</span>
            </p>
            <p>
                <span>Доставка</span>
                <span>Бесплатно</span>
            </p>
            <p class="total">
                <span>Итого</span>
                <span>${money(total)}</span>
            </p>
            <button class="button" id="checkout-button" ${quantity ? '' : 'disabled'}>
                Перейти к оформлению →
            </button>
            <p class="promo-note">Демонстрационный заказ</p>
            <a class="accent" href="${catalog}">← Продолжить покупки</a>
        </aside>
    </div>
    `;
    if (directFile) carryFileState();
    get('promo-form').addEventListener('submit', event => {
        event.preventDefault();
        const code = new FormData(event.currentTarget).get('promo').trim().toUpperCase();
        promo = code === 'RIDEX5' ? code : '';
        renderCart();
        toast(promo ? 'Промокод применён' : 'Промокод не найден');
    });
}

async function api(path, fields) {
    const response = await fetch('/api/' + path, fields ? {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(fields)
    } : {});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
    return data;
}

function setupAuth(form) {
    const button = form.querySelector('button[type=submit]');
    button.disabled = false;
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const error = get('form-error');
        error.hidden = true;
        button.disabled = true;
        try {
            await api(page === 'register' ? 'register' : 'login', Object.fromEntries(new FormData(form)));
            location.assign('account.html');
        } catch (issue) {
            error.textContent = issue instanceof TypeError
                ? 'Сервер недоступен. Запусти START_RideX.bat и открой сайт через него.' : issue.message;
            error.hidden = false;
        } finally {
            button.disabled = false;
        }
    });
}

async function setupAccount() {
    try {
        const {user} = await api('me');
        if (!user) { location.replace('login.html'); return; }
        get('profile-name').textContent = user.name;
        get('profile-email').textContent = user.email;
        get('logout').disabled = false;
        get('logout').addEventListener('click', async () => {
            get('logout').disabled = true;
            try {
                await api('logout', {});
                location.replace('login.html');
            } catch {
                get('account-error').textContent = 'Не удалось выйти. Проверь, что сервер работает, и повтори.';
                get('logout').disabled = false;
            }
        });
    } catch {
        get('account-error').textContent = 'Сервер недоступен. Запусти START_RideX.bat.';
    }
}

const slides = [
    ['Твой идеальный велосипед','Для города, гор и новых открытий. Найди свой маршрут вместе с RideX.','hero'],
    ['Открой новые маршруты','Найди велосипед для следующей поездки.','about'],
    ['Больше маршрутов. Меньше цена.','Посмотри предложения этого сезона.','sale']
];
let slide = 0;

document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
header();
if (filterForm) {
    const searchField = document.querySelector('.search-bar input');
    searchField.value = params.get('q') || '';
    filterForm.elements.sale.checked = params.get('sale') === '1';
    filterForm.addEventListener('submit', event => { event.preventDefault(); renderProducts(); });
    filterForm.addEventListener('reset', () => {
        search = '';
        searchField.value = '';
        get('sort').value = '';
        if (location.search && !directFile) history.replaceState(null, '', location.pathname);
        setTimeout(renderProducts, 0);
    });
    get('sort').addEventListener('change', renderProducts);
}
if (get('products')) renderProducts();
if (checkout) {
    renderCart();
    checkout.addEventListener('close', () => {
        if (checkout.returnValue !== 'confirm') return;
        cartSelection().forEach(item => { delete cart[item.id]; });
        save('cart', cart);
        promo = '';
        header();
        renderCart();
        if (!Object.keys(cart).length) get('cart').innerHTML = empty('Демо-заказ оформлен', 'Спасибо, что заглянул в RideX!');
        if (directFile) carryFileState();
        toast('Демо-заказ оформлен');
    });
}
const authForm = get('auth-form');
if (authForm) setupAuth(authForm);
if (page === 'account') setupAccount();
if (directFile) {
    carryFileState();
    searchForm.addEventListener('submit', event => {
        event.preventDefault();
        const target = new URL(searchForm.action);
        target.searchParams.set('q', new FormData(searchForm).get('q'));
        target.hash = location.hash.startsWith('#ridex=') ? location.hash : '';
        location.assign(target.href);
    });
}

document.addEventListener('change', event => {
    const id = event.target.dataset.select;
    if (!id) return;
    if (event.target.checked) skipped.delete(id);
    else skipped.add(id);
    renderCart();
    document.querySelector(`[data-select="${id}"]`)?.focus();
});
document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const {favorite, add, id, quantity, remove, slide: direction} = button.dataset;
    if (favorite) {
        const added = !favorites.includes(favorite);
        favorites = added ? [...favorites, favorite] : favorites.filter(item => item !== favorite);
        save('favorites', favorites);
        if (page === 'favorites') renderProducts();
        else button.setAttribute('aria-pressed', String(added));
        toast(added ? 'Добавлено в избранное' : 'Удалено из избранного');
    }
    if (add) {
        changeCart(add, 1);
        toast('Велосипед добавлен в корзину');
    }
    if (quantity) {
        changeCart(id, Number(quantity));
        document.querySelector(`[data-id="${id}"][data-quantity="${quantity}"]`)?.focus();
    }
    if (remove) changeCart(remove, -cart[remove]);
    if (button.id === 'remove-selected') {
        cartSelection().forEach(item => { delete cart[item.id]; });
        save('cart', cart);
        header();
        renderCart();
    }
    if (button.id === 'checkout-button') {
        checkout.returnValue = '';
        checkout.showModal();
    }
    if (button.hasAttribute('data-password')) {
        const input = button.previousElementSibling;
        input.type = input.type === 'password' ? 'text' : 'password';
        button.setAttribute('aria-label', input.type === 'text' ? 'Скрыть пароль' : 'Показать пароль');
    }
    if (direction) {
        slide = (slide + Number(direction) + slides.length) % slides.length;
        const [title, copy, asset] = slides[slide];
        get('hero-title').textContent = title;
        get('hero-copy').textContent = copy;
        get('slide-number').textContent = '0' + (slide + 1) + ' / 03';
        const hero = document.querySelector('.hero');
        hero.style.setProperty('--hero-image', `url("${base}images/${asset}.webp")`);
        hero.querySelector('a').href = catalog + (asset === 'sale' ? '?sale=1' : '');
        if (directFile) carryFileState();
    }
});
