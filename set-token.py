#!/usr/bin/env python3
"""Зашифровать токен GitHub паролем старосты и положить в token.enc.

Запуск:  python3 set-token.py
Скрипт спросит токен (ввод не отображается), зашифрует его паролем
и закоммитит token.enc в репозиторий. Менять код сайта не нужно.

Токен и пароль вводятся с клавиатуры и в файлы репозитория в открытом
виде не попадают. Чтобы сменить пароль — запустить скрипт заново.
"""

import base64
import getpass
import json
import os
import pathlib
import subprocess
import sys

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ITERATIONS = 200_000
OUT = pathlib.Path(__file__).parent / "token.enc"


def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def main() -> int:
    token = getpass.getpass("Токен GitHub (github_pat_...): ").strip()
    if not token:
        print("Пусто — ничего не записано.")
        return 1

    password = getpass.getpass("Пароль старосты: ").strip()
    if not password:
        print("Пустой пароль — ничего не записано.")
        return 1

    salt = os.urandom(16)
    iv = os.urandom(12)

    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS)
    key = kdf.derive(password.encode())

    ciphertext = AESGCM(key).encrypt(iv, token.encode(), None)

    OUT.write_text(json.dumps({
        "v": 1,
        "kdf": "PBKDF2-SHA256",
        "iter": ITERATIONS,
        "salt": b64(salt),
        "iv": b64(iv),
        "ct": b64(ciphertext),
    }, indent=2) + "\n")

    print(f"Записан {OUT.name}.")

    try:
        subprocess.run(["git", "add", OUT.name], cwd=OUT.parent, check=True)
        subprocess.run(["git", "commit", "-m", "Ключ записи обновлён"], cwd=OUT.parent, check=True)
        subprocess.run(["git", "push"], cwd=OUT.parent, check=True)
        print("Отправлено на GitHub. Через минуту сайт примет пароль.")
    except subprocess.CalledProcessError:
        print("Коммит не прошёл — отправьте вручную: git add token.enc && git commit -m ключ && git push")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
