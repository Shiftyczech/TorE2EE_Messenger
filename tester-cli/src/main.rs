use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use futures_util::{SinkExt, StreamExt};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio::time::sleep;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

#[derive(Parser)]
#[command(name = "tester-cli", about = "TorE2EE Relay Test & Simulation CLI")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate a new Ed25519 keypair
    GenerateKeys,
    /// Send an encrypted message envelope to the relay
    Send {
        #[arg(long, default_value = "http://127.0.0.1:8080")]
        server_url: String,
        #[arg(long)]
        recipient_hash: String,
        #[arg(long, default_value = "dGVzdCBlbmNyeXB0ZWQgcGF5bG9hZA==")]
        payload: String,
        #[arg(long, default_value = "nonce_12345")]
        nonce: String,
    },
    /// Connect to WebSocket stream and listen for incoming messages
    Listen {
        #[arg(long, default_value = "ws://127.0.0.1:8080/api/v1/stream")]
        ws_url: String,
        #[arg(long)]
        private_key_hex: String,
    },
    /// Run automated End-to-End verification test suite
    E2eTest {
        #[arg(long, default_value = "http://127.0.0.1:8080")]
        server_url: String,
        #[arg(long, default_value = "ws://127.0.0.1:8080/api/v1/stream")]
        ws_url: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ServerWsMessage {
    #[serde(rename = "challenge")]
    Challenge { challenge: String },
    #[serde(rename = "authenticated")]
    Authenticated { recipient_pubkey_hash: String },
    #[serde(rename = "message")]
    MessagePayload {
        encrypted_payload: String,
        nonce: String,
        created_at: i64,
    },
    #[serde(rename = "pong")]
    Pong,
    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ClientWsMessage {
    #[serde(rename = "auth")]
    Auth {
        public_key: String,
        signature: String,
    },
    #[serde(rename = "ping")]
    Ping,
}

#[derive(Debug, Serialize)]
struct SendMessageReq {
    recipient_pubkey_hash: String,
    encrypted_payload: String,
    nonce: String,
}

#[derive(Debug, Deserialize)]
struct SendMessageResp {
    status: String,
    delivered_live: bool,
}

fn compute_pubkey_hash(public_key_bytes: &[u8; 32]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(public_key_bytes);
    hex::encode(hasher.finalize())
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::GenerateKeys => {
            let mut csprng = OsRng;
            let signing_key = SigningKey::generate(&mut csprng);
            let verifying_key = signing_key.verifying_key();
            let hash = compute_pubkey_hash(verifying_key.as_bytes());

            println!("=== Ed25519 Identity Keypair ===");
            println!("Private Key (hex): {}", hex::encode(signing_key.to_bytes()));
            println!("Public Key  (hex): {}", hex::encode(verifying_key.as_bytes()));
            println!("Mailbox Hash (SHA-256): {}", hash);
        }
        Commands::Send {
            server_url,
            recipient_hash,
            payload,
            nonce,
        } => {
            let client = reqwest::Client::new();
            let body = SendMessageReq {
                recipient_pubkey_hash: recipient_hash,
                encrypted_payload: payload,
                nonce,
            };

            let res = client
                .post(format!("{}/api/v1/message", server_url))
                .json(&body)
                .send()
                .await
                .context("Failed to connect to server")?;

            if res.status().is_success() {
                let resp_json: SendMessageResp = res.json().await?;
                println!("Message accepted! delivered_live={}", resp_json.delivered_live);
            } else {
                let err_text = res.text().await?;
                eprintln!("Error response: {}", err_text);
            }
        }
        Commands::Listen {
            ws_url,
            private_key_hex,
        } => {
            let key_bytes = hex::decode(private_key_hex).context("Invalid private key hex")?;
            if key_bytes.len() != 32 {
                bail!("Private key must be 32 bytes");
            }
            let mut key_arr = [0u8; 32];
            key_arr.copy_from_slice(&key_bytes);
            let signing_key = SigningKey::from_bytes(&key_arr);
            let verifying_key = signing_key.verifying_key();
            let my_hash = compute_pubkey_hash(verifying_key.as_bytes());

            println!("Connecting to WebSocket: {}", ws_url);
            println!("Identity Pubkey Hash: {}", my_hash);

            let (ws_stream, _) = connect_async(&ws_url).await.context("Failed to connect to WS")?;
            let (mut write, mut read) = ws_stream.split();

            while let Some(msg) = read.next().await {
                let msg = msg.context("WS read error")?;
                if let Message::Text(text) = msg {
                    let server_msg: ServerWsMessage = serde_json::from_str(&text)
                        .with_context(|| format!("Invalid json: {text}"))?;

                    match server_msg {
                        ServerWsMessage::Challenge { challenge } => {
                            println!("[<] Received challenge: {}", challenge);
                            let challenge_bytes = hex::decode(&challenge)?;
                            let signature = signing_key.sign(&challenge_bytes);

                            let auth_payload = ClientWsMessage::Auth {
                                public_key: hex::encode(verifying_key.as_bytes()),
                                signature: hex::encode(signature.to_bytes()),
                            };
                            let auth_json = serde_json::to_string(&auth_payload)?;
                            write.send(Message::Text(auth_json.into())).await?;
                            println!("[>] Sent challenge signature");
                        }
                        ServerWsMessage::Authenticated { recipient_pubkey_hash } => {
                            println!("[*] Successfully authenticated for hash: {}", recipient_pubkey_hash);
                        }
                        ServerWsMessage::MessagePayload {
                            encrypted_payload,
                            nonce,
                            created_at,
                        } => {
                            println!(
                                "[+] Received Message: payload='{}', nonce='{}', created_at={}",
                                encrypted_payload, nonce, created_at
                            );
                        }
                        ServerWsMessage::Pong => {
                            println!("[<] Pong");
                        }
                        ServerWsMessage::Error { message } => {
                            eprintln!("[!] Server error: {}", message);
                        }
                    }
                }
            }
        }
        Commands::E2eTest { server_url, ws_url } => {
            run_e2e_tests(&server_url, &ws_url).await?;
        }
    }

    Ok(())
}

async fn run_e2e_tests(server_url: &str, ws_url: &str) -> Result<()> {
    println!("\n==========================================");
    println!(" TorE2EE Messenger E2E Verification Suite ");
    println!("==========================================\n");

    let http_client = reqwest::Client::new();

    // 0. Verify server health
    println!("[Step 0] Checking server health at {}/health...", server_url);
    let health_resp = http_client
        .get(format!("{}/health", server_url))
        .send()
        .await
        .context("Server is not running. Please start the server crate first.")?;

    if !health_resp.status().is_success() {
        bail!("Server health check failed with status: {}", health_resp.status());
    }
    println!("  -> Server is healthy.\n");

    // 1. Generate Alice & Bob keys
    println!("[Step 1] Generating Alice and Bob Ed25519 identities...");
    let mut csprng = OsRng;
    let alice_sk = SigningKey::generate(&mut csprng);
    let _alice_pk = alice_sk.verifying_key();

    let bob_sk = SigningKey::generate(&mut csprng);
    let bob_pk = bob_sk.verifying_key();
    let bob_hash = compute_pubkey_hash(bob_pk.as_bytes());
    println!("  -> Bob Mailbox Hash: {}\n", bob_hash);

    // 2. Offline Blind Drop Test
    println!("[Step 2] Alice sends offline encrypted envelope to Bob's mailbox hash...");
    let send_req = SendMessageReq {
        recipient_pubkey_hash: bob_hash.clone(),
        encrypted_payload: "ENCRYPTED_BLOB_FOR_OFFLINE_BOB".to_string(),
        nonce: "test_nonce_offline_001".to_string(),
    };
    let send_resp = http_client
        .post(format!("{}/api/v1/message", server_url))
        .json(&send_req)
        .send()
        .await?;
    assert!(send_resp.status().is_success());
    let send_data: SendMessageResp = send_resp.json().await?;
    assert!(!send_data.delivered_live, "Should NOT be delivered live when Bob is offline");
    println!("  -> Message queued in SQLite for offline pick-up.\n");

    // 3. Bob connects via WebSocket, performs challenge-response and receives message
    println!("[Step 3] Bob connects to WebSocket stream and authenticates...");
    let (ws_stream, _) = connect_async(ws_url).await.context("Failed to connect to WS")?;
    let (mut write, mut read) = ws_stream.split();

    // Bob receives challenge
    let first_msg = read.next().await.context("WS closed prematurely")??;
    let challenge_hex = match first_msg {
        Message::Text(t) => {
            let parsed: ServerWsMessage = serde_json::from_str(&t)?;
            match parsed {
                ServerWsMessage::Challenge { challenge } => challenge,
                other => bail!("Expected challenge, got {:?}", other),
            }
        }
        _ => bail!("Unexpected WS message type"),
    };
    println!("  -> Received challenge: {}", challenge_hex);

    // Bob signs challenge
    let challenge_bytes = hex::decode(&challenge_hex)?;
    let signature = bob_sk.sign(&challenge_bytes);
    let auth_msg = ClientWsMessage::Auth {
        public_key: hex::encode(bob_pk.as_bytes()),
        signature: hex::encode(signature.to_bytes()),
    };
    write
        .send(Message::Text(serde_json::to_string(&auth_msg)?.into()))
        .await?;
    println!("  -> Sent Ed25519 signature");

    // Bob receives auth confirmation
    let auth_conf = read.next().await.context("WS closed prematurely")??;
    match auth_conf {
        Message::Text(t) => {
            let parsed: ServerWsMessage = serde_json::from_str(&t)?;
            match parsed {
                ServerWsMessage::Authenticated { recipient_pubkey_hash } => {
                    assert_eq!(recipient_pubkey_hash, bob_hash);
                    println!("  -> Authenticated successfully for mailbox!");
                }
                other => bail!("Expected authenticated message, got {:?}", other),
            }
        }
        _ => bail!("Unexpected WS message type"),
    }

    // Bob receives the queued offline message
    let offline_msg = read.next().await.context("WS closed prematurely")??;
    match offline_msg {
        Message::Text(t) => {
            let parsed: ServerWsMessage = serde_json::from_str(&t)?;
            match parsed {
                ServerWsMessage::MessagePayload {
                    encrypted_payload,
                    nonce,
                    ..
                } => {
                    assert_eq!(encrypted_payload, "ENCRYPTED_BLOB_FOR_OFFLINE_BOB");
                    assert_eq!(nonce, "test_nonce_offline_001");
                    println!("  -> Received offline message: '{}'", encrypted_payload);
                }
                other => bail!("Expected message payload, got {:?}", other),
            }
        }
        _ => bail!("Unexpected WS message type"),
    }

    // 4. Test Live Real-Time Delivery while Bob is still connected
    println!("\n[Step 4] Alice sends 2nd message while Bob is online (Live Real-time stream)...");
    let send_req2 = SendMessageReq {
        recipient_pubkey_hash: bob_hash.clone(),
        encrypted_payload: "LIVE_STREAMED_ENCRYPTED_BLOB".to_string(),
        nonce: "test_nonce_live_002".to_string(),
    };
    let send_resp2 = http_client
        .post(format!("{}/api/v1/message", server_url))
        .json(&send_req2)
        .send()
        .await?;
    assert!(send_resp2.status().is_success());
    let send_data2: SendMessageResp = send_resp2.json().await?;
    assert!(send_data2.delivered_live, "Should be delivered live when Bob is connected!");
    println!("  -> Server marked message as delivered_live=true");

    let live_msg = read.next().await.context("WS closed prematurely")??;
    match live_msg {
        Message::Text(t) => {
            let parsed: ServerWsMessage = serde_json::from_str(&t)?;
            match parsed {
                ServerWsMessage::MessagePayload {
                    encrypted_payload,
                    nonce,
                    ..
                } => {
                    assert_eq!(encrypted_payload, "LIVE_STREAMED_ENCRYPTED_BLOB");
                    assert_eq!(nonce, "test_nonce_live_002");
                    println!("  -> Received live stream message: '{}'", encrypted_payload);
                }
                other => bail!("Expected live message payload, got {:?}", other),
            }
        }
        _ => bail!("Unexpected WS message type"),
    }

    // Close Bob's socket
    drop(write);
    drop(read);
    sleep(Duration::from_millis(100)).await;

    // 5. Verify Zero Retention (Bob reconnects, should receive 0 messages)
    println!("\n[Step 5] Verifying Zero Retention: Bob reconnects to verify no messages are left on server...");
    let (ws_stream2, _) = connect_async(ws_url).await?;
    let (mut write2, mut read2) = ws_stream2.split();

    // Challenge
    let chall_msg = read2.next().await.context("WS closed")??;
    let ch_hex = match chall_msg {
        Message::Text(t) => {
            let p: ServerWsMessage = serde_json::from_str(&t)?;
            match p {
                ServerWsMessage::Challenge { challenge } => challenge,
                _ => bail!("Expected challenge"),
            }
        }
        _ => bail!("Unexpected"),
    };
    let ch_bytes = hex::decode(&ch_hex)?;
    let sig2 = bob_sk.sign(&ch_bytes);
    let auth_msg2 = ClientWsMessage::Auth {
        public_key: hex::encode(bob_pk.as_bytes()),
        signature: hex::encode(sig2.to_bytes()),
    };
    write2
        .send(Message::Text(serde_json::to_string(&auth_msg2)?.into()))
        .await?;

    let auth_conf2 = read2.next().await.context("WS closed")??;
    match auth_conf2 {
        Message::Text(t) => {
            let p: ServerWsMessage = serde_json::from_str(&t)?;
            match p {
                ServerWsMessage::Authenticated { .. } => {}
                _ => bail!("Expected auth conf"),
            }
        }
        _ => bail!("Unexpected"),
    }

    // Await message with short timeout - should be none
    let no_msg = tokio::time::timeout(Duration::from_millis(500), read2.next()).await;
    assert!(
        no_msg.is_err(),
        "Queue should be completely empty after delivery (Zero-Knowledge)!"
    );
    println!("  -> Verified! Server mailbox is 100% clean (Zero message retention).");

    println!("\n==========================================");
    println!(" ALL E2E VERIFICATION TESTS PASSED (100%) ");
    println!("==========================================\n");

    Ok(())
}
