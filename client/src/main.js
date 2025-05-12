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

    console.log("accessToken: ", tokens.accessToken);
    console.log("refreshToken", tokens.refreshToken);

    if (!tokens.accessToken) {
        return { isValid: false, user: null };
    }

    try {
        const user = await authClient.getMe({ access_token: tokens.accessToken });

        if (tokens.refreshToken) {
            try {
                const newTokens = await authClient.refreshToken({
                    refresh_token: tokens.refreshToken,
                });
                store.set('accessToken', newTokens.access_token);
                store.set('refreshToken', newTokens.refresh_token);
            } catch (refreshError) {
                console.error("Refresh token failed:", refreshError);
            }
        }

        return { isValid: true, user };
    } catch (error) {
        console.error("Session verification failed:", error);
        store.clear();
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

        app.on('before-quit', async () => {
            try {
                await statusClient.updateStatus({
                    userId: user.id,
                    status: 'OFFLINE'
                });
            } catch (err) {
                console.error('Failed to update status on app quit:', err);
            }
        });

    } catch (error) {
        console.error('Failed to setup user status handling:', error);
    }
}

async function createWindow() {
    secureSession = session.fromPartition('persist:secure', { cache: false });
    
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
    const { user } = await authClient.getMe({ access_token: token });

    try {
        await statusClient.updateStatus({
            userId: user.id,
            status: 'OFFLINE'
        });
    } catch (error) {
        console.error('Failed to set offline status:', error);
    }
    store.clear();

    if (mainWindow) {
        await mainWindow.loadFile(path.join(__dirname, '../renderer/views/auth/login.html'));
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

        if (response.user && response.user.user.id) {
            await statusClient.updateStatus({
                userId: response.user.user.id,
                status: 'ONLINE'
            });
        }

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

ipcMain.handle('relationship-create', async (_, data) => {
    return new Promise((resolve, reject) => {
        relationshipClient.create_relationship(data, (err, res) => {
            if (err) return reject(err);
            resolve(res);
        });
    });
});

ipcMain.handle('relationship-update', async (_, data) => {
    return new Promise((resolve, reject) => {
        relationshipClient.update_relationship(data, (err, res) => {
            if (err) return reject(err);
            resolve(res);
        });
    });
});

ipcMain.handle('relationship-get-all', async (_, data) => {
    return new Promise((resolve, reject) => {
        relationshipClient.get_relationships(data, (err, res) => {
            if (err) return reject(err);
            resolve(res);
        });
    });
});

ipcMain.handle('relationship-get-status', async (_, data) => {
    return new Promise((resolve, reject) => {
        relationshipClient.get_relationship_status(data, (err, res) => {
            if (err) return reject(err);
            resolve(res);
        });
    });
});

ipcMain.on('window-minimize', async () => {
    if (mainWindow) mainWindow.minimize();

    const token = store.get('accessToken');
    const { user } = await authClient.getMe({ access_token: token });

    try {
        await statusClient.updateStatus({
            userId: user.id,
            status: 'IDLE'
        });
    } catch (err) {
        console.error('Failed to update status on window hide:', err);
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
    const { user } = await authClient.getMe({ access_token: token });

    try {
        await statusClient.updateStatus({
            userId: user.id,
            status: 'ONLINE'
        });
    } catch (err) {
        console.error('Failed to update status on window show:', err);
    }
});

ipcMain.on('window-close', async () => {
    const token = store.get('accessToken');
    const { user } = await authClient.getMe({ access_token: token });

    await statusClient.updateStatus({
        userId: user.id,
        status: 'OFFLINE'
    });

    if (mainWindow) mainWindow.close();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.whenReady().then(async () => {
    await createWindow();
});