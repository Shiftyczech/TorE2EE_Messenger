use clap::Parser;

#[derive(Parser, Debug, Clone)]
#[command(author, version, about = "TorE2EE Zero-Knowledge Relay Server")]
pub struct Config {
    #[arg(long, env = "SERVER_HOST", default_value = "127.0.0.1")]
    pub host: String,

    #[arg(long, env = "SERVER_PORT", default_value = "8080")]
    pub port: u16,

    #[arg(long, env = "DATABASE_URL", default_value = "sqlite::memory:")]
    pub database_url: String,

    /// Message Time-To-Live in seconds (default: 14 days = 1,209,600s)
    #[arg(long, env = "TTL_SECONDS", default_value = "1209600")]
    pub ttl_seconds: i64,

    /// Interval in seconds for the worker to clean up expired messages
    #[arg(long, env = "CLEANUP_INTERVAL_SECONDS", default_value = "60")]
    pub cleanup_interval_seconds: u64,

    /// Max size in bytes for encrypted message payload (default: 64 KB)
    #[arg(long, env = "MAX_PAYLOAD_BYTES", default_value = "65536")]
    pub max_payload_bytes: usize,
}

impl Config {
    pub fn load() -> Self {
        dotenvy::dotenv().ok();
        Config::parse()
    }
}

