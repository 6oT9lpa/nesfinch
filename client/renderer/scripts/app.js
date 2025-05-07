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
