// client_authgRPC.js
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const { hashPassword, hashPhone } = require('./crypto-utils');

const PROTO_PATHS = [
    path.join(__dirname, '../../proto/service_auth.proto'),
    path.join(__dirname, '../../proto/service_communication.proto'),
    path.join(__dirname, '../../proto/service_status.proto')
];

const packageDefinition = protoLoader.loadSync(PROTO_PATHS, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);

const AuthService = protoDescriptor.auth.AuthService;
const RelationshipService = protoDescriptor.communication.RelationshipService;
const SearchService = protoDescriptor.communication.SearchService;
const StatusService = protoDescriptor.status.StatusService;

const client_auth = new AuthService('localhost:50051', grpc.credentials.createInsecure());
const client_search = new SearchService('localhost:50051', grpc.credentials.createInsecure());
const client_status = new StatusService('localhost:50051', grpc.credentials.createInsecure());

// Клиентские методы
const authClient = {
    signUpUser: async ({ username, phone, email, password }) => {
        const password_hash = await hashPassword(password);
        const phone_hash = hashPhone(phone);

        console.log(phone);
        
        return new Promise((resolve, reject) => {
            client_auth.signUpUser({ 
                username, 
                phone: phone_hash, 
                email, 
                pasw: password_hash 
            }, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            });
        });
    },

    signInUser: async ({ phone, password }) => {
        const phone_hash = hashPhone(phone); 

        return new Promise((resolve, reject) => {
            client_auth.signInUser({ 
                phone: phone_hash, 
                password 
            }, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            });
        });
    },

    getMe: async ({ access_token }) => {
        return new Promise((resolve, reject) => {
            client_auth.getMe({ access_token }, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            });
        });
    },

    refreshToken: async ({ refresh_token }) => {
        return new Promise((resolve, reject) => {
            client_auth.refreshToken({ refresh_token }, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            });
        });
    }
};

const relationsipClient = {

};

const statusClient = {
    updateStatus: async ({ userId, status }) => {
        const statusMap = {
            'ONLINE': 0,
            'OFFLINE': 1,
            'IDLE': 2,
            'DO_NOT_DISTURB': 3
        };
        
        const statusCode = statusMap[status.toUpperCase()];
        if (statusCode === undefined) {
            throw new Error('Invalid status value');
        }

        return new Promise((resolve, reject) => {
            client_status.updateStatus({
                user_id: userId,
                status: statusCode
            }, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            });
        });
    },

    subscribeToStatusUpdates: (userId) => {
        return new Promise((resolve, reject) => {
            const call = client_status.subscribeToStatusUpdates({ user_id: userId });

            const statusUpdatesStream = {
                on: (event, callback) => {
                    if (event === 'data') {
                        call.on('data', (statusUpdate) => {

                            const statusMap = {
                                0: 'ONLINE',
                                1: 'OFFLINE',
                                2: 'IDLE',
                                3: 'DO_NOT_DISTURB'
                            };
                            
                            callback({
                                userId: statusUpdate.user_id,
                                status: statusMap[statusUpdate.status] || 'OFFLINE'
                            });
                        });
                    } else if (event === 'error') {
                        call.on('error', callback);
                    } else if (event === 'end') {
                        call.on('end', callback);
                    }
                },
                cancel: () => {
                    call.cancel();
                }
            };

            resolve(statusUpdatesStream);
        });
    },

    getUserStatus: async (userId) => {
        return new Promise((resolve, reject) => {
            client_status.getUserStatus({ user_id: userId }, (err, response) => {
                if (err) return reject(err);
                
                const statusMap = {
                    0: 'ONLINE',
                    1: 'OFFLINE',
                    2: 'IDLE',
                    3: 'DO_NOT_DISTURB'
                };
                
                resolve({
                    userId: response.user_id,
                    status: statusMap[response.status] || 'OFFLINE',
                    lastSeen: response.last_seen
                });
            });
        });
    }
};

const searchClient = {
    getSearch: async ({ name, type }) => {
        const request = {
            name,  
            type   
        };

        return new Promise((resolve, reject) => {
            client_search .getSearch(request, (err, response) => {
                if (err) return reject(err); 
                resolve(response); 
            });
        });
    }
};

module.exports = { authClient, relationsipClient, searchClient, statusClient };