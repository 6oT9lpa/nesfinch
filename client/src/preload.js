const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    windowClose: () => ipcRenderer.send('window-close'),
    windowMinimize: () => ipcRenderer.send('window-minimize'),
    windowMaximize: () => ipcRenderer.send('window-maximize'),

    setAuthTokens: (tokens) => ipcRenderer.send('set-auth-tokens', tokens),
    getAuthTokens: () => ipcRenderer.invoke('get-auth-tokens'),
    clearAuthTokens: () => ipcRenderer.send('clear-auth-tokens'),

    logout: () => ipcRenderer.send('logout'),
    invoke: (method, data) => ipcRenderer.invoke(method, data),
    
    removeStatusUpdateListener: () => ipcRenderer.removeAllListeners('status-update'),
    setUserStatus: async (status) => ipcRenderer.invoke('set-user-status', status),

    onUserData: (callback) => ipcRenderer.on('user-data', (event, user) => callback(user)),
    onStatusUpdate: (callback) => {
        ipcRenderer.removeAllListeners('status-update');
        ipcRenderer.on('status-update', (event, update) => callback(update));
    },

    createRelationship: (data) => ipcRenderer.invoke('relationship-create', data),
    updateRelationship: (data) => ipcRenderer.invoke('relationship-update', data),
    getRelationships: (data) => ipcRenderer.invoke('relationship-get-all', data),
    getRelationshipStatus: (data) => ipcRenderer.invoke('relationship-get-status', data),
});