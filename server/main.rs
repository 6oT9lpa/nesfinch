use tonic::transport::Server;
use sqlx::PgPool;
use dotenvy::dotenv;
use std::env;

mod services; 
use services::auth_service::{MyAuthService, AuthServiceServer};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();

    let addr = "[::1]:50051".parse()?;
    let db_url = env::var("DATABASE_URL")?;
    let jwt_secret = env::var("JWT_SECRET")?;

    let db = PgPool::connect(&db_url).await?;
    let service = MyAuthService::new(db, jwt_secret);

    println!("AuthService running on {}", addr);
    Server::builder()
        .add_service(AuthServiceServer::new(service))
        .serve(addr)
        .await?;

    Ok(())
}
