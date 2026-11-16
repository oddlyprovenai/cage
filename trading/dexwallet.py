"""Solana wallet for the NON-CUSTODIAL route (self-custody). Only generates, derives and stores; never sends.

- 24-word BIP39 seed generated on the Mac (Trezor `mnemonic` library, system entropy).
- Solana standard derivation m/44'/501'/0'/0' (SLIP-0010 ed25519): the same used by Phantom or Solflare, so
  the user can recover the wallet in any application with their words.
- The seed is stored INSIDE Cage's encrypted vault (AES-256-GCM with the user password key).
  Only read with an active user session. Never written to logs, responses, screenshots or off the Mac.
- The words are shown ONCE, on the user's screen, and verified to ensure they have been copied.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import struct

HARDENED = 0x80000000
PATH = (44, 501, 0, 0)


def new_mnemonic(strength: int = 256) -> str:
    from mnemonic import Mnemonic
    return Mnemonic("english").to_mnemonic(secrets.token_bytes(strength // 8))


def valid(words: str) -> bool:
    from mnemonic import Mnemonic
    return Mnemonic("english").check(words.strip())


def _slip10_ed25519(seed: bytes, path=PATH) -> bytes:
    """SLIP-0010 for ed25519 (hardened indices only). Returns 32-byte private key."""
    I = hmac.new(b"ed25519 seed", seed, hashlib.sha512).digest()
    k, c = I[:32], I[32:]
    for idx in path:
        data = b"\x00" + k + struct.pack(">I", idx | HARDENED)
        I = hmac.new(c, data, hashlib.sha512).digest()
        k, c = I[:32], I[32:]
    return k


def keypair(words: str, passphrase: str = ""):
    from mnemonic import Mnemonic
    from solders.keypair import Keypair
    seed = Mnemonic.to_seed(words.strip(), passphrase)
    return Keypair.from_seed(_slip10_ed25519(seed))


def address(words: str) -> str:
    return str(keypair(words).pubkey())


def quiz(words: str, n: int = 3) -> list[int]:
    """Positions (1..24) that the user must type to prove they copied the words."""
    k = len(words.split())
    return sorted(secrets.SystemRandom().sample(range(1, k + 1), n))


def check_quiz(words: str, answers: dict) -> bool:
    w = words.split()
    try:
        return all(w[int(i) - 1] == str(a).strip().lower() for i, a in answers.items()) and len(answers) >= 3
    except (ValueError, IndexError):
        return False
