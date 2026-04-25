package com.multisoul.common;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/// AesGcmEncryptorTest: verifies round-trip encrypt/decrypt and that ciphertext differs from plaintext.
///
/// Data construction:
///   key = 64-char hex string (256-bit AES key)
///   plaintext = "secret-api-key-value"
///
/// Execution:
///   1. encrypt(plaintext) → ciphertext (base64-encoded IV + tag + ciphertext)
///   2. decrypt(ciphertext) → recovered plaintext
///   3. assert recovered == original
///   4. assert ciphertext != plaintext (encryption actually happened)
///
/// Expected:
///   - decrypted value equals original plaintext
///   - ciphertext is different from plaintext
///   - tampered ciphertext throws exception
class AesGcmEncryptorTest {

    private static final String KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    @Test
    void encryptAndDecryptRoundTrip() {
        AesGcmEncryptor encryptor = new AesGcmEncryptor(KEY_HEX);
        String plaintext = "secret-api-key-value";

        String ciphertext = encryptor.encrypt(plaintext);
        String decrypted = encryptor.decrypt(ciphertext);

        assertThat(decrypted)
            .as("decrypted value must equal original plaintext")
            .isEqualTo(plaintext);
        assertThat(ciphertext)
            .as("ciphertext must differ from plaintext — encryption did not occur")
            .isNotEqualTo(plaintext);
    }

    @Test
    void differentEncryptionsProduceDifferentCiphertexts() {
        AesGcmEncryptor encryptor = new AesGcmEncryptor(KEY_HEX);
        String plaintext = "same-value";

        String ct1 = encryptor.encrypt(plaintext);
        String ct2 = encryptor.encrypt(plaintext);

        assertThat(ct1)
            .as("two encryptions of same plaintext must differ (random IV)")
            .isNotEqualTo(ct2);
    }

    @Test
    void tamperedCiphertextThrows() {
        AesGcmEncryptor encryptor = new AesGcmEncryptor(KEY_HEX);
        String ciphertext = encryptor.encrypt("original");
        String tampered = ciphertext.substring(0, ciphertext.length() - 4) + "XXXX";

        assertThatThrownBy(() -> encryptor.decrypt(tampered))
            .as("tampered ciphertext must throw — GCM authentication tag mismatch")
            .isInstanceOf(RuntimeException.class);
    }
}
