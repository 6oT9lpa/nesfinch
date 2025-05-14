const { app, BrowserWindow, Menu, ipcMain, session } = require('electron');
const { authClient, searchClient, statusClient, relationshipClient } = require('./clientgRPC');
const path = require('path');
const store  = require('./store');

Menu.setApplicationMenu(null);

let mainWindow;
let secureSession;

async function verifyUserSession() {
    const tokens = {
        accessToken: store.get('accessToken'),
        refreshToken: store.get('refreshToken'),
    };

    console.log("Current tokens:", tokens);

    if (!tokens.accessToken && !tokens.refreshToken) {
        console.log("No tokens found");
        return { isValid: false, user: null };
    }

    if (tokens.accessToken) {
        try {
            const user = await authClient.getMe({ access_token: tokens.accessToken });
            console.log("Access token is valid");
            return { isValid: true, user };
        } catch (error) {
            console.error("Access token validation failed:", error);
            store.delete('accessToken');
        }
    }

    if (tokens.refreshToken) {
        try {
            console.log("Attempting to refresh tokens");
            const newTokens = await authClient.refreshToken({
                refresh_token: tokens.refreshToken,
            });

            console.log("New tokens received:", newTokens);
            store.set('accessToken', newTokens.access_token);
            store.set('refreshToken', newTokens.refresh_token);
            
            console.log("access token: ", newTokens.access_token)
            const user = await authClient.getMe({ access_token: newTokens.access_token });
            console.log("Tokens refreshed successfully");
            return { isValid: true, user };
        } catch (refreshError) {
            console.error("Refresh token failed:", refreshError);
            store.clear();
            return { isValid: false, user: null };
        }
    }

    return { isValid: false, user: null };
}

async function setupUserStatusHandling(user) {
    try {
        console.log("User Handling: ", user);

        const call = await statusClient.subscribeToStatusUpdates(user.id);

        call.on('data', (update) => {
            console.log("update: ", update);
            mainWindow.webContents.send('status-update', {
                userId: update.userId,
                status: update.status
            });
        });

        call.on('error', (err) => {
            console.error("Stream error:", err);
            setTimeout(() => setupUserStatusHandling(user), 5000);
        });

        call.on('end', () => {
            console.log("Stream ended");
        });

    } catch (error) {
        console.error('Failed to setup user status handling:', error);
    }
}

async function createWindow() {
    secureSession = session.fromPartition('persist:secure', { cache: false });
    
    mainWindow = new BrowserWindow({
        width: 850,
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

    const token = store.get('accessToken')

    try {
        const { isValid } = await verifyUserSession();

        if (!isValid) {
            await mainWindow.loadFile(path.join(__dirname, '../renderer/views/auth/login.html'));
            return;
        }
        const { user } = await authClient.getMe({ access_token: token });
        await setupUserStatusHandling(user);
        
        mainWindow.webContents.on('did-finish-load', () => {
            mainWindow.webContents.send('user-data', user);
        });

        await mainWindow.loadFile(path.join(__dirname, '../renderer/views/index.html'));
    } catch (error) {
        console.error("Failed to initialize app:", error);
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

ipcMain.on('logout', async () => {
    const token = store.get('accessToken');
    
    try {
        if (token) {
            const { user } = await authClient.getMe({ access_token: token });
            await statusClient.updateStatus({
                userId: user.id,
                status: 'OFFLINE'
            });
        }
    } catch (error) {
        console.error('Failed to set offline status:', error);
    }

    store.clear();

    if (secureSession) {
        await secureSession.clearStorageData({
            storages: ['cookies', 'localstorage', 'indexdb', 'websql']
        });
        await secureSession.clearCache();
        await secureSession.clearAuthCache();
        await secureSession.clearHostResolverCache();
    }

    if (mainWindow) {
        await mainWindow.loadFile(path.join(__dirname, '../renderer/views/auth/login.html'));
        mainWindow.webContents.reloadIgnoringCache();
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
        const response = await authClient.signInUser(data);
        store.set('accessToken', response.access_token);
        store.set('refreshToken', response.refresh_token);

        console.log("singInUser: ", response);

        await setupUserStatusHandling(response.user);

        await statusClient.updateStatus({
            userId: response.user.id,
            status: 'ONLINE'
        });

        return response;
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

ipcMain.handle('createRelationship', async (_, data) => {
    try {
        const token = store.get('accessToken');
        const { user } = await authClient.getMe({ access_token: token });
        data.current_user = user.id;
        return await relationshipClient.createRelationship(data);
    } catch (error) {
        throw new Error(error.message);
    }
});

ipcMain.handle('updateRelationship', async (_, data) => {
    try {
        const token = store.get('accessToken');
        const { user } = await authClient.getMe({ access_token: token });
        data.current_user = user.id;
        return await relationshipClient.updateRelationship(data);
    } catch (error) {
        throw new Error(error.message);
    }
});

ipcMain.handle('getRelationshipStatus', async (_, data) => {
    try {
        const token = store.get('accessToken');
        const { user } = await authClient.getMe({ access_token: token });
        data.current_user = user.id;
        return await relationshipClient.getRelationshipStatus(data);
    } catch (error) {
        throw new Error(error.message);
    }
});

ipcMain.handle('getRelationships', async (_, data) => {
    try {
        const token = store.get('accessToken');
        const { user } = await authClient.getMe({ access_token: token });

        data.current_user = user.id;
        return await relationshipClient.getRelationships(data);
    } catch (error) {
        throw new Error(error.message);
    }
});

ipcMain.handle('cancelRelationship', async (_, data) => {
    try {
        const token = store.get('accessToken');
        const { user } = await authClient.getMe({ access_token: token });
        data.current_user = user.id;

        return await relationshipClient.cancelRelationship(data);
    } catch (error) {
        throw new Error(error.message);
    }
});

ipcMain.on('window-minimize', async () => {
    if (mainWindow) mainWindow.minimize();

    const token = store.get('accessToken');
    if (token) {
        const { user } = await authClient.getMe({ access_token: token });

        await statusClient.updateStatus({
            userId: user.id,
            status: 'IDLE'
        });
    }
});

ipcMain.on('window-maximize', async () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
    const token = store.get('accessToken');
    if (token) {
        const { user } = await authClient.getMe({ access_token: token });

        await statusClient.updateStatus({
            userId: user.id,
            status: 'ONLINE'
        });
    }
});

ipcMain.on('window-close', async () => {
    const token = store.get('accessToken');
    if (token) {
        const { user } = await authClient.getMe({ access_token: token });

        await statusClient.updateStatus({
            userId: user.id,
            status: 'OFFLINE'
        });
    }
    
    if (mainWindow) mainWindow.close();
});

app.on('window-all-closed', async() => {
    const token = store.get('accessToken');
    if (token) {
        const { user } = await authClient.getMe({ access_token: token });

        await statusClient.updateStatus({
            userId: user.id,
            status: 'OFFLINE'
        });
    }

    if (process.platform !== 'darwin') app.quit();
});

app.whenReady().then(async () => {
    await createWindow();
});