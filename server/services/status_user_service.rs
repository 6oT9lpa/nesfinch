use tonic::{Request, Response, Status as GrpcStatus};
use sqlx::PgPool;
use tokio::sync::broadcast;
use std::pin::Pin; 
use futures_core::Stream;

mod status_user {
    tonic::include_proto!("status");
}

pub use status_user::{
    status_service_server::{StatusService, StatusServiceServer},
    StatusUpdate, StatusResponse, StatusSubscription,
    StatusRequest, UserStatus, Status,
};

pub struct MyStatusService {
    db: PgPool,
    tx: broadcast::Sender<StatusUpdate>,
}

impl MyStatusService {
    pub fn new(db: PgPool) -> Self {
        let (tx, _) = broadcast::channel(100);
        Self { db, tx }
    }
}

#[tonic::async_trait]
impl StatusService for MyStatusService {
    async fn update_status(
        &self,
        request: Request<StatusUpdate>,
    ) -> Result<Response<StatusResponse>, GrpcStatus> {
        let status_update = request.into_inner();

        let status_str = match Status::from_i32(status_update.status) {
            Some(Status::Online) => "online",
            Some(Status::Offline) => "offline",
            Some(Status::Idle) => "idle",
            Some(Status::DoNotDisturb) => "do_not_disturb",
            _ => return Err(GrpcStatus::invalid_argument("Unknown status")),
        };

        let user_uuid = uuid::Uuid::parse_str(&status_update.user_id)
            .map_err(|_| GrpcStatus::invalid_argument("Invalid UUID"))?;

        let result = sqlx::query!(
            r#"
            UPDATE users
            SET status = $2, last_seen_at = NOW(), updated_at = NOW()
            WHERE id = $1::uuid
            "#,
            user_uuid,
            status_str
        )
        .execute(&self.db)
        .await;

        match result {
            Ok(res) => {
                if res.rows_affected() == 0 {
                    Err(GrpcStatus::not_found("User not found"))
                } else {
                    let _ = self.tx.send(StatusUpdate {
                        user_id: status_update.user_id.clone(),
                        status: status_update.status,
                    });

                    Ok(Response::new(StatusResponse { success: true }))
                }
            }
            Err(e) => Err(GrpcStatus::internal(format!("DB error: {}", e))),
        }
    }

    async fn get_user_status(
        &self,
        request: Request<StatusRequest>,
    ) -> Result<Response<UserStatus>, GrpcStatus> {
        let req = request.into_inner();

        let user_uuid = uuid::Uuid::parse_str(&req.user_id)
            .map_err(|_| GrpcStatus::invalid_argument("Invalid UUID"))?;

        let row = sqlx::query!(
            r#"
            SELECT id::uuid as user_id, status, EXTRACT(EPOCH FROM last_seen_at)::float8 as last_seen
            FROM users
            WHERE id = $1::uuid
            "#,
            user_uuid
        )
        .fetch_optional(&self.db)
        .await;

        match row {
            Ok(Some(user)) => {
                let status_enum = match user.status.as_deref() {
                    Some("online") => Status::Online as i32,
                    Some("offline") => Status::Offline as i32,
                    Some("idle") => Status::Idle as i32,
                    Some("do_not_disturb") => Status::DoNotDisturb as i32,
                    _ => Status::Offline as i32,
                };

                Ok(Response::new(UserStatus {
                    user_id: user.user_id.to_string(),
                    status: status_enum,
                    last_seen: user.last_seen.unwrap_or(0.0) as i64,
                }))
            }
            Ok(None) => Err(GrpcStatus::not_found("User not found")),
            Err(e) => Err(GrpcStatus::internal(format!("DB error: {}", e))),
        }
    }
    type SubscribeToStatusUpdatesStream =
        Pin<Box<dyn Stream<Item = Result<StatusUpdate, GrpcStatus>> + Send + Sync + 'static>>;

    async fn subscribe_to_status_updates(
        &self,
        request: Request<StatusSubscription>,
    ) -> Result<Response<Self::SubscribeToStatusUpdatesStream>, GrpcStatus> {
        let mut rx = self.tx.subscribe();
        println!("New status subscription established");

        let user_id = request.into_inner().user_id;

        let user_uuid = uuid::Uuid::parse_str(&user_id)
            .map_err(|_| GrpcStatus::invalid_argument("Invalid UUID"))?;

        
        let current_status = sqlx::query!(
            r#"
            SELECT status
            FROM users
            WHERE id = $1::uuid
            "#,
            user_uuid 
        )
        .fetch_optional(&self.db)
        .await
        .map_err(|_| GrpcStatus::internal("Failed to fetch user status"))?;

        let current_status_str = current_status
            .map(|record| record.status) 
            .unwrap_or_else(|| Some("offline".to_string()));

        let status_str = current_status_str.as_ref().expect("REASON");
        let current_status_enum = match status_str.as_str() {
            "online" => Status::Online as i32,
            "offline" => Status::Offline as i32,
            "idle" => Status::Idle as i32,
            "do_not_disturb" => Status::DoNotDisturb as i32,
            _ => Status::Offline as i32,
        };

        println!("Статус пользователя {} обновлён на {}", user_uuid, status_str);
        let current_status_update = StatusUpdate {
            user_id: user_uuid.to_string(), 
            status: current_status_enum,
        };
        println!("Отправка обновления статуса: {:?}", current_status_update);

        print!("{}", current_status_enum);

        let _ = self.tx.send(current_status_update);

        let output_stream = async_stream::try_stream! {
            while let Ok(update) = rx.recv().await {
                println!("Sending status update: {:?}", update);
                yield update;
            }
        };

        Ok(Response::new(Box::pin(output_stream)))
    }
}
