use tonic::{Request, Response, Status};
use serde::Serialize;
use sqlx::PgPool;
use chrono::Utc;

mod communication {
    tonic::include_proto!("communication"); 
}

pub use communication::relationship_service_server::{ RelationshipService, RelationshipServiceServer };
use communication::{UpdateRelationshipRequest, UpdateRelationshipResponse,
    GetRelationshipsRequest, GetRelationshipsResponse, GetRelationshipStatusRequest, GetRelationshipStatusResponse};

#[derive(Debug)]
pub struct MyRelationshipService {
    db: PgPool,
}

#[tonic::async_trait]
impl RelationshipService for MyRelationshipService {
    async fn update_relationship(
        &self,
        request: Request<UpdateRelationshipRequest>,
    ) -> Result<Response<UpdateRelationshipResponse>, Status> {
        let _req = request.into_inner();
        
        unimplemented!()
    }

    async fn get_relationships(
        &self,
        request: Request<GetRelationshipsRequest>,
    ) -> Result<Response<GetRelationshipsResponse>, Status> {
        let _req = request.into_inner();
        
        unimplemented!()
    }

    async fn get_relationship_status(
        &self,
        request: Request<GetRelationshipStatusRequest>,
    ) -> Result<Response<GetRelationshipStatusResponse>, Status> {
        let _req = request.into_inner();
        
        unimplemented!()
    }
}