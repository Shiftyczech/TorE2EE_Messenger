mod auth;
mod config;
mod db;
mod handlers;
mod state;
mod worker;

use axum::{
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::Config;
use crate::db::init_db;
use crate::handlers::{message::handle_send_message, ws::handle_ws_upgrade};
use crate::state::AppState;
use crate::worker::start_ttl_worker;

async fn health_check() -> impl IntoResponse {
    (StatusCode::OK, "OK")
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging (zero-knowledge: do not log payload or keys)
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "server=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::load();
    tracing::info!(
        "Starting TorE2EE Zero-Knowledge Relay Server on {}:{}",
        config.host,
        config.port
    );

    let pool = init_db(&config.database_url).await?;
    tracing::info!("Database initialized: {}", config.database_url);

    // Start background TTL cleaner
    start_ttl_worker(pool.clone(), config.cleanup_interval_seconds);

    let state = AppState::new(config.clone(), pool);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/v1/message", post(handle_send_message))
        .route("/api/v1/stream", get(handle_ws_upgrade))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("Relay server listening on http://{}", addr);

    axum::serve(listener, app).await?;

    Ok(())
}
