document.addEventListener('DOMContentLoaded', async () => {
    try {
        const tokens = await window.electronAPI.getAuthTokens();
        if (tokens.accessToken) {
            await window.electronAPI.invoke('getMe', { 
                access_token: tokens.accessToken 
            });
            window.location.href = '../index.html';
        }
    } catch (error) {
        console.log('Требуется авторизация');
    }
    
    initWindowControls();
    initHelpButton();
    initNavigationLinks();
});

function initWindowControls() {
    document.getElementById('close-button')?.addEventListener('click', () => {
        window.electronAPI?.windowClose();
    });

    document.getElementById('min-button')?.addEventListener('click', () => {
        window.electronAPI?.windowMinimize();
    });

    document.getElementById('max-button')?.addEventListener('click', () => {
        window.electronAPI?.windowMaximize();
    });
}

function initHelpButton() {
    document.getElementById('help-button')?.addEventListener('click', () => {
        animateElement(document.getElementById('help-button'));
        showHelpMessage();
    });
}

function initNavigationLinks() {
    document.getElementById('registerLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        navigateWithAnimation('register.html');
    });

    document.getElementById('loginLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        navigateWithAnimation('login.html');
    });
}

function validateForm(form, formData) {
    let isValid = true;
    
    if (form.id === 'loginForm') {
        if (!formData.phone) {
            showInputError(form.querySelector('#phone'), 'Введите номер телефона');
            isValid = false;
        }
        
        if (!formData.password|| formData.password.length < 8) {
            showInputError(form.querySelector('#password'), 'Пароль должен содержать минимум 8 символов');
            isValid = false;
        }
    } 
    else if (form.id === 'registerForm') {
        if (!formData.username || formData.username.length < 3) {
            showInputError(form.querySelector('#username'), 'Имя должно содержать минимум 3 символа');
            isValid = false;
        }
        
        if (!formData.phone || !/^[\d\+][\d\(\)\ -]{4,14}\d$/.test(formData.phone)) {
            showInputError(form.querySelector('#phone'), 'Введите корректный номер телефона');
            isValid = false;
        }
        
        if (!formData.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            showInputError(form.querySelector('#email'), 'Введите корректный email');
            isValid = false;
        }
        
        if (!formData.password || formData.password.length < 8) {
            showInputError(form.querySelector('#password'), 'Пароль должен содержать минимум 8 символов');
            isValid = false;
        }
    }
    
    return isValid;
}

function showInputError(input, message) {
    if (!input) return;
    
    const formGroup = input.closest('.form-group');
    if (!formGroup) return;
    
    // Удаляем старые сообщения об ошибках
    const existingError = formGroup.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }
    
    // Создаем новое сообщение об ошибке
    const errorElement = document.createElement('div');
    errorElement.className = 'error-message';
    errorElement.textContent = message;
    formGroup.appendChild(errorElement);
    
    // Анимация ошибки
    formGroup.classList.add('error');
    setTimeout(() => {
        formGroup.classList.remove('error');
    }, 300);
}

function showFormError(form, message) {
    const errorContainer = form.querySelector('.form-error') || createFormErrorContainer(form);
    errorContainer.textContent = message;
    errorContainer.style.opacity = '1';
    
    setTimeout(() => {
        errorContainer.style.opacity = '0';
    }, 3000);
}

function createFormErrorContainer(form) {
    const container = document.createElement('div');
    container.className = 'form-error';
    form.appendChild(container);
    return container;
}

function navigateWithAnimation(href) {
    const authForm = document.querySelector('.auth-form');
    if (authForm) {
        authForm.classList.add('exiting');
        setTimeout(() => {
            window.location.href = href;
        }, 400);
    } else {
        window.location.href = href;
    }
}

document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = {
        username: e.target.username.value,
        phone: e.target.phone.value,
        email: e.target.email.value,
        password: e.target.password.value
    };

    if (!validateForm(e.target, formData)) return;

    try {
        const response = await window.electronAPI.invoke('signUpUser', formData);
        
        if (response.user) {
            const loginResponse = await window.electronAPI.invoke('signInUser', {
                phone: formData.phone,
                password: formData.password
            });
            
            await window.electronAPI.setAuthTokens({
                accessToken: loginResponse.access_token,
                refreshToken: loginResponse.refresh_token
            });

            navigateWithAnimation('../index.html');
        }
    } catch (error) {
        console.error('Registration error:', error);
        showFormError(e.target, error.message || 'Ошибка регистрации');
    }
});

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = {
        phone: e.target.phone.value,
        password: e.target.password.value
    };
    
    if (!validateForm(e.target, formData)) return;

    try {
        const loginResponse = await window.electronAPI.invoke('signInUser', {
            phone: formData.phone,
            password: formData.password
        });

        console.log(loginResponse);
        
        await window.electronAPI.setAuthTokens({
            accessToken: loginResponse.access_token,
            refreshToken: loginResponse.refresh_token
        });
        navigateWithAnimation('../index.html');
        
    } catch (error) {
        console.error('Login error:', error);
        showFormError(e.target, error.message || 'Ошибка регистрации');
    }
});
