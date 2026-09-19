(function () {
  var REPO = "Seinokojii/mukr-homework";
  var FILE = "homework.json";
  var API = "https://api.github.com/repos/" + REPO + "/contents/" + FILE;
  var RAW = "https://raw.githubusercontent.com/" + REPO + "/main/" + FILE;

  var SUBJECTS = [
    { id: "informatika",   name: "Информатика",   full: "Инновационная информатика" },
    { id: "matematika",    name: "Математика",     full: "Математика" },
    { id: "vyshmat",       name: "Вышмат",         full: "Высшая математика" },
    { id: "matlogika",     name: "Матлогика",      full: "Математическая логика" },
    { id: "fizika",        name: "Физика",         full: "Физика" },
    { id: "elektro",       name: "Электротехника", full: "Электротехника" },
    { id: "grafika",       name: "Графика",        full: "Компьютерная графика" },
    { id: "modelirovanie", name: "Моделирование",  full: "Компьютерное моделирование" },
    { id: "russkiy",       name: "Русский",        full: "Русский язык" },
    { id: "kyrgyzskiy",    name: "Кыргызский",     full: "Кыргызский язык" },
    { id: "angliyskiy",    name: "Английский",     full: "Английский язык" }
  ];

  var state = { subjects: {}, updated: null };
  var sha = null;
  var token = null;
  var onlyTasks = false;
  var open = {};
  var saving = false;
  var pending = {};   // выбранные, ещё не загруженные файлы: {subjectId: [part]}
  var dropped = {};   // вложения, помеченные к удалению: {subjectId: [path]}

  try { token = sessionStorage.getItem("hw-token"); } catch (e) {}

  var board = document.getElementById("board");
  var nextEl = document.getElementById("next");
  var loginBtn = document.getElementById("loginBtn");
  var loginLabel = document.getElementById("loginLabel");
  var fAll = document.getElementById("fAll");
  var fTask = document.getElementById("fTask");

  var PENCIL = '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>';
  var CHECK = '<path d="M20 6 9 17l-5-5"></path>';
  var PLUS = '<path d="M12 5v14"></path><path d="M5 12h14"></path>';
  var CLIP = '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>';

  function icon(p) { return '<svg viewBox="0 0 24 24">' + p + "</svg>"; }
  function has(rec) { return !!(rec && ((rec.text && rec.text.trim()) || (rec.files && rec.files.length))); }

  function fmtDate(iso) {
    if (!iso) return "";
    var p = iso.split("-");
    return p.length === 3 ? p[2] + "." + p[1] : iso;
  }
  function fmtStamp(ms) {
    if (!ms) return "";
    var d = new Date(ms), t = function (n) { return n < 10 ? "0" + n : "" + n; };
    return t(d.getDate()) + "." + t(d.getMonth() + 1) + " в " + t(d.getHours()) + ":" + t(d.getMinutes());
  }
  function daysLeft(iso) {
    if (!iso) return null;
    var due = new Date(iso + "T23:59:59");
    if (isNaN(due.getTime())) return null;
    return Math.ceil((due - new Date()) / 86400000);
  }
  function dueLabel(iso) {
    var d = daysLeft(iso);
    if (d === null) return "";
    if (d < 0) return "срок прошёл";
    if (d === 0) return "сегодня";
    if (d === 1) return "завтра";
    return "до " + fmtDate(iso);
  }

  function toast(msg) {
    var old = document.querySelector(".toast");
    if (old) old.remove();
    var t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.remove(); }, 3600);
  }

  function b64encode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = "";
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  }
  function b64decode(b64) {
    var bin = atob(b64.replace(/\n/g, ""));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // Чтение идёт с raw.githubusercontent — там нет лимита на число запросов,
  // поэтому доску может одновременно открывать сколько угодно человек.
  // GitHub API вызывается только при записи (и для получения sha старостой).
  function load() {
    return fetch(RAW + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      })
      .then(function (parsed) {
        state = parsed && parsed.subjects ? parsed : { subjects: {}, updated: null };
        render();
      })
      .catch(function () {
        // запасной путь — файл, отданный самим Pages
        return fetch(FILE + "?t=" + Date.now(), { cache: "no-store" })
          .then(function (r) { return r.json(); })
          .then(function (parsed) {
            state = parsed && parsed.subjects ? parsed : { subjects: {}, updated: null };
            render();
          })
          .catch(function () {
            render();
            toast("Не удалось загрузить задания");
          });
      });
  }

  // sha нужен только тому, кто пишет: запрашивается один раз, при входе
  function refreshSha() {
    if (!token) return Promise.resolve();
    return fetch(API + "?ref=main&t=" + Date.now(), {
      cache: "no-store",
      headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" }
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) sha = d.sha; })
      .catch(function () {});
  }

  function save(id, text, due, atts) {
    if (saving) return;
    var next = { subjects: {}, updated: Date.now() };
    SUBJECTS.forEach(function (s) {
      if (state.subjects[s.id]) next.subjects[s.id] = state.subjects[s.id];
    });
    var clean = (text || "").trim();
    atts = atts || [];
    if (clean || atts.length) {
      next.subjects[id] = { text: clean, due: due || "", updated: Date.now(), files: atts };
    } else {
      delete next.subjects[id];
    }

    var payload = {
      message: clean ? "Задание: " + id : "Убрано задание: " + id,
      content: b64encode(JSON.stringify(next, null, 2) + "\n"),
      branch: "main"
    };
    if (sha) payload.sha = sha;

    saving = true;
    toast("Сохраняю…");

    fetch(API, {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw { kind: "auth" };
      if (r.status === 409 || r.status === 422) throw { kind: "conflict" };
      if (!r.ok) throw { kind: "other" };
      return r.json();
    }).then(function (res) {
      sha = res.content.sha;
      state = next;
      open[id] = false;
      render();
      toast("Сохранено");
    }).catch(function (e) {
      if (e && e.kind === "auth") {
        toast("Токен не принят: нужен доступ Contents: write");
        setEditor(null);
      } else if (e && e.kind === "conflict") {
        toast("Кто-то записал раньше — перечитываю");
        load().then(refreshSha);
      } else {
        toast("Не удалось сохранить");
      }
    }).then(function () { saving = false; });
  }


  // --- вложения --------------------------------------------------------------
  var MAX_DOC = 25 * 1024 * 1024;  // 25 МБ: выше ~37 МБ GitHub отклоняет запрос (base64 +33%)
  var IMG_SIDE = 1600;             // длинная сторона фото после сжатия

  function fileToDataParts(file) {
    // фото ужимаем, остальное берём как есть
    if (/^image\//.test(file.type) && file.type !== "image/gif") {
      return shrinkImage(file);
    }
    if (file.size > MAX_DOC) {
      return Promise.reject({ kind: "too-big", name: file.name });
    }
    return file.arrayBuffer().then(function (buf) {
      return { name: file.name, type: file.type || "application/octet-stream", bytes: new Uint8Array(buf) };
    });
  }

  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var scale = Math.min(1, IMG_SIDE / Math.max(img.width, img.height));
        var cv = document.createElement("canvas");
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob(function (blob) {
          URL.revokeObjectURL(url);
          if (!blob) { reject({ kind: "image" }); return; }
          blob.arrayBuffer().then(function (buf) {
            resolve({
              name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
              type: "image/jpeg",
              bytes: new Uint8Array(buf)
            });
          });
        }, "image/jpeg", 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject({ kind: "image" }); };
      img.src = url;
    });
  }

  function bytesToB64(bytes) {
    var bin = "", chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function safeName(name) {
    return name.replace(/[^\w.\-]+/g, "_").slice(-60);
  }

  function uploadFile(subjectId, part) {
    var path = "files/" + subjectId + "/" + Date.now() + "-" + safeName(part.name);
    var url = "https://api.github.com/repos/" + REPO + "/contents/" + path;
    return fetch(url, {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: "Вложение: " + subjectId,
        content: bytesToB64(part.bytes),
        branch: "main"
      })
    }).then(function (r) {
      if (!r.ok) throw { kind: "upload", name: part.name };
      return { path: path, name: part.name, type: part.type, size: part.bytes.length };
    });
  }

  // Удаление файла. GitHub отвечает 409, если в ветку пишет что-то ещё,
  // поэтому при конфликте пробуем ещё раз со свежим sha.
  function deleteFile(path, attempt) {
    var url = "https://api.github.com/repos/" + REPO + "/contents/" + path;
    return fetch(url + "?ref=main&t=" + Date.now(), {
      cache: "no-store",
      headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" }
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return null;
        return fetch(url, {
          method: "DELETE",
          headers: {
            Authorization: "Bearer " + token,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ message: "Убрано вложение", sha: d.sha, branch: "main" })
        }).then(function (r) {
          if ((r.status === 409 || r.status === 422) && !attempt) {
            return new Promise(function (res) { setTimeout(res, 1200); })
              .then(function () { return deleteFile(path, 1); });
          }
          return null;
        });
      }).catch(function () { return null; });
  }

  function fileUrl(path) {
    return "https://raw.githubusercontent.com/" + REPO + "/main/" + path;
  }

  function humanSize(n) {
    if (n < 1024) return n + " Б";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " КБ";
    return (n / 1024 / 1024).toFixed(1) + " МБ";
  }

  function isImage(att) { return /^image\//.test(att.type || ""); }


  // Сохранение с вложениями: сначала файлы в репозиторий, затем сама запись
  function commit(id, text, due, keepFiles) {
    if (saving) return;
    var parts = pending[id] || [];
    var toRemove = (dropped[id] || []).slice();
    var base = (keepFiles || []).slice();

    if (!parts.length) {
      finish(base);
      return;
    }

    saving = true;
    var heavy = parts.reduce(function (n, p) { return n + p.bytes.length; }, 0) > 8 * 1024 * 1024;
    toast(heavy ? "Загружаю, файлы крупные — это займёт до минуты…"
                : (parts.length === 1 ? "Загружаю файл…" : "Загружаю файлы…"));
    var chain = Promise.resolve([]);
    parts.forEach(function (part) {
      chain = chain.then(function (acc) {
        return uploadFile(id, part).then(function (att) { return acc.concat([att]); });
      });
    });
    chain.then(function (uploaded) {
      saving = false;
      pending[id] = [];
      finish(base.concat(uploaded));
    }).catch(function (e) {
      saving = false;
      toast("Не удалось загрузить «" + ((e && e.name) || "файл") + "»");
    });

    function finish(atts) {
      // последовательно: параллельные записи в одну ветку дают 409
      var chain = Promise.resolve();
      toRemove.forEach(function (path) {
        chain = chain.then(function () { return deleteFile(path); });
      });
      chain.then(function () {
        dropped[id] = [];
        save(id, text, due, atts);
      });
    }
  }

  function setEditor(t) {
    token = t;
    try {
      if (t) sessionStorage.setItem("hw-token", t);
      else sessionStorage.removeItem("hw-token");
    } catch (e) {}
    open = {};
    render();
  }

  // --- пароль -> зашифрованный токен ---------------------------------------
  function fromB64(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function unlock(password) {
    return fetch("token.enc?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw { kind: "no-file" };
        return r.json();
      })
      .then(function (box) {
        var enc = new TextEncoder();
        return crypto.subtle
          .importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"])
          .then(function (base) {
            return crypto.subtle.deriveKey(
              { name: "PBKDF2", salt: fromB64(box.salt), iterations: box.iter || 200000, hash: "SHA-256" },
              base,
              { name: "AES-GCM", length: 256 },
              false,
              ["decrypt"]
            );
          })
          .then(function (key) {
            return crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(box.iv) }, key, fromB64(box.ct));
          })
          .then(function (buf) {
            return new TextDecoder().decode(buf).trim();
          });
      });
  }

  function render() {
    board.textContent = "";

    var list = SUBJECTS.slice();
    if (onlyTasks) list = list.filter(function (s) { return has(state.subjects[s.id]) || open[s.id]; });

    if (!list.length) {
      var e = document.createElement("p");
      e.className = "none";
      e.style.padding = "22px 4px";
      e.textContent = "Заданий сейчас нет ни по одному предмету.";
      board.appendChild(e);
    }

    list.forEach(function (s) {
      var rec = state.subjects[s.id];
      var active = has(rec);

      var row = document.createElement("div");
      row.className = "row" + (active ? " active" : "");

      var subj = document.createElement("div");
      subj.className = "subj";
      var nm = document.createElement("span");
      nm.className = "name";
      nm.textContent = s.name;
      var fl = document.createElement("span");
      fl.className = "full";
      fl.textContent = s.full;
      subj.appendChild(nm);
      subj.appendChild(fl);
      row.appendChild(subj);

      var col = document.createElement("div");
      col.className = "body-col";

      if (open[s.id]) {
        var ta = document.createElement("textarea");
        ta.id = "ta-" + s.id;
        ta.placeholder = "Что задали: страницы, номера, что принести";
        ta.value = rec && rec.text ? rec.text : "";
        col.appendChild(ta);

        var r1 = document.createElement("div");
        r1.className = "edit-row";
        var lb = document.createElement("label");
        lb.setAttribute("for", "due-" + s.id);
        lb.textContent = "сдать до";
        var due = document.createElement("input");
        due.type = "date";
        due.id = "due-" + s.id;
        due.style.width = "auto";
        due.value = rec && rec.due ? rec.due : "";
        r1.appendChild(lb);
        r1.appendChild(due);
        col.appendChild(r1);

        // уже прикреплённые файлы
        var keep = ((rec && rec.files) || []).filter(function (f) {
          return (dropped[s.id] || []).indexOf(f.path) < 0;
        });
        if (keep.length || (pending[s.id] || []).length) {
          var list = document.createElement("div");
          list.className = "att-list";
          keep.forEach(function (f) {
            var chip = document.createElement("span");
            chip.className = "att";
            chip.appendChild(document.createTextNode(f.name + " · " + humanSize(f.size)));
            var x = document.createElement("button");
            x.className = "att-x";
            x.type = "button";
            x.title = "Убрать файл";
            x.textContent = "×";
            x.onclick = function () {
              (dropped[s.id] = dropped[s.id] || []).push(f.path);
              render();
            };
            chip.appendChild(x);
            list.appendChild(chip);
          });
          (pending[s.id] || []).forEach(function (part, i) {
            var chip = document.createElement("span");
            chip.className = "att new";
            chip.appendChild(document.createTextNode(part.name + " · " + humanSize(part.bytes.length)));
            var x = document.createElement("button");
            x.className = "att-x";
            x.type = "button";
            x.title = "Убрать файл";
            x.textContent = "×";
            x.onclick = function () { pending[s.id].splice(i, 1); render(); };
            chip.appendChild(x);
            list.appendChild(chip);
          });
          col.appendChild(list);
        }

        var rf = document.createElement("div");
        rf.className = "edit-row";
        var pick = document.createElement("input");
        pick.type = "file";
        pick.id = "file-" + s.id;
        pick.multiple = true;
        pick.accept = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt";
        pick.hidden = true;
        pick.onchange = function () {
          var files = [...pick.files];
          pick.value = "";
          if (!files.length) return;
          toast("Готовлю файлы…");
          Promise.all(files.map(fileToDataParts))
            .then(function (parts) {
              pending[s.id] = (pending[s.id] || []).concat(parts);
              render();
            })
            .catch(function (e) {
              if (e && e.kind === "too-big") toast("Файл «" + e.name + "» больше 25 МБ");
              else toast("Не удалось прочитать файл");
            });
        };
        var pickBtn = document.createElement("button");
        pickBtn.className = "btn";
        pickBtn.innerHTML = icon(CLIP) + "Прикрепить файл";
        pickBtn.onclick = function () { pick.click(); };
        rf.appendChild(pick);
        rf.appendChild(pickBtn);
        col.appendChild(rf);

        var r2 = document.createElement("div");
        r2.className = "edit-row";
        var saveBtn = document.createElement("button");
        saveBtn.className = "btn primary";
        saveBtn.innerHTML = icon(CHECK) + "Сохранить";
        saveBtn.onclick = function () { commit(s.id, ta.value, due.value, keep); };
        var cancel = document.createElement("button");
        cancel.className = "btn";
        cancel.textContent = "Отмена";
        cancel.onclick = function () { pending[s.id] = []; dropped[s.id] = []; open[s.id] = false; render(); };
        r2.appendChild(saveBtn);
        r2.appendChild(cancel);
        if (active) {
          var del = document.createElement("button");
          del.className = "btn danger";
          del.textContent = "Убрать";
          del.onclick = function () {
            // снимаем и сами файлы, иначе они останутся в репозитории
            dropped[s.id] = ((rec && rec.files) || []).map(function (f) { return f.path; });
            commit(s.id, "", "", []);
          };
          r2.appendChild(del);
        }
        col.appendChild(r2);
      } else {
        var bodyP = document.createElement("p");
        if (active) { bodyP.className = "task"; bodyP.textContent = rec.text; }
        else { bodyP.className = "none"; bodyP.textContent = "ничего не задано"; }
        col.appendChild(bodyP);

        if (active && rec.files && rec.files.length) {
          var gallery = document.createElement("div");
          gallery.className = "att-view";
          rec.files.forEach(function (f) {
            var a = document.createElement("a");
            a.href = fileUrl(f.path);
            a.target = "_blank";
            a.rel = "noopener";
            if (isImage(f)) {
              a.className = "thumb";
              var im = document.createElement("img");
              im.src = fileUrl(f.path);
              im.alt = f.name;
              im.loading = "lazy";
              a.appendChild(im);
            } else {
              a.className = "att doc";
              a.textContent = f.name + " · " + humanSize(f.size);
            }
            gallery.appendChild(a);
          });
          col.appendChild(gallery);
        }

        var chips = document.createElement("div");
        chips.className = "chips";
        if (active && rec.due) {
          var c = document.createElement("span");
          c.className = "chip";
          c.textContent = dueLabel(rec.due);
          chips.appendChild(c);
        }
        if (active && rec.updated) {
          var u = document.createElement("span");
          u.className = "chip plain";
          u.textContent = "записано " + fmtStamp(rec.updated);
          chips.appendChild(u);
        }
        if (token) {
          var ed = document.createElement("button");
          ed.className = "btn";
          ed.innerHTML = icon(active ? PENCIL : PLUS) + (active ? "Изменить" : "Записать");
          ed.onclick = function () { pending[s.id] = []; dropped[s.id] = []; open[s.id] = true; render(); };
          chips.appendChild(ed);
        }
        if (chips.children.length) col.appendChild(chips);
      }

      row.appendChild(col);
      board.appendChild(row);
    });

    var soon = null;
    SUBJECTS.forEach(function (s) {
      var rec = state.subjects[s.id];
      if (!has(rec) || !rec.due) return;
      var d = daysLeft(rec.due);
      if (d === null || d < 0) return;
      if (!soon || d < soon.d) soon = { d: d, s: s, rec: rec };
    });
    var count = SUBJECTS.filter(function (s) { return has(state.subjects[s.id]); }).length;
    if (soon) {
      nextEl.textContent = "";
      var pre = document.createTextNode("ближайшее: ");
      var b = document.createElement("b");
      b.textContent = soon.s.name;
      var post = document.createTextNode(" — " + dueLabel(soon.rec.due));
      nextEl.appendChild(pre); nextEl.appendChild(b); nextEl.appendChild(post);
    } else if (count) {
      nextEl.textContent = "записи есть, сроки не проставлены";
    } else {
      nextEl.textContent = "записей пока нет";
    }

    loginLabel.textContent = token ? "Режим записи" : "Староста";
    loginBtn.classList.toggle("on", !!token);
    fAll.classList.toggle("on", !onlyTasks);
    fTask.classList.toggle("on", onlyTasks);
  }

  fAll.onclick = function () { onlyTasks = false; render(); };
  fTask.onclick = function () { onlyTasks = true; render(); };

  var dlg = document.getElementById("loginDlg");
  var pwd = document.getElementById("pwd");
  var pwdErr = document.getElementById("pwdErr");

  loginBtn.onclick = function () {
    if (token) {
      setEditor(null);
      toast("Режим записи выключен");
      return;
    }
    pwdErr.hidden = true;
    pwd.value = "";
    dlg.showModal();
    pwd.focus();
  };
  document.getElementById("cancelLogin").onclick = function () { dlg.close(); };
  document.getElementById("doLogin").onclick = tryLogin;
  pwd.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); tryLogin(); }
  });

  function tryLogin() {
    var password = (pwd.value || "").trim();
    if (!password) { showPwdError("Введите пароль"); return; }
    pwdErr.hidden = true;

    unlock(password)
      .then(function (secret) {
        return fetch(API + "?ref=main", {
          headers: { Authorization: "Bearer " + secret, Accept: "application/vnd.github+json" }
        }).then(function (r) {
          if (!r.ok) throw { kind: "token" };
          return r.json();
        }).then(function (data) {
          sha = data.sha;
          dlg.close();
          setEditor(secret);
          toast("Режим записи включён");
        });
      })
      .catch(function (e) {
        if (e && e.kind === "no-file") showPwdError("Запись ещё не настроена: нет файла token.enc");
        else if (e && e.kind === "token") showPwdError("Ключ устарел — нужно перевыпустить токен");
        else showPwdError("Неверный пароль");
      });
  }

  function showPwdError(msg) {
    pwdErr.textContent = msg;
    pwdErr.hidden = false;
  }

  render();
  load().then(refreshSha);
})();
