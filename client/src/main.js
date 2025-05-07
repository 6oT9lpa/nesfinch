const { app, BrowserWindow, Menu, ipcMain, session } = require('electron');
const { authClient } = require('./clientgRPC');
const path = require('path');
const Store = require('electron-store').default;

const store = new Store({
    name: 'auth',
    encryptionKey: 'acff9326d873e7a27579295287dbf0581b73fc3c03c5ae77dbaac1f01806572c7fa9dc727b5e735825553cb158d6586b30b4ae486e372bcb23ad350377f86eb6ab4b761f2d72bdf96cfacae35249de4ff8869a230ebae853b195f1e1df1cd963d4582f80f0b8e825067b6836236905519b35a9b644b5e12df4aabc127b761d07' 
});

Menu.setApplicationMenu(null);

let mainWindow;

async function createWindow() {
    const secureSession = session.fromPartition('persist:secure', { cache: false });
    
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        resizable: true,
        frame: false,
        minWidth: 815,
        minHeight: 505,
        webPreferences: {
            session: secureSession,
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    const isAuthenticated = await checkAuth();
    
    if (isAuthenticated) {
        await mainWindow.loadFile(path.join(__dirname, '../renderer/views/index.html'));
    } else {
        await mainWindow.loadFile(path.join(__dirname, '../renderer/views/auth/register.html'));
    }
    
    mainWindow.webContents.openDevTools();
}

async function checkAuth() {
    try {
        const tokens = store.get('auth_tokens'); 
        if (!tokens || !tokens.accessToken) return false;

        await authClient.getMe();
        return true;
    } catch (err) {
        console.error('Auth check failed:', err);
        return false;
    }
}

ipcMain.on('set-auth-tokens', (_, tokens) => {
    store.set('auth_tokens', tokens);
    
    secureSession.cookies.set({
        url: 'http://localhost',
        name: 'access_token',
        value: tokens.accessToken,
        httpOnly: true,
        secure: true,
        expirationDate: new Date(Date.now() + 3600 * 1000) // 1 час
    });
    
    secureSession.cookies.set({
        url: 'http://localhost',
        name: 'refresh_token',
        value: tokens.refreshToken,
        httpOnly: true,
        secure: true,
        expirationDate: new Date(Date.now() + 7 * 24 * 3600 * 1000) // 7 дней
    });
});

ipcMain.handle('get-auth-tokens', async () => {
    const tokens = store.get('auth_tokens');
    if (!tokens) return null;
    
    const cookies = await secureSession.cookies.get({});
    const hasCookies = cookies.some(c => c.name === 'access_token');
    
    if (!hasCookies) {
        secureSession.cookies.set({
            url: 'http://localhost',
            name: 'access_token',
            value: tokens.accessToken,
            httpOnly: true,
            secure: true
        });
        
        secureSession.cookies.set({
            url: 'http://localhost',
            name: 'refresh_token',
            value: tokens.refreshToken,
            httpOnly: true,
            secure: true
        });
    }
    
    return tokens;
});

ipcMain.on('clear-auth-tokens', () => {
    store.delete('auth_tokens');
    secureSession.cookies.remove('http://localhost', 'access_token');
    secureSession.cookies.remove('http://localhost', 'refresh_token');
});

ipcMain.on('logout', () => {
    store.delete('auth_tokens');
    secureSession.cookies.remove('http://localhost', 'access_token');
    secureSession.cookies.remove('http://localhost', 'refresh_token');
    
    if (mainWindow) {
        mainWindow.loadFile(path.join(__dirname, '../renderer/views/auth/login.html'));
    }
});

ipcMain.handle('auth-signUpUser', async (_, data) => {
    try {
        return await authClient.signUpUser(data);
    } catch (error) {
        throw new Error(error.message);
    }
});

ipcMain.handle('auth-signInUser', async (_, data) => {
    try {
        return await authClient.signInUser(data);
    } catch (error) {
        throw new Error(error.message);
    }
});

ipcMain.handle('auth-getMe', async () => {
    try {
        return await authClient.getMe();
    } catch (error) {
        throw new Error(error.message);
    }
});

ipcMain.handle('auth-refreshToken', async (_, data) => {
    try {
        return await authClient.refreshToken(data);
    } catch (error) {
        throw new Error(error.message);
    }
});

// Обработчики IPC
ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.whenReady().then(createWindow);

