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

    createRelationship: (data) => ipcRenderer.invoke('createRelationship', data),
    updateRelationship: (data) => ipcRenderer.invoke('updateRelationship', data),
    getRelationshipStatus: (data) => ipcRenderer.invoke('getRelationshipStatus', data),
    getRelationships: (data) => ipcRenderer.invoke('getRelationships', data),
    cancelRelationship: (data) => ipcRenderer.invoke('cancelRelationship', data),
    
    onRelationshipUpdate: (callback) => {
        ipcRenderer.removeAllListeners('relationship-update');
        ipcRenderer.on('relationship-update', (event, update) => callback(update));
    },
});