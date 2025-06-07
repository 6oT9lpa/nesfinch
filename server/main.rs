use tonic::transport::Server;
use sqlx::PgPool;
use dotenvy::dotenv;
use std::env;

mod services; 
use services::auth_service::{MyAuthService, AuthServiceServer};
use services::seacrh_service::{MySearchService, SearchServiceServer};
use services::status_user_service::{MyStatusService, StatusServiceServer};
use services::relationships_service::{MyRelationshipService, RelationshipServiceServer};
use services::chat_service::{MyChatsService, ChatServiceServer};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();

    let addr = "[::1]:50051".parse()?;
    let db_url = env::var("DATABASE_URL")?;
    let jwt_secret = env::var("JWT_SECRET")?;

    let db = PgPool::connect(&db_url).await?;
    let service_auth = MyAuthService::new(db.clone(), jwt_secret);
    let service_search = MySearchService::new(db.clone());
    let service_status = MyStatusService::new(db.clone());
    let service_relationship = MyRelationshipService::new(db.clone());
    let service_chat = MyChatsService::new(db.clone());

    println!("Services running on {}", addr);
    Server::builder()
        .add_service(AuthServiceServer::new(service_auth))
        .add_service(SearchServiceServer::new(service_search))
        .add_service(StatusServiceServer::new(service_status))
        .add_service(RelationshipServiceServer::new(service_relationship))
        .add_service(ChatServiceServer::new(service_chat))
        .serve(addr)
        .await?;

    Ok(())
}