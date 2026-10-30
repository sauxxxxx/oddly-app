//! Encryption for website access credentials (AES-256-GCM). The key lives only in the
//! API's environment (`SECRETS_KEY`); the database stores ciphertext + nonce.

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};

use crate::error::AppError;

pub const KEY_VERSION: i32 = 1;

pub struct Vault {
    cipher: Aes256Gcm,
}

impl Vault {
    /// Parses a base64-encoded 32-byte key.
    pub fn from_base64(key: &str) -> anyhow::Result<Self> {
        let bytes = STANDARD.decode(key.trim()).map_err(|_| anyhow::anyhow!("SECRETS_KEY must be base64"))?;
        if bytes.len() != 32 {
            anyhow::bail!("SECRETS_KEY must decode to exactly 32 bytes");
        }
        Ok(Self { cipher: Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&bytes)) })
    }

    pub fn encrypt(&self, plaintext: &str) -> Result<(Vec<u8>, Vec<u8>), AppError> {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = self
            .cipher
            .encrypt(&nonce, plaintext.as_bytes())
            .map_err(|_| AppError::Internal(anyhow::anyhow!("encryption failed")))?;
        Ok((ciphertext, nonce.to_vec()))
    }

    pub fn decrypt(&self, ciphertext: &[u8], nonce: &[u8]) -> Result<String, AppError> {
        if nonce.len() != 12 {
            return Err(AppError::Internal(anyhow::anyhow!("bad nonce length")));
        }
        let plain = self
            .cipher
            .decrypt(Nonce::from_slice(nonce), ciphertext)
            .map_err(|_| AppError::Internal(anyhow::anyhow!("decryption failed (wrong SECRETS_KEY?)")))?;
        String::from_utf8(plain).map_err(|_| AppError::Internal(anyhow::anyhow!("secret is not UTF-8")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_tamper_detection() {
        let vault = Vault::from_base64(&STANDARD.encode([7u8; 32])).unwrap();
        let (ct, nonce) = vault.encrypt("hunter2!").unwrap();
        assert_ne!(ct, b"hunter2!");
        assert_eq!(vault.decrypt(&ct, &nonce).unwrap(), "hunter2!");
        let mut bad = ct.clone();
        bad[0] ^= 1;
        assert!(vault.decrypt(&bad, &nonce).is_err());
        assert!(Vault::from_base64("short").is_err());
    }
}
