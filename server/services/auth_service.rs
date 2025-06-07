use tonic::{Request, Response, Status};
use serde::{Serialize, Deserialize};
use sqlx::PgPool;
use chrono::Utc;
use bcrypt::verify;
use jsonwebtoken::{encode, decode, Header, EncodingKey, DecodingKey, Algorithm, Validation};
use uuid::Uuid;

use crate::services::key_manager::KeyManager;

mod auth {
    tonic::include_proto!("auth");
}

pub use auth::auth_service_server::{AuthService, AuthServiceServer};
use auth::{SignInUserInput, SignInUserResponse, SignUpUserInput, SignUpUserResponse, User, GetMeInput, UserResponse, RefreshTokenResponse, RefreshTokenInput};

#[derive(Debug)]
pub struct MyAuthService {
    db: PgPool,
    jwt_secret: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
}

// Генерация JWT токенов аутентификации 
fn create_jwt(user_id: &str, secret: &str, expiration_sec: i64) -> Result<String, Status> {
    let claims = Claims {
        sub: user_id.to_string(),
        exp: (Utc::now().timestamp() + expiration_sec) as usize,
    };

    encode(
        &Header::new(Algorithm::HS256), 
        &claims,
        &EncodingKey::from_secret(secret.as_bytes())
    ).map_err(|e| {
        println!("JWT encoding error: {:?}", e);
        Status::internal("JWT encoding error")
    })
}

impl MyAuthService {
    pub fn new(db: PgPool, jwt_secret: String) -> Self {
        Self { db, jwt_secret }
    }
}

#[tonic::async_trait]
impl AuthService for MyAuthService {
    
    // регистрация нового пользователя
    async fn sign_up_user(
        &self,
        request: Request<SignUpUserInput>,
    ) -> Result<Response<SignUpUserResponse>, Status> {
        let req = request.into_inner();

        println!("SignUp request: username={}, phone={}, email={}, pasw={}", req.username, req.phone, req.email, req.pasw);

        if req.username.is_empty() || req.phone.is_empty() || req.pasw.is_empty() {
            return Err(Status::invalid_argument("Missing required fields"));
        }

        let exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM users WHERE phone_hash = $1"
        )
        .bind(&req.phone)
        .fetch_one(&self.db)
        .await
        .map_err(|_| Status::internal("Database error"))?;

        if exists > 0 {
            return Err(Status::already_exists("User already exists"));
        }

        let now = Utc::now().naive_utc();

        let record = sqlx::query!(
            "INSERT INTO users (username, phone_hash, email, pasw_hash, display_name, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id::uuid, username, email, created_at, display_name, updated_at, status, activity_user",
            req.username,
            req.phone,
            req.email,
            req.pasw,
            req.username,
            now,
            now,
        )
        .fetch_one(&self.db)
        .await
        .map_err(|_| Status::internal("Insert failed"))?;

        let key_manager = KeyManager::new(self.db.clone());
        key_manager.generate_user_keys(record.id).await.map_err(|e| {
            println!("Error generating user keys: {:?}", e);
            Status::internal("Key generation error")
        })?;

        let user = Some(User {
            id: record.id.to_string(),
            username: record.username,
            display_name: record.display_name.expect("Failed display name!"),
            status: record.status.unwrap_or("Online".to_string()),
            activity_user: record.activity_user.unwrap_or("".to_string()),   
            created_at: Some(prost_types::Timestamp {
                seconds: record.created_at.and_utc().timestamp(),
                nanos: record.created_at.and_utc().timestamp_subsec_nanos() as i32,
            }),     
        });

