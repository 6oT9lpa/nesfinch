const { app, BrowserWindow, Menu, ipcMain, session } = require('electron');
const { authClient, searchClient } = require('./clientgRPC');
const path = require('path');
const Store = require('electron-store').default;

const store = new Store({
    name: 'auth-tokens',
    encryptionKey: 'acff9326d873e7a27579295287dbf0581b73fc3c03c5ae77dbaac1f01806572c7fa9dc727b5e735825553cb158d6586b30b4ae486e372bcb23ad350377f86eb6ab4b761f2d72bdf96cfacae35249de4ff8869a230ebae853b195f1e1df1cd963d4582f80f0b8e825067b6836236905519b35a9b644b5e12df4aabc127b761d07' 
});

Menu.setApplicationMenu(null);

let mainWindow;
let secureSession;

async function verifyUserSession() {
    const tokens = {
        accessToken: store.get('accessToken'),
        refreshToken: store.get('refreshToken'),
    };

    if (!tokens.accessToken) return false;

    try {
        await authClient.getMe({ access_token: tokens.accessToken });
        return true;
    } catch (error) {
        if (tokens.refreshToken) {
        try {
            const newTokens = await authClient.refreshToken({
            refresh_token: tokens.refreshToken,
            });
            
            store.set('accessToken', newTokens.access_token);
            store.set('refreshToken', newTokens.refresh_token);
            return true;
        } catch (refreshError) {
            store.clear();
            return false;
        }
        }
        store.clear();
        return false;
    }
}

async function createWindow() {
    secureSession = session.fromPartition('persist:secure', { cache: false });
    
    const isAuthenticated = await verifyUserSession();
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

    const tokens = store.get('tokens') || {};
    
    if (tokens.accessToken) {
        try {
            await authClient.getMe({ access_token: tokens.accessToken });
            await mainWindow.loadFile(path.join(__dirname, '../renderer/views/index.html'));
        } catch (error) {
            if (tokens.refreshToken) {
                try {
                    const newTokens = await authClient.refreshToken({ 
                        refresh_token: tokens.refreshToken 
                    });
                    
                    store.set('tokens', {
                        accessToken: newTokens.access_token,
                        refreshToken: newTokens.refresh_token
                    });
                    await mainWindow.loadFile(path.join(__dirname, '../renderer/views/index.html'));
                } catch (refreshError) {
                    console.error('Refresh failed:', refreshError);
                    store.delete('tokens');
                    await mainWindow.loadFile(path.join(__dirname, '../renderer/views/auth/login.html'));
                }
            } else {
                store.delete('tokens');
                await mainWindow.loadFile(path.join(__dirname, '../renderer/views/auth/login.html'));
            }
        }
    } else {
        await mainWindow.loadFile(path.join(__dirname, '../renderer/views/auth/login.html'));
    }
    
    mainWindow.webContents.openDevTools();
}

ipcMain.on('set-auth-tokens', (_, tokens) => {
    store.set('tokens', tokens);
});

ipcMain.handle('get-auth-tokens', () => {
    return store.get('tokens') || {};
});

ipcMain.on('clear-auth-tokens', () => {
    store.delete('tokens');
});

ipcMain.on('logout', () => {
    store.delete('tokens');
    if (mainWindow) {
        mainWindow.loadFile(path.join(__dirname, '../renderer/auth/login.html'));
    }
});

ipcMain.handle('signUpUser', async (_, data) => {
    try {
        return await authClient.signUpUser(data);
    } catch (error) {
        throw new Error(error.message);
    }
});

ipcMain.handle('signInUser', async (_, data) => {
    try {
        return await authClient.signInUser(data);
    } catch (error) {
        throw new Error(error.message);
    }
});

ipcMain.handle('getMe', async (_, { access_token }) => {
    try {
        return await authClient.getMe({ access_token });
    } catch (error) {
        throw new Error(error.message);
    }
});

ipcMain.handle('getSearch', async (_, { name, type }) => {
    try {
        return await searchClient.getSearch({ name, type });
    } catch (error) {
        throw new Error(error.message);
    }
});

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

app.whenReady().then(async () => {
    await createWindow();
});