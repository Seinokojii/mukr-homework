#!/usr/bin/env python3
"""Обновить версию board.js в index.html.

Браузеры кешируют board.js по адресу, поэтому после правки скрипта
у посетителей остаётся старая версия. Версия в адресе (?v=...) считается
от содержимого файла — меняется код, меняется адрес, кеш обходится.

Запускать после каждой правки board.js, перед коммитом:
    python3 bump.py
"""

import hashlib
import pathlib
import re
import sys

root = pathlib.Path(__file__).parent
index = root / "index.html"
script = root / "board.js"

ver = hashlib.sha256(script.read_bytes()).hexdigest()[:8]
html = index.read_text()
new = re.sub(r'<script src="board\.js(\?v=[0-9a-f]+)?"></script>',
             f'<script src="board.js?v={ver}"></script>', html)

if new == html:
    print(f"версия уже актуальна: {ver}")
    sys.exit(0)

index.write_text(new)
print(f"версия обновлена: {ver}")
