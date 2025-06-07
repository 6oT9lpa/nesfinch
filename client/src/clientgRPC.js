// client_authgRPC.js
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const { hashPassword, hashPhone } = require('./crypto-utils');
const { resolve } = require('path/posix');
const { rejects } = require('assert');

const PROTO_PATHS = [
    path.join(__dirname, '../../proto/service_auth.proto'),
    path.join(__dirname, '../../proto/service_communication.proto'),
    path.join(__dirname, '../../proto/service_status.proto'),
    path.join(__dirname, '../../proto/service_chat.proto')
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
const ChatService = protoDescriptor.chats.ChatService;

const client_auth = new AuthService('localhost:50051', grpc.credentials.createInsecure());
const client_search = new SearchService('localhost:50051', grpc.credentials.createInsecure());
const client_status = new StatusService('localhost:50051', grpc.credentials.createInsecure());
const client_relationship = new RelationshipService('localhost:50051', grpc.credentials.createInsecure());
const client_chat = new ChatService('localhost:50051', grpc.credentials.createInsecure());

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
                if (err) {
                    if (err.code === grpc.status.UNAUTHENTICATED) {
                        err.shouldRefresh = true;
                    }
                    return reject(err);
                }
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

const relationshipClient = {
    createRelationship: async ({ current_user, target_user }) => {
        return new Promise((resolve, reject) => {
            client_relationship.createRelationship({ 
                current_user, 
                target_user
            }, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            });
        });
    },
    
    updateRelationship: async ({ current_user, target_user, new_type, new_status }) => {
        return new Promise((resolve, reject) => {
            client_relationship.updateRelationship({ 
                current_user, 
                target_user, 
                new_type, 
                new_status 
            }, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            });
        });
    },
    
    getRelationshipStatus: async ({ current_user, target_user }) => {
        return new Promise((resolve, reject) => {
            client_relationship.getRelationshipStatus({ 
                current_user, target_user
            }, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            });
        });
    },
    
    getRelationships: async ({ current_user, type, limit, offset }) => {
        return new Promise((resolve, reject) => {
            client_relationship.getRelationships({ 
                current_user,
                new_type: type,
                limit,
                offset 
            }, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            });
        });
    },

    cancelRelationship: async ({ current_user, target_user }) => {
        return new Promise((resolve, reject) => {
            client_relationship.cancelRelationship({
                current_user, target_user
            }, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            });
        });
    }
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
        const call = client_status.subscribeToStatusUpdates({ user_id: userId });

        return Promise.resolve({
            on: (event, callback) => {
                call.on(event, (data) => {
                    if (event === 'data') {
                        callback({
                            userId: data.user_id,
                            status: data.status
                        });
                    } else {
                        callback(data);
                    }
                });
            },
            cancel: () => call.cancel()
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
    getSearch: async ({ current_user, name, type }) => {
        const request = {
            current_user,
            name,  
            type 
        };

        return new Promise((resolve, reject) => {
            client_search.getSearch(request, (err, response) => {
                if (err) return reject(err); 
                resolve(response); 
            });
        });
    }
};

const chatClient = {
    createChatDM: async ({ current_user, target_user }) => {
        const request = {
            current_user,
            target_user
        }

        return new Promise((resolve, reject) => {
            client_chat.createChatDM(request, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            })
        })
    }
}

module.exports = { authClient, relationshipClient, searchClient, statusClient };