async function initFriendsPage() {
    await loadAndDisplayFriends('online');
    setupHeaderButtons();
    setupSearchInput();
}

async function loadAndDisplayFriends(type) {
    let response;
    
    if (type === 'online') {
        response = await loadOnlineFriend();
    } else {
        response = await loadAllFriend();
    }
    
    displayFriendsList(response);
}

function setupHeaderButtons() {
    document.addEventListener('click', async (e) => {
        const target = e.target.closest('.swap-load-content');
        const addFriendBtn = e.target.closest('#add-friend'); 
        
        if (addFriendBtn) {
            e.preventDefault();
            showSearchModal('search-contanier', 'friends');
            return;
        }
        
        if (!target || !document.querySelector('.main-content')) return;
        
        e.preventDefault();
        
        document.querySelectorAll('.swap-load-content').forEach(btn => {
            btn.classList.remove('active');
        });
        
        target.classList.add('active');
        
        if (target.textContent.includes('В сети') || target.textContent === 'В сети') {
            await loadAndDisplayFriends('online');
        } else if (target.textContent.includes('Все') || target.textContent === 'Все') {
            await loadAndDisplayFriends('all');
        }
    });
    
    const onlineBtn = document.querySelector('.swap-load-content:first-child');
    if (onlineBtn) {
        onlineBtn.classList.add('active');
    }
}

function setupSearchInput() {
    const searchInput = document.getElementById('search-input');
    if (!searchInput) return;

    searchInput.addEventListener('keydown', function(e) {
        const prefix = this.dataset.prefix;
        
        if (prefix === '@' && this.selectionStart <= prefix.length) {
            if (e.key === 'Backspace' || e.key === 'Delete') {
                e.preventDefault();
            }
            else if (e.key === 'ArrowLeft' && this.selectionStart <= prefix.length) {
                e.preventDefault();
            }
        }
    });

    searchInput.addEventListener('paste', function(e) {
        const prefix = this.dataset.prefix;
        if (prefix === '@' && this.selectionStart <= prefix.length) {
            e.preventDefault();
        }
    });
}

function displayFriendsList(res) {
    const mainContent = document.querySelector('.main-content');
    
    if (!mainContent) return;
    mainContent.innerHTML = '';

    if (res.total_count > 0) {
        const section = document.createElement('div');
        section.className = 'friends-list';

        const header = document.createElement('div');
        header.className = 'request-header';
        header.innerHTML = `
            <i class="fa fa-user-clock"></i>
            <h3 class="request-title">Количество друзей (${res.users.length})</h3>
        `;
    
        section.appendChild(header);
        
        res.users.forEach(user => {
            const isOnline = user.status === 'online';
            const friendCard = document.createElement('div');
            friendCard.className = 'friend-card';
            friendCard.innerHTML = `
                <div class="user-info">
                    <img src="${user.avatar || '../../assets/logo/logo.svg'}" 
                        alt="Аватар" 
                        class="user-avatar">
                    <div class="user-details">
                        <p class="display-name">${user.display_name}</p>
                        <p class="username">${user.username}</p>
                        <p class="status ${isOnline ? 'online' : 'offline'}">
                            ${isOnline ? 'В сети' : 'Не в сети'}
                        </p>
                    </div>
                </div>
                <div class="friend-actions">
                    <a class="btn btn-message" data-id="${user.id}">
                        <i class="fa fa-comment"></i>
                    </a>
                    <a class="btn btn-remove" data-id="${user.id}">
                        <i class="fa fa-user-times"></i>
                    </a>
                </div>
            `;
            section.appendChild(friendCard);
        });

        mainContent.append(section);
        setupFriendActions();
    } else {
        mainContent.innerHTML = `
            <div class="null-content">
                <img src="../../assets/img/404-grey.svg">
                <p>Пока здесь ничего нет. Зато здесь сидит зяблик</p>
            </div>
        `;
    }
}


// Функция для настройки обработчиков кнопок действий
function setupFriendActions() {
    const container = document.querySelector('.friends-list');
    if (!container) return;
    
    container.addEventListener('click', (e) => {
        const messageBtn = e.target.closest('.btn-message');
        if (messageBtn) {
            e.preventDefault();
            console.log('Message to:', messageBtn.dataset.id);
        }
    });
    
    container.addEventListener('click', async (e) => {
        const removeBtn = e.target.closest('.btn-remove');
        if (removeBtn) {
            e.preventDefault();
            await removeFriend(removeBtn.dataset.id);
            const activeTab = document.querySelector('.header-group-btn .swap-load-content.active');
            if (activeTab) {
                await loadAndDisplayFriends(activeTab.textContent.includes('В сети') ? 'online' : 'all');
            }
        }
    });
}

// Остальные функции остаются без изменений
async function loadAllFriend() {
    const response = await window.electronAPI.invoke('getRelationships', {
        type: 1, 
        limit: 100,
        offset: 0
    });
    return response;
}

async function loadOnlineFriend() {
    const response = await window.electronAPI.invoke('getRelationships', {
        type: 1,
        limit: 100,
        offset: 0
    });
    
    if (response.users) {
        response.users = response.users.filter(user => user.status === 'online');
        response.total_count = response.users.length;
    }
    return response;
}

async function removeFriend(user_id) {
    const response = await window.electronAPI.invoke('updateRelationship', {
        target_user: user_id,
        new_type: 3,
        new_status: 1
    });
    return response;
}

// Инициализация страницы при загрузке
document.addEventListener('DOMContentLoaded', initFriendsPage);