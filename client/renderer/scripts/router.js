const loadContent = document.getElementById('load-content');
const title = document.getElementById('title');

// Карта маршрутов
const pages = {
    friendsPage: '../views/pages/friends-page.html',
    requestsPage:  '../views/pages/requests-page.html',
    subscriptionsPage: '../views/pages/subscriptions-page.html'
}

// Безопасная загрузка HTML
function sanitizeHTML(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('script').forEach(script => script.remove());
    return template.innerHTML;
}

// Функция для переключения активной кнопки
function setActiveButton(activeButton) {
    document.querySelectorAll('.btn-friends, .btn-request, .btn-sub').forEach(btn => {
        btn.classList.remove('active');
    });
    if (activeButton) {
        activeButton.classList.add('active');
    }
}

// Загрузка страницы
function loadPage(pageKey) {
    const pagePath = pages[pageKey];
    if (!pagePath) return;

    fetch(pagePath)
        .then(res => res.text())
        .then(html => {
            loadContent.innerHTML = sanitizeHTML(html);
        })
        .catch(() => {
            loadContent.innerHTML = '<p>Ошибка загрузки страницы.</p>';
        });
}

// Назначаем обработчики кнопкам
document.querySelector('.btn-friends')?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveButton(e.currentTarget);
    title.textContent = "Друзья";
    loadPage('friendsPage');
});

document.querySelector('.btn-request')?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveButton(e.currentTarget);
    title.textContent = "Запросы на общение";
    loadPage('requestsPage');
});

document.querySelector('.btn-sub')?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveButton(e.currentTarget);
    title.textContent = "Подписки";
    loadPage('subscriptionsPage');
});

// Загрузка стартовой страницы при загрузке
window.addEventListener('DOMContentLoaded', () => {
    loadPage('friendsPage');
    title.textContent = "Друзья";
});