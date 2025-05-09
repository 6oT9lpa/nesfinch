use std::env;
use dotenv::from_filename;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Загружаем переменные из config.env
    from_filename(".env").ok();
    println!("cargo:rerun-if-changed=config.env");

    if let Ok(database_url) = env::var("DATABASE_URL") {
        println!("cargo:rustc-env=DATABASE_URL={}", database_url);
    }

    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .compile(
            &[
                "proto/user.proto",
                "proto/rpc_signup_user.proto",
                "proto/rpc_signin_user.proto",
                "proto/service_auth.proto",
                "proto/rpc_relationships.proto",
                "proto/service_communication.proto",
                "proto/rpc_search.proto"
            ],
            &["proto/"],
        )?;

    Ok(())
}
