document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('theme-toggle');
    const themes = ['light', 'dark', 'coal', 'warm'];
    let currentThemeIndex = 0;
    
    const getPreferredTheme = () => {
        const storedTheme = localStorage.getItem('theme');
        if (storedTheme && themes.includes(storedTheme)) {
            return storedTheme;
        }
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };
    
    const currentTheme = getPreferredTheme();
    currentThemeIndex = themes.indexOf(currentTheme);
    if (currentThemeIndex === -1) currentThemeIndex = 0;
    document.documentElement.setAttribute('data-theme', themes[currentThemeIndex]);
    updateButtonText();
    
    function updateButtonText() {
        const nextThemeIndex = (currentThemeIndex + 1) % themes.length;
        themeToggle.textContent = `Переключить на ${getThemeName(themes[nextThemeIndex])}`;
    }
    
    function getThemeName(theme) {
        switch(theme) {
            case 'light': return 'Светлую';
            case 'dark': return 'Тёмную';
            case 'coal': return 'Пепельную';
            case 'warm': return 'Тёплую';
            default: return '';
        }
    }
    
    themeToggle.addEventListener('click', () => {
        currentThemeIndex = (currentThemeIndex + 1) % themes.length;
        const newTheme = themes[currentThemeIndex];
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateButtonText();
    });
    
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('theme')) {
            const newTheme = e.matches ? 'dark' : 'light';
            currentThemeIndex = themes.indexOf(newTheme);
            document.documentElement.setAttribute('data-theme', newTheme);
            updateButtonText();
        }
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.querySelector('.sidebar');
    const resizeHandle = document.querySelector('.resize-handle');
    const overlay = document.querySelector('.info-block-overlay');
    const asideWidth = 65; 

    const savedWidth = localStorage.getItem('sidebarWidth') || 240;
    overlay.style.width = `${savedWidth + 30}px`
    sidebar.style.width = `${savedWidth}px`;
    updateInfoBlockWidth(parseInt(savedWidth));

    let isResizing = false;
    let lastDownX = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        lastDownX = e.clientX;
        document.body.style.cursor = 'col-resize';
        e.preventDefault(); 
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const offset = e.clientX - lastDownX;
        let newWidth = sidebar.offsetWidth + offset;
        
        newWidth = Math.max(215, Math.min(newWidth, 330));
        
        sidebar.style.width = `${newWidth}px`;
        lastDownX = e.clientX;
        
        localStorage.setItem('sidebarWidth', newWidth);
        updateInfoBlockWidth(newWidth);
    });

    document.addEventListener('mouseup', () => {
        isResizing = false;
        document.body.style.cursor = '';
    });

    function updateInfoBlockWidth(sidebarWidth) {
        overlay.style.width = `${sidebarWidth + 30}px`;
        document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
    }
});

document.querySelectorAll('.hot-btn-info a').forEach(button => {
    const btnId = button.dataset.btnId;
    
    const savedButtons = JSON.parse(localStorage.getItem('activeHotButtons')) || [];
    if (savedButtons.includes(btnId)) {
        button.classList.add('active');
    }

    button.addEventListener('click', (e) => {
        e.preventDefault();
        button.classList.toggle('active');
        
        const activeButtons = Array.from(document.querySelectorAll('.hot-btn-info a.active'))
            .map(btn => btn.dataset.btnId);
        
        localStorage.setItem('activeHotButtons', JSON.stringify(activeButtons));
    });
});
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('close-button')?.addEventListener('click', () => {
        window.electronAPI.windowClose();
    });

    document.getElementById('min-button')?.addEventListener('click', () => {
        window.electronAPI.windowMinimize();
    });

    document.getElementById('max-button')?.addEventListener('click', () => {
        window.electronAPI.windowMaximize();
    });
});

document.getElementById('help-button').addEventListener('click', () => {
    alert('Это справка по приложению. Здесь можно вывести документацию или ссылку на сайт.');
});


document.getElementById('open-btn-search').addEventListener('click', (e) => {
    e.preventDefault();
    showModal('search-contanier');
});

document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') { 
        hideModal('search-contanier');
    }
});

document.getElementById('search-contanier').addEventListener('click', function(event) {
    if (event.target === this) { 
        hideModal('search-contanier');
    }
});

function showModal(modalID) {
    let modal = document.getElementById(modalID);
    modal.style.display = 'block';
}

function hideModal(modalID) {
    let modal = document.getElementById(modalID);
    modal.style.display = 'none';
}

let searchTimeout = null;
document.getElementById('search-input').addEventListener('input', (e) => {
    const searchTerm = e.target.value.trim();

    clearTimeout(searchTimeout);

    if (searchTerm === '') {
        const searchBox = document.getElementById('search-box');
        if (searchBox) {
            searchBox.innerHTML = '<p>НЕДАВНИЕ ОБЩЕНИЯ</p>';
        }
        return;
    }

    searchTimeout = setTimeout(async () => {
        try {
            let searchType = 'SearchUnspecified';
            if (searchTerm.startsWith('@')) {
                searchType = 'SearchUser';
            } else if (searchTerm.startsWith('&')) {
                searchType = 'SearchServer';
            }

            const searchTermForApi = searchTerm.startsWith('@') || searchTerm.startsWith('&') 
                ? searchTerm.substring(1) 
                : searchTerm;

            const response = await window.electronAPI.invoke('getSearch', {
                name: searchTermForApi,
                type: searchType
            });

            displaySearchResults(response);
        } catch (error) {
            console.error('Search error:', error);
            const searchBox = document.getElementById('search-box');
            if (searchBox) {
                searchBox.innerHTML = '<p>Ошибка при выполнении поиска</p>';
            }
        }
    }, 500); 
});

function displaySearchResults(results) {
    const resultsContainer = document.getElementById('search-box');
    if (!resultsContainer) return;
    
    resultsContainer.innerHTML = '';
    
    if ((!results.users || results.users.length === 0) && 
        (!results.servers || results.servers.length === 0)) {
        resultsContainer.innerHTML = '<p>Ничего не найдено</p>';
        return;
    }
    
    // Показываем пользователей
    if (results.users && results.users.length > 0) {
        const usersHeader = document.createElement('p');
        usersHeader.textContent = 'ПОИСК ПО ПОЛЬЗОВАТЕЛЯМ';
        resultsContainer.appendChild(usersHeader);
        
        results.users.forEach(user => {
            const userElement = document.createElement('div');
            userElement.className = 'search-result-item';
            userElement.innerHTML = `
                <span class="username">@${user.username}</span>
                <span class="status">${user.status}</span>
            `;
            resultsContainer.appendChild(userElement);
        });
    }
    
    if (results.servers && results.servers.length > 0) {
        const serversHeader = document.createElement('p');
        serversHeader.textContent = 'ПОИСК ПО СЕРВЕРАМ';
        resultsContainer.appendChild(serversHeader);
        
        results.servers.forEach(server => {
            const serverElement = document.createElement('div');
            serverElement.className = 'search-result-item';
            serverElement.innerHTML = `
                <span class="server-name">&${server.name}</span>
            `;
            resultsContainer.appendChild(serverElement);
        });
    }
}