document.getElementById('profile-target-user').addEventListener('click', async function(e) {
    e.preventDefault();

    target_user = this.dataset.target_user;
    console.log('target_user: ', target_user);

    await addFriend(target_user)
});

async function addFriend(targetUserId) {
    try {
        await window.electronAPI.invoke('createRelationship', {
            target_user: targetUserId
        });
        
    } catch (error) {
        console.error('Error adding friend:', error);
        showToast('Ошибка при отправке запроса', 'error');
    }
}

async function loadFriendRequests() {
    const response = await window.electronAPI.invoke('getRelationships', {
        type: 3, 
        limit: 50,
        offset: 0
    });

    return response;
}

document.getElementById('btn-request').addEventListener('click', async function(e) {
    e.preventDefault();

    const loadRequests = await loadFriendRequests();
    console.log(loadRequests);
    
    const headerGroup = document.getElementById('header-group-request');
    const existingPendingBtn = document.querySelector('.pending-requests-btn');
    
    if (loadRequests.total_count > 0) {
        if (existingPendingBtn) {
            existingPendingBtn.textContent = `Ожидание (${loadRequests.total_count})`;
        } 
        else {
            const pendingBtn = document.createElement('a');
            pendingBtn.className = 'swap-load-content pending-requests-btn';
            pendingBtn.textContent = `Ожидание (${loadRequests.total_count})`;
            pendingBtn.href = '#';
            pendingBtn.style.cursor = 'pointer';
            
            pendingBtn.addEventListener('click', async function(e) {
                e.preventDefault();
                await displayFriendRequests(loadRequests);
            });
            
            const spamBtn = document.querySelector('.swap-load-content:last-child');
            headerGroup.insertBefore(pendingBtn, spamBtn);
        }
    } 
    else if (existingPendingBtn) {
        existingPendingBtn.remove();
    }
});

async function displayFriendRequests(requests) {
    const mainContent = document.querySelector('.main-content');
    
    if (requests.total_count > 0) {
        mainContent.innerHTML = `
            <div class="requests-list" id="requests-container"></div>
        `;
        
        const container = document.getElementById('requests-container');
        
        const sentRequests = [];
        const receivedRequests = [];
        
        requests.users.forEach((user, index) => {
            const isInitiator = requests.initiator_statuses[index] === "INITIATOR";
            if (isInitiator) {
                sentRequests.push(user);
            } else {
                receivedRequests.push(user);
            }
        });
        
        if (sentRequests.length > 0) {
            const sentSection = createRequestSection(sentRequests, true);
            container.appendChild(sentSection);
        }
        
        if (receivedRequests.length > 0) {
            const receivedSection = createRequestSection(receivedRequests, false);
            container.appendChild(receivedSection);
        }
        
        addRequestButtonsHandlers();
    } else {
        mainContent.innerHTML = `
            <div class="null-content">
                <img src="../../assets/img/404-grey.svg">
                <p>Пока здесь ничего нет. Зато здесь сидит зяблик</p>
            </div>
        `;
    }
}

function createRequestSection(users, isInitiator) {
    const section = document.createElement('div');
    section.className = 'request-status-container';
    
    const header = document.createElement('div');
    header.className = 'request-header';
    header.innerHTML = `
        <i class="fa fa-user-clock"></i>
        <h3 class="request-title">${isInitiator ? 'Отправлено' : 'Ожидает'} (${users.length})</h3>
    `;
    
    section.appendChild(header);
    
    users.forEach(user => {
        const requestCard = document.createElement('div');
        requestCard.className = 'request-card';
        requestCard.innerHTML = `
            <div class="user-info">
                <img src="${user.avatar || '../../assets/logo/logo.svg'}" 
                    alt="Аватар" 
                    class="user-avatar">
                <div class="user-details">
                    <p class="display-name">${user.display_name}</p>
                    <p class="username">${user.username}</p>
                </div>
            </div>
            <div class="request-actions">
                ${isInitiator 
                    ? `<div class="tooltip-container req">
                            <span class="tooltip-text req">Отменить</span>
                            <a class="btn btn-cancel" data-id="${user.id}">
                            <i class="fa fa-times"></i></a>
                        </div>`
                    : `<div class="tooltip-container req">
                            <span class="tooltip-text req">Принять</span>
                            <a class="btn btn-accept" data-id="${user.id}">
                            <i class="fa fa-check"></i></a>
                        </div>
                        <div class="tooltip-container req">
                            <span class="tooltip-text req">Отклонить</span>
                            <a class="btn btn-decline" data-id="${user.id}">
                            <i class="fa fa-times"></i></a>
                        </div>`
                }
            </div>
        `;              
        
        section.appendChild(requestCard);
    });
    
    return section;
}

function addRequestButtonsHandlers() {
    document.querySelectorAll('.btn-accept')?.forEach(btn => {
        btn.addEventListener('click', async () => {
            await acceptFriendRequest(btn.dataset.id);
            updateRequestsDisplay();
        });
    });
    
    document.querySelectorAll('.btn-decline')?.forEach(btn => {
        btn.addEventListener('click', async () => {
            await declineFriendRequest(btn.dataset.id);
            updateRequestsDisplay();
        });
    });
    
    document.querySelectorAll('.btn-cancel')?.forEach(btn => {
        btn.addEventListener('click', async () => {
            res = await cancelFriendRequest(btn.dataset.id);
            updateRequestsDisplay();

            if (res) {
                showSuccessNotification("Вы отклонили зявку в друзья")
            }
        });
    });
}

async function updateRequestsDisplay() {
    const loadRequests = await loadFriendRequests();
    await displayFriendRequests(loadRequests);
    
    const pendingBtn = document.querySelector('.pending-requests-btn');
    if (pendingBtn) {
        pendingBtn.textContent = loadRequests.total_count > 0 
            ? `Ожидание (${loadRequests.total_count})` 
            : 'Ожидание';
    }
}

async function cancelFriendRequest(user_id) {
    const response = await window.electronAPI.invoke('cancelRelationship', {
        target_user: user_id
    });

    return response;
}

function showSuccessNotification(message, duration = 3000) {
    const notification = document.createElement('div');
    notification.className = 'success-notification';
    
    notification.innerHTML = `
        <i class="fas fa-check-circle"></i>
        <span>${message}</span>
        <span class="success-notification-close">&times;</span>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => notification.classList.add('show'), 10);
    
    notification.querySelector('.success-notification-close').addEventListener('click', () => {
        closeNotification(notification);
    });
    
    setTimeout(() => closeNotification(notification), duration);
    
    return notification;
}

function closeNotification(notification) {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
}
