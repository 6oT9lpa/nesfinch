use tonic::{Request, Response, Status};
use sqlx::PgPool;
use uuid::Uuid;

mod chats {
    tonic::include_proto!("chats"); 
}

use chats::chat_service_server::{ChatService, ChatServiceServer};
use chats::{CreateChatDMRequest, CreateChatDMResponse, CreateChatGroupRequest, CreateChatGroupResponse};

#[derive(Debug)]
pub struct MyChatsService {
    db: PgPool,
    jwt_secret: String,
}

#[tonic::async_trait]
impl ChatService for MyChatsService {
    async fn create_chat_dm(
        &self,
        request: Request<CreateChatDMRequest>
    ) -> Result<Response<CreateChatDMResponse>, Status> {
        let req = request.into_inner();

        
    }
}