        Ok(Response::new(SignUpUserResponse { user }))
    }
    
    // Логирование пользователя
    async fn sign_in_user(
        &self,
        request: Request<SignInUserInput>,
    ) -> Result<Response<SignInUserResponse>, Status> {
        let req = request.into_inner();
        
        println!("SignIn attempt with phone_hash: {}", req.phone);
    
        let record = sqlx::query!(
            "SELECT id::uuid as id, pasw_hash, username, status, display_name, activity_user, created_at FROM users WHERE phone_hash = $1",
            req.phone
        )
        .fetch_optional(&self.db)
        .await
        .map_err(|e| {
            println!("Database error: {:?}", e);
            Status::internal("Database error")
        })?;
    
        let Some(user) = record else {
            println!("User not found with phone_hash: {}", req.phone);
            return Err(Status::not_found("User not found"));
        };

        print!("{:?}", user);
    
        println!("User found - ID: {}", user.id.to_string());
        let password_valid = verify(&req.password, &user.pasw_hash)
            .map_err(|e| {
                println!("Password verification error: {:?}", e);
                Status::internal("Hash error")
            })?;
    
        if !password_valid {
            println!("Invalid password for user ID: {}", user.id.to_string());
            return Err(Status::unauthenticated("Invalid password"));
        }
    
        println!("Generating tokens for user ID: {}", user.id.to_string());
        let access_token = create_jwt(&user.id.to_string(), &self.jwt_secret, 3600)?; 
        let refresh_token = create_jwt(&user.id.to_string(), &self.jwt_secret, 7 * 24 * 3600)?; 
    
        Ok(Response::new(SignInUserResponse {
            access_token,
            refresh_token,
            user: Some(User {
                id: user.id.to_string(),
                username: user.username,
                display_name: user.display_name.expect("Failed display name!"),
                status: user.status.unwrap_or("Online".to_string()),
                activity_user: user.activity_user.unwrap_or("".to_string()),
                created_at: Some(prost_types::Timestamp {
                    seconds: user.created_at.and_utc().timestamp(),
                    nanos: user.created_at.and_utc().timestamp_subsec_nanos() as i32,
                }), 
            }),
        }))
    }
    async fn get_me(
        &self,
        request: Request<GetMeInput>,
    ) -> Result<Response<UserResponse>, Status> {
        let token = request.into_inner().access_token;
        
        let token_data = decode::<Claims>(
            &token,
            &DecodingKey::from_secret(self.jwt_secret.as_bytes()),
            &Validation::new(Algorithm::HS256),
        ).map_err(|e| {
            println!("JWT decode error: {:?}", e);
            Status::unauthenticated("Invalid token")
        })?;

        let user_id = Uuid::parse_str(&token_data.claims.sub).map_err(|_| Status::invalid_argument("Invalid user ID"))?;

        let user = sqlx::query!(
            "SELECT id::uuid as id, username, status, display_name, activity_user, created_at FROM users WHERE id = $1",
            user_id
        )
        .fetch_optional(&self.db)
        .await
        .map_err(|e| {
            println!("Database error: {:?}", e);
            Status::internal("Database error")
        })?
        .ok_or(Status::not_found("User not found"))?;

        Ok(Response::new(UserResponse {
            user: Some(User {
                id: user.id.to_string(),
                username: user.username,
                display_name: user.display_name.expect("Failed display name!"),
                status: user.status.unwrap_or("online".to_string()),
                activity_user: user.activity_user.unwrap_or("".to_string()),
                created_at: Some(prost_types::Timestamp {
                    seconds: user.created_at.and_utc().timestamp(),
                    nanos: user.created_at.and_utc().timestamp_subsec_nanos() as i32,
                }), 
            }),
        }))
    }
    async fn refresh_token(
        &self,
        request: Request<RefreshTokenInput>,
    ) -> Result<Response<RefreshTokenResponse>, Status> {
        let refresh_token = request.into_inner().refresh_token;

        let token_data = decode::<Claims>(
            &refresh_token,
            &DecodingKey::from_secret(self.jwt_secret.as_bytes()),
            &Validation::new(Algorithm::HS256),
        ).map_err(|e| {
            println!("Refresh token decode error: {:?}", e);
            Status::unauthenticated("Invalid refresh token")
        })?;

        let user_id = Uuid::parse_str(&token_data.claims.sub)
            .map_err(|_| Status::invalid_argument("Invalid user ID"))?;

        let user_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)"
        )
        .bind(user_id)
        .fetch_one(&self.db)
        .await
        .map_err(|e| {
            println!("Database error: {:?}", e);
            Status::internal("Database error")
        })?;

        if !user_exists {
            return Err(Status::not_found("User not found"));
        }

        let access_token = create_jwt(&user_id.to_string(), &self.jwt_secret, 3600)?; // 1 hour
        let refresh_token = create_jwt(&user_id.to_string(), &self.jwt_secret, 7 * 24 * 3600)?; // 7 days

        Ok(Response::new(RefreshTokenResponse {
            access_token,
            refresh_token,
        }))
    }
}