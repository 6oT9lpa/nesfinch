const { app, BrowserWindow, Menu, ipcMain, session } = require('electron');
const { authClient, searchClient, statusClient, relationshipClient } = require('./clientgRPC');
const path = require('path');
const store = require('./store');

Menu.setApplicationMenu(null);

let mainWindow;
let secureSession;

async function withTokenRefresh(fn) {
    try {
        return await fn();
    } catch (error) {
        if (error.code === 16) { 
            const refreshToken = store.get('refreshToken');
            if (!refreshToken) throw error;
            
            try {
                const newTokens = await authClient.refreshToken({
                    refresh_token: refreshToken
                });
                
                store.set('accessToken', newTokens.access_token);
                store.set('refreshToken', newTokens.refresh_token);
                
                return await fn();
            } catch (refreshError) {
                console.error("Token refresh failed:", refreshError);
                store.set('accessToken', null);
                store.set('refreshToken', null);
                throw refreshError;
            }
        }
        throw error;
    }
}

async function verifyUserSession() {
    try {
        const accessToken = store.get('accessToken');
        const refreshToken = store.get('refreshToken');

        if (!accessToken && !refreshToken) {
            return { isValid: false, user: null };
        }

        if (accessToken) {
            try {
                const { user } = await authClient.getMe({ access_token: accessToken });
                return { isValid: true, user };
            } catch (error) {
                if (error.code === 16 && refreshToken) { // Unauthorized
                    try {
                        const newTokens = await authClient.refreshToken({
                            refresh_token: refreshToken
                        });
                        
                        store.set('accessToken', newTokens.access_token);
                        store.set('refreshToken', newTokens.refresh_token);
                        
                        const { user } = await authClient.getMe({ 
                            access_token: newTokens.access_token 
                        });
                        return { isValid: true, user };
                    } catch (refreshError) {
                        console.error("Refresh failed:", refreshError);
                        store.set('accessToken', null);
                        store.set('refreshToken', null);
                        return { isValid: false, user: null };
                    }
                }
                store.set('accessToken', null);
                return { isValid: false, user: null };
            }
        }

        return { isValid: false, user: null };
    } catch (error) {
        console.error("Session verification error:", error);
        return { isValid: false, user: null };
    }
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
        width: 900,
        height: 600,
        resizable: true,
        frame: false,
        minWidth: 900,
        minHeight: 505,
        webPreferences: {
            session: secureSession,
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    try {
        const { isValid, user } = await verifyUserSession();

        if (!isValid) {
            await mainWindow.loadFile(path.join(__dirname, '../renderer/views/auth/login.html'));
            return;
        }

        await setupUserStatusHandling(user);

        await statusClient.updateStatus({
            userId: user.id,
            status: 'ONLINE'
        });
        
        mainWindow.webContents.on('did-finish-load', async () => {
            try {
                const { isValid, user } = await verifyUserSession();
                if (isValid && user) {
                    store.set('userData', user);
                    mainWindow.webContents.send('user-data', user);
                }
            } catch (error) {
                console.error("Failed to send user data:", error);
            }
        });

        await mainWindow.loadFile(path.join(__dirname, '../renderer/views/index.html'));

    } catch (error) {
        console.error("Failed to initialize app:", error);
        await mainWindow.loadFile(path.join(__dirname, '../renderer/views/auth/login.html'));
    }

    mainWindow.webContents.openDevTools();
}

ipcMain.on('set-auth-tokens', (_, tokens) => {
    store.set('accessToken', tokens.access_token);
    store.set('refreshToken', tokens.refresh_token);
});

ipcMain.handle('get-auth-tokens', () => {
    return {
        access_token: store.get('accessToken'),
        refresh_token: store.get('refreshToken')
    };
});

ipcMain.on('clear-auth-tokens', () => {
    store.set('accessToken', null);
    store.set('refreshToken', null);
});

ipcMain.on('logout', async () => {
    const token = store.get('accessToken');
    
    try {
        if (token) {
            const { user } = await withTokenRefresh(async () => {
                return await authClient.getMe({ access_token: token });
            });
            await statusClient.updateStatus({
                userId: user.id,
                status: 'OFFLINE'
            });
        }
    } catch (error) {
        console.error('Failed to set offline status:', error);
    }

    store.set('accessToken', null);
    store.set('refreshToken', null);

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
        store.set('userData', response.user); 
        
        console.log("signInUser: ", response);

        await setupUserStatusHandling(response.user);
        await statusClient.updateStatus({
            userId: response.user.id,
            status: 'ONLINE'
        });

        if (mainWindow) {
            mainWindow.webContents.send('user-data', response.user);
        }

        return response;
    } catch (error) {
        throw new Error(error.message);
    }
});

