use tonic::{Request, Response, Status};
use sqlx::PgPool;
use std::convert::TryFrom;

mod communication {
    tonic::include_proto!("communication");
}

pub use communication::search_service_server::{SearchService, SearchServiceServer};
use communication::{SearchRequest, SearchResponse, SearchType, User, Server}; 

#[derive(Debug)]
pub struct MySearchService {
    db: PgPool,
}

impl MySearchService {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }

    async fn search_users(&self, name: &str) -> Result<Vec<User>, sqlx::Error> {
        let rows = sqlx::query!(
            "SELECT id::uuid as id, username, display_name, status, created_at FROM users WHERE username ILIKE $1",
            name
        )
        .fetch_all(&self.db)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| User {
                id: row.id.to_string(),
                username: row.username,
                display_name: row.display_name.expect("Failed display name!"),
                status: row.status.unwrap_or("offline".to_string()),
                created_at: Some(prost_types::Timestamp {
                    seconds: row.created_at.and_utc().timestamp(),
                    nanos: row.created_at.and_utc().timestamp_subsec_nanos() as i32,
                }), 
            })
            .collect())
    }

    async fn search_servers(&self, name: &str) -> Result<Vec<Server>, sqlx::Error> {
        let rows = sqlx::query!(
            "SELECT id::uuid as id, name FROM servers WHERE name ILIKE $1",
            name
        )
        .fetch_all(&self.db)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| Server {
                id: row.id.to_string(),
                name: row.name,
            })
            .collect())
    }
}

#[tonic::async_trait]
impl SearchService for MySearchService {
    async fn get_search(
        &self,
        request: Request<SearchRequest>,
    ) -> Result<Response<SearchResponse>, Status> {
        let req = request.into_inner();
        let search_pattern = format!("%{}%", req.name);

        let mut users = Vec::new();
        let mut servers = Vec::new();

        let search_type = SearchType::try_from(req.r#type)
            .unwrap_or(SearchType::SearchUnspecified);

        match search_type {
            SearchType::SearchUser => {
                users = self.search_users(&search_pattern).await.map_err(map_db_error)?;
            }
            SearchType::SearchServer => {
                servers = self.search_servers(&search_pattern).await.map_err(map_db_error)?;
            }
            SearchType::SearchUnspecified => {
                users = self.search_users(&search_pattern).await.map_err(map_db_error)?;
                servers = self.search_servers(&search_pattern).await.map_err(map_db_error)?;
            }
            _ => {
                eprintln!("Unsupported search type requested.");
            }
        }

        let response = SearchResponse {
            users,
            servers,
        };

        Ok(Response::new(response))
    }
}

fn map_db_error(e: sqlx::Error) -> Status {
    eprintln!("Database error: {:?}", e);
    Status::internal("Database error")
}
