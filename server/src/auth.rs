use ed25519_dalek::{Signature, VerifyingKey};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::fmt;

#[derive(Debug)]
pub struct AuthError(pub String);

impl fmt::Display for AuthError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Auth error: {}", self.0)
    }
}

impl std::error::Error for AuthError {}

impl From<&str> for AuthError {
    fn from(s: &str) -> Self {
        AuthError(s.to_string())
    }
}

/// Generates a cryptographically random 32-byte challenge nonce.
pub fn generate_challenge_nonce() -> [u8; 32] {
    let mut nonce = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut nonce);
    nonce
}

/// Computes a hex-encoded SHA-256 hash of the public key bytes.
/// This hash is used as the mailbox index / recipient address on the relay.
pub fn compute_pubkey_hash(public_key_bytes: &[u8; 32]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(public_key_bytes);
    hex::encode(hasher.finalize())
}

/// Verifies that the provided Ed25519 signature is valid for the given challenge.
/// Returns the recipient_pubkey_hash (hex) on success.
pub fn verify_challenge_signature(
    public_key_hex: &str,
    challenge_bytes: &[u8],
    signature_hex: &str,
) -> Result<String, AuthError> {
    let pk_bytes = hex::decode(public_key_hex)
        .map_err(|e| AuthError(format!("Invalid public key hex: {e}")))?;

    if pk_bytes.len() != 32 {
        return Err(AuthError("Public key must be exactly 32 bytes".to_string()));
    }

    let mut pk_array = [0u8; 32];
    pk_array.copy_from_slice(&pk_bytes);

    let verifying_key = VerifyingKey::from_bytes(&pk_array)
        .map_err(|e| AuthError(format!("Invalid Ed25519 verifying key: {e}")))?;

    let sig_bytes = hex::decode(signature_hex)
        .map_err(|e| AuthError(format!("Invalid signature hex: {e}")))?;

    if sig_bytes.len() != 64 {
        return Err(AuthError("Signature must be exactly 64 bytes".to_string()));
    }

    let mut sig_array = [0u8; 64];
    sig_array.copy_from_slice(&sig_bytes);
    let signature = Signature::from_bytes(&sig_array);

    verifying_key
        .verify_strict(challenge_bytes, &signature)
        .map_err(|e| AuthError(format!("Signature verification failed: {e}")))?;

    Ok(compute_pubkey_hash(&pk_array))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use rand::rngs::OsRng;

    #[test]
    fn test_valid_challenge_signature() {
        let mut csprng = OsRng;
        let signing_key = SigningKey::generate(&mut csprng);
        let verifying_key = signing_key.verifying_key();

        let challenge = generate_challenge_nonce();
        let signature = signing_key.sign(&challenge);

        let pk_hex = hex::encode(verifying_key.as_bytes());
        let sig_hex = hex::encode(signature.to_bytes());

        let result = verify_challenge_signature(&pk_hex, &challenge, &sig_hex);
        assert!(result.is_ok());

        let expected_hash = compute_pubkey_hash(verifying_key.as_bytes());
        assert_eq!(result.unwrap(), expected_hash);
    }

    #[test]
    fn test_invalid_signature_rejected() {
        let mut csprng = OsRng;
        let signing_key = SigningKey::generate(&mut csprng);
        let verifying_key = signing_key.verifying_key();

        let challenge1 = generate_challenge_nonce();
        let challenge2 = generate_challenge_nonce();
        let signature = signing_key.sign(&challenge1);

        let pk_hex = hex::encode(verifying_key.as_bytes());
        let sig_hex = hex::encode(signature.to_bytes());

        // Verifying with different challenge should fail
        let result = verify_challenge_signature(&pk_hex, &challenge2, &sig_hex);
        assert!(result.is_err());
    }
}
