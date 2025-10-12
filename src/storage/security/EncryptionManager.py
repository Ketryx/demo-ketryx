```python
import os
import threading
import time
from typing import Optional, Dict

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes, padding
from cryptography.hazmat.backends import default_backend
from cryptography.exceptions import InvalidTag

# Placeholder for a secure key vault interface (HSM or cloud KMS)
class KeyVaultInterface:
    """
    Abstract interface for secure key storage and retrieval.
    In production integrate with an HSM or cloud KMS via their SDK.
    """

    def store_key(self, key_id: str, key_bytes: bytes) -> None:
        raise NotImplementedError()

    def retrieve_key(self, key_id: str) -> Optional[bytes]:
        raise NotImplementedError()

    def delete_key(self, key_id: str) -> None:
        raise NotImplementedError()

    def list_keys(self) -> Dict[str, bytes]:
        raise NotImplementedError()


class InMemoryKeyVault(KeyVaultInterface):
    """
    Temporary in-memory vault for demonstration.
    Not for production use.
    """
    def __init__(self):
        self._store = dict()
        self._lock = threading.Lock()

    def store_key(self, key_id: str, key_bytes: bytes) -> None:
        with self._lock:
            self._store[key_id] = key_bytes

    def retrieve_key(self, key_id: str) -> Optional[bytes]:
        with self._lock:
            return self._store.get(key_id)

    def delete_key(self, key_id: str) -> None:
        with self._lock:
            self._store.pop(key_id, None)

    def list_keys(self) -> Dict[str, bytes]:
        with self._lock:
            return dict(self._store)


class EncryptionManager:
    """
    AES-256 Encryption Manager implementing:
    - AES-GCM for data at rest encryption (FIPS 140-2 compliant algorithms)
    - Key management with rotation
    - Field-level encryption support
    - Transparent data encryption
    - Encryption key derivation (PBKDF2HMAC)
    - Secure key storage abstraction for HSM or KeyVault
    - Optimization and thread safety
    """

    _KEY_SIZE = 32  # 256 bits
    _NONCE_SIZE = 12  # Recommended for GCM (96 bits)
    _TAG_SIZE = 16  # GCM tag size
    _KDF_ITERATIONS = 100_000

    def __init__(self, key_vault: KeyVaultInterface, master_secret: bytes, rotation_interval_sec: int = 30 * 24 * 3600):
        """
        :param key_vault: Secure key storage (HSM or Vault abstraction)
        :param master_secret: Master secret for key derivation (should come from secure env or vault)
        :param rotation_interval_sec: Key rotation period in seconds (default 30 days)
        """
        self._key_vault = key_vault
        self._master_secret = master_secret
        self._rotation_interval = rotation_interval_sec

        self._lock = threading.RLock()
        self._active_key_id = None
        self._active_key = None
        self._key_creation_times = dict()

        self._initialize_keys()

    def _initialize_keys(self):
        with self._lock:
            keys = self._key_vault.list_keys()
            if keys:
                # Find latest key by creation time metadata
                key_ids = sorted(keys.keys(), reverse=True)
                latest_key_id = key_ids[0]
                self._active_key_id = latest_key_id
                self._active_key = keys[latest_key_id]
            else:
                # No keys, generate initial key
                self.rotate_key()

    def rotate_key(self):
        """
        Generate new AES key and store it securely.
        Mark it as active for future encryption operations.
        """
        with self._lock:
            key_id = self._generate_key_id()
            key = os.urandom(self._KEY_SIZE)
            self._key_vault.store_key(key_id, key)
            self._active_key_id = key_id
            self._active_key = key
            self._key_creation_times[key_id] = time.time()

    def _generate_key_id(self) -> str:
        # Key ID based on epoch + random suffix to ensure uniqueness
        timestamp = int(time.time())
        suffix = os.urandom(4).hex()
        return f"key_{timestamp}_{suffix}"

    def _ensure_key_rotation(self):
        with self._lock:
            if self._active_key_id is None:
                self.rotate_key()
                return
            creation_time = self._key_creation_times.get(self._active_key_id)
            if creation_time is None:
                self._key_creation_times[self._active_key_id] = time.time()
                return
            if time.time() - creation_time > self._rotation_interval:
                self.rotate_key()

    def derive_key(self, salt: bytes, info: Optional[bytes] = None) -> bytes:
        """
        Derives an encryption key from the master secret using PBKDF2HMAC.
        Useful for field-level encryption keys or additional contexts.

        :param salt: Unique salt per derived key
        :param info: Optional context info for key derivation
        :return: Derived 32-byte key
        """
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=self._KEY_SIZE,
            salt=salt,
            iterations=self._KDF_ITERATIONS,
            backend=default_backend(),
        )
        key_material = self._master_secret
        derived_key = kdf.derive(key_material)
        return derived_key

    def encrypt(self, plaintext: bytes, key: Optional[bytes] = None) -> bytes:
        """
        Encrypt data using AES-256-GCM with given key or active key.
        Returns nonce + ciphertext + tag concatenated.

        :param plaintext: Data to encrypt
        :param key: AES key to use, if None uses active key
        :return: Encrypted blob: nonce(12) | ciphertext | tag(16)
        """
        if key is None:
            with self._lock:
                self._ensure_key_rotation()
                key = self._active_key

        nonce = os.urandom(self._NONCE_SIZE)
        encryptor = Cipher(
            algorithms.AES(key),
            modes.GCM(nonce),
            backend=default_backend()
        ).encryptor()

        padder = padding.PKCS7(128).padder()
        padded_data = padder.update(plaintext) + padder.finalize()

        ciphertext = encryptor.update(padded_data) + encryptor.finalize()
        return nonce + ciphertext + encryptor.tag

    def decrypt(self, encrypted_blob: bytes, key: Optional[bytes] = None) -> bytes:
        """
        Decrypt data using AES-256-GCM with given key or active key.
        Input expected to be nonce + ciphertext + tag concatenated.

        :param encrypted_blob: Nonce(12) | ciphertext | tag(16)
        :param key: AES key to use, if None uses active key
        :return: Original plaintext
        :raises InvalidTag on authentication error
        """
        if key is None:
            with self._lock:
                key = self._active_key

        if len(encrypted_blob) < self._NONCE_SIZE + self._TAG_SIZE:
            raise ValueError("Invalid encrypted data length")

        nonce = encrypted_blob[:self._NONCE_SIZE]
        tag = encrypted_blob[-self._TAG_SIZE:]
        ciphertext = encrypted_blob[self._NONCE_SIZE:-self._TAG_SIZE]

        decryptor = Cipher(
            algorithms.AES(key),
            modes.GCM(nonce, tag),
            backend=default_backend()
        ).decryptor()

        padded_plaintext = decryptor.update(ciphertext) + decryptor.finalize()

        unpadder = padding.PKCS7(128).unpadder()
        plaintext = unpadder.update(padded_plaintext) + unpadder.finalize()
        return plaintext

    def encrypt_field(self, plaintext: bytes, field_name: str) -> bytes:
        """
        Field-level encryption with unique derived key per field.
        Salt is derived from field name to generate unique keys.

        :param plaintext: Field data to encrypt
        :param field_name: Field identifier
        :return: Encrypted blob
        """
        salt = hashes.Hash(hashes.SHA256(), backend=default_backend())
        salt.update(field_name.encode("utf-8"))
        salt_bytes = salt.finalize()[:16]  # Use first 16 bytes as salt

        key = self.derive_key(salt_bytes)
        return self.encrypt(plaintext, key=key)

    def decrypt_field(self, encrypted_blob: bytes, field_name: str) -> bytes:
        """
        Decrypt field-level encrypted data with derived key.

        :param encrypted_blob: Encrypted field data
        :param field_name: Field identifier
        :return: Decrypted plaintext
        """
        salt = hashes.Hash(hashes.SHA256(), backend=default_backend())
        salt.update(field_name.encode("utf-8"))
        salt_bytes = salt.finalize()[:16]

        key = self.derive_key(salt_bytes)
        return self.decrypt(encrypted_blob, key=key)

    def transparent_data_encrypt(self, data: bytes) -> bytes:
        """
        Transparent encryption entry point for data-at-rest.
        Automatically manages key rotation and encryption.

        :param data: Plain data bytes
        :return: Encrypted bytes
        """
        with self._lock:
            self._ensure_key_rotation()
            return self.encrypt(data, self._active_key)

    def transparent_data_decrypt(self, encrypted_data: bytes) -> bytes:
        """
        Transparent data decryption using current or rotated keys.
        Tries active key first, fallback not implemented (could be extended).

        :param encrypted_data: Encrypted bytes
        :return: Decrypted bytes
        """
        with self._lock:
            try:
                return self.decrypt(encrypted_data, self._active_key)
            except InvalidTag:
                raise

    def get_active_key_id(self) -> Optional[str]:
        """Return active encryption key identifier."""
        with self._lock:
            return self._active_key_id
```