ipcMain.handle('getMe', async (_, { access_token }) => {
    return withTokenRefresh(async () => {
        return await authClient.getMe({ access_token });
    });
});

ipcMain.handle('getSearch', async (_, { name, type }) => {
    try {
        return await searchClient.getSearch({ name, type });
    } catch (error) {
        throw new Error(error.message);
    }
});

ipcMain.handle('createRelationship', async (_, data) => {
    return withTokenRefresh(async () => {
        const token = store.get('accessToken');
        const { user } = await authClient.getMe({ access_token: token });
        data.current_user = user.id;
        return await relationshipClient.createRelationship(data);
    });
});

ipcMain.handle('updateRelationship', async (_, data) => {
    return withTokenRefresh(async () => {
        const token = store.get('accessToken');
        const { user } = await authClient.getMe({ access_token: token });
        data.current_user = user.id;
        return await relationshipClient.updateRelationship(data);
    });
});

ipcMain.handle('getRelationshipStatus', async (_, data) => {
    return withTokenRefresh(async () => {
        const token = store.get('accessToken');
        const { user } = await authClient.getMe({ access_token: token });
        data.current_user = user.id;
        return await relationshipClient.getRelationshipStatus(data);
    });
});

ipcMain.handle('getRelationships', async (_, data) => {
    return withTokenRefresh(async () => {
        const token = store.get('accessToken');
        const { user } = await authClient.getMe({ access_token: token });
        data.current_user = user.id;
        return await relationshipClient.getRelationships(data);
    });
});

ipcMain.handle('cancelRelationship', async (_, data) => {
    return withTokenRefresh(async () => {
        const token = store.get('accessToken');
        const { user } = await authClient.getMe({ access_token: token });
        data.current_user = user.id;
        return await relationshipClient.cancelRelationship(data);
    });
});

ipcMain.on('window-minimize', async () => {
    if (mainWindow) mainWindow.minimize();
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
        try {
            const { user } = await withTokenRefresh(async () => {
                return await authClient.getMe({ access_token: token });
            });
            await statusClient.updateStatus({
                userId: user.id,
                status: 'ONLINE'
            });
        } catch (error) {
            console.error('Failed to update status:', error);
        }
    }
});

ipcMain.on('window-close', async () => {
    const token = store.get('accessToken');
    if (token) {
        try {
            const { user } = await withTokenRefresh(async () => {
                return await authClient.getMe({ access_token: token });
            });
            await statusClient.updateStatus({
                userId: user.id,
                status: 'OFFLINE'
            });
        } catch (error) {
            console.error('Failed to update status:', error);
        }
    }
    
    if (mainWindow) mainWindow.close();
});

app.on('window-all-closed', async() => {
    const token = store.get('accessToken');
    if (token) {
        try {
            const { user } = await withTokenRefresh(async () => {
                return await authClient.getMe({ access_token: token });
            });
            await statusClient.updateStatus({
                userId: user.id,
                status: 'OFFLINE'
            });
        } catch (error) {
            console.error('Failed to update status:', error);
        }
    }

    if (process.platform !== 'darwin') app.quit();
});

app.whenReady().then(async () => {
    await createWindow();
});