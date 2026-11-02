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
  // Быстрый показ: файл со своего домена (он же работает там, где raw закрыт).
  // Свежесть добирает refreshFromApi сразу после этого.
  function load() {
    return fetch(FILE + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      })
      .then(function (parsed) {
        state = parsed && parsed.subjects ? parsed : { subjects: {}, updated: null };
        render();
      })
      .catch(function () {
        return fetch(RAW + "?t=" + Date.now(), { cache: "no-store" })
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

  // Пишущему нужны и версия файла, и АКТУАЛЬНОЕ содержимое — строго из одного
  // ответа API. raw отстаёт на минуты: если взять состояние оттуда, а версию
  // отсюда, своя запись затрёт чужую свежую (так пропала запись по математике).
  function refreshFromApi(quiet) {
    var headers = { Accept: "application/vnd.github+json" };
    if (token) headers.Authorization = "Bearer " + token;
    return fetch(API + "?ref=main&t=" + Date.now(), { cache: "no-store", headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return false;
        if (token) sha = d.sha;
        try {
          var parsed = JSON.parse(b64decode(d.content));
          if (!parsed || !parsed.subjects) return false;
          var changed = JSON.stringify(parsed.subjects) !== JSON.stringify(state.subjects) ||
            JSON.stringify(parsed.hidden || []) !== JSON.stringify(state.hidden || []) ||
            JSON.stringify(parsed.custom || []) !== JSON.stringify(state.custom || []);
          state = parsed;
          // не перерисовываем поверх открытого редактора — иначе пропадёт набранный текст
          var editing = Object.keys(open).some(function (k) { return open[k]; });
          if (!quiet && changed && !editing) render();
        } catch (e) {}
        return true;
      })
      .catch(function () { return false; });
  }

  function save(id, text, due, atts, retried) {
    if (saving) return;
    saving = true;
    // берём свежее состояние с сервера и кладём свою запись поверх него
    refreshFromApi(true).then(function () {
      saving = false;
      writeRecord(id, text, due, atts, retried);
    });
  }

  function writeRecord(id, text, due, atts, retried) {
    var next = { subjects: {}, updated: Date.now() };
    allSubjects().forEach(function (s) {
      if (state.subjects[s.id]) next.subjects[s.id] = state.subjects[s.id];
    });
    keepMeta(next);
    var clean = (text || "").trim();
    atts = atts || [];
    if (clean || atts.length) {
      next.subjects[id] = { text: clean, due: due || "", updated: Date.now(), files: atts };
    } else {
      delete next.subjects[id];
    }

    var payload = {
      message: (clean || atts.length) ? "Задание: " + id : "Убрано задание: " + id,
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
        if (!retried) {
          toast("Кто-то записал раньше — повторяю поверх свежей версии");
          refreshFromApi().then(function () {
            writeRecord(id, text, due, atts, true);
          });
        } else {
          toast("Не удалось сохранить: доску изменили одновременно");
          refreshFromApi();
        }
      } else {
        toast("Не удалось сохранить");
      }
    }).then(function () { saving = false; });
  }


  // --- скрытые предметы --------------------------------------------------------
  // Предмет не удаляется: id попадает в "hidden" файла homework.json, поэтому
  // его можно вернуть, а задания и файлы остаются на месте.
  function allSubjects() { return SUBJECTS.concat(state.custom || []); }
  function subjectById(id) { return allSubjects().filter(function (s) { return s.id === id; })[0]; }
  function hiddenList() {
    return (state.hidden || []).filter(function (id) { return !!subjectById(id); });
  }
  function visibleSubjects() {
    var h = hiddenList();
    return allSubjects().filter(function (s) { return h.indexOf(s.id) < 0; });
  }
  // общие части файла, которые не должна потерять ни одна запись
  function keepMeta(next) {
    if (hiddenList().length) next.hidden = hiddenList();
    if ((state.custom || []).length) next.custom = state.custom;
    return next;
  }

  // Одна запись файла с повтором при конфликте: состояние собирается заново
  // из свежей версии, чтобы чужая запись не пропала.
  function putNext(build, message, okMsg, retried, after) {
    if (saving) return;
    var next = build();
    if (!next) return;
    var payload = {
      message: message,
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
      open = {};
      render();
      toast(okMsg);
      if (after) after(next);
    }).catch(function (e) {
      saving = false;
      if (e && e.kind === "auth") {
        toast("Токен не принят: нужен доступ Contents: write");
        setEditor(null);
      } else if (e && e.kind === "conflict" && !retried) {
        toast("Кто-то записал раньше — повторяю поверх свежей версии");
        refreshFromApi(true).then(function () { putNext(build, message, okMsg, true, after); });
      } else if (e && e.kind === "conflict") {
        toast("Не удалось сохранить: доску изменили одновременно");
        refreshFromApi();
      } else {
        toast("Не удалось сохранить");
      }
    }).then(function () { saving = false; });
  }

  function setHidden(id, hide) {
    var sub = subjectById(id);
    putNext(function () {
      var next = { subjects: state.subjects, updated: Date.now() };
      var h = hiddenList().filter(function (x) { return x !== id; });
      if (hide) h.push(id);
      if (h.length) next.hidden = h;
      if ((state.custom || []).length) next.custom = state.custom;
      return next;
    }, (hide ? "Предмет убран: " : "Предмет возвращён: ") + id,
       hide ? "Предмет «" + sub.name + "» убран" : "Предмет «" + sub.name + "» возвращён");
  }

  function addSubject() {
    var raw = prompt("Название нового предмета");
    if (raw === null) return;
    var name = raw.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!name) { toast("Название не может быть пустым"); return; }
    var dup = allSubjects().some(function (s) {
      return s.name.toLowerCase() === name.toLowerCase() || s.full.toLowerCase() === name.toLowerCase();
    });
    if (dup) { toast("Такой предмет уже есть — вернуть убранный можно внизу"); return; }
    var id = "c" + Date.now().toString(36);
    putNext(function () {
      var next = { subjects: state.subjects, updated: Date.now() };
      if (hiddenList().length) next.hidden = hiddenList();
      next.custom = (state.custom || []).concat([{ id: id, name: name, full: "" }]);
      return next;
    }, "Предмет добавлен: " + name, "Предмет «" + name + "» добавлен");
  }

  // --- редактор кода: выбрать параметр — код меняется сразу ------------------------
  // Окно с файлом homework.json: выбираешь параметр (задание, срок, название),
  // правишь значение — строка в коде меняется и подсвечивается; можно править и
  // сам код. «Сохранить» пишет файл на GitHub так же, как обычная запись.
  var ce = null, ceCur = null, ceBase = null, ceAt = {}, ceParams = [];
  var CE_LH = 22, CE_PAD = 8;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function ceSubjects(o) { return SUBJECTS.concat((o && Array.isArray(o.custom)) ? o.custom : []); }

  function ceValidate(o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return "Код должен начинаться с { и быть объектом";
    var i;
    if (o.custom !== undefined) {
      if (!Array.isArray(o.custom)) return "custom: нужен список [ ... ]";
      var seen = {};
      for (i = 0; i < o.custom.length; i++) {
        var c = o.custom[i];
        if (!c || typeof c.id !== "string" || !/^c[a-z0-9]+$/.test(c.id)) return "custom, предмет " + (i + 1) + ": id вида c1abc";
        if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 40) return "custom, предмет " + (i + 1) + ": название от 1 до 40 символов";
        if (c.full !== undefined && typeof c.full !== "string") return "custom, предмет " + (i + 1) + ": full — строка";
        if (seen[c.id]) return "custom: id «" + c.id + "» повторяется";
        seen[c.id] = 1;
      }
    }
    var ids = {};
    ceSubjects(o).forEach(function (x) { ids[x.id] = 1; });
    if (!o.subjects || typeof o.subjects !== "object" || Array.isArray(o.subjects)) return "subjects: нужен объект { ... }";
    var keys = Object.keys(o.subjects);
    for (i = 0; i < keys.length; i++) {
      var k = keys[i], r = o.subjects[k];
      if (!ids[k]) return "subjects: нет такого предмета «" + k + "»";
      if (!r || typeof r !== "object") return k + ": запись должна быть объектом";
      if (typeof r.text !== "string") return k + ": text — строка в кавычках";
      if (typeof r.due !== "string" || (r.due && !DATE_RE.test(r.due))) return k + ": due — пустая строка или дата 2026-12-31";
      if (r.files !== undefined) {
        if (!Array.isArray(r.files)) return k + ": files — список";
        for (var j = 0; j < r.files.length; j++) {
          var f = r.files[j];
          if (!f || typeof f.path !== "string" || typeof f.name !== "string" || typeof f.size !== "number") return k + ", файл " + (j + 1) + ": нужны path, name, size";
        }
      }
    }
    if (o.hidden !== undefined) {
      if (!Array.isArray(o.hidden)) return "hidden: нужен список";
      for (i = 0; i < o.hidden.length; i++) if (!ids[o.hidden[i]]) return "hidden: нет предмета «" + o.hidden[i] + "»";
    }
    return null;
  }

  // какая строка кода отвечает за какой параметр
  function ceFindAt(text) {
    var map = {}, section = null, sub = null, cust = null;
    text.split("\n").forEach(function (line, i) {
      var m = /^  "(subjects|hidden|custom|updated)":/.exec(line);
      if (m) { section = m[1]; sub = null; cust = null; return; }
      if (section === "subjects") {
        m = /^    "([^"]+)": \{/.exec(line);
        if (m) { sub = m[1]; return; }
        m = /^      "(text|due)":/.exec(line);
        if (m && sub) map[sub + "." + m[1]] = i;
      } else if (section === "custom") {
        m = /^      "id": "([^"]+)"/.exec(line);
        if (m) cust = m[1];
        if (/^      "name":/.test(line) && cust) map[cust + ".name"] = i;
      }
    });
    return map;
  }

  function ceBuildParams() {
    ceParams = [];
    ceSubjects(ceCur).forEach(function (sub) {
      ceParams.push({ id: sub.id + ".text", group: sub.name, label: sub.name + ": задание", short: sub.name + " · задание", kind: "text" });
      ceParams.push({ id: sub.id + ".due", group: sub.name, label: sub.name + ": сдать до", short: sub.name + " · срок", kind: "date" });
      if (/^c/.test(sub.id) && (ceCur.custom || []).some(function (c) { return c.id === sub.id; })) {
        ceParams.push({ id: sub.id + ".name", group: sub.name, label: sub.name + ": название предмета", short: sub.name + " · название", kind: "name" });
      }
    });
  }
  function ceParam(id) { return ceParams.filter(function (p) { return p.id === id; })[0]; }
  function ceGet(p) {
    var sid = p.id.split(".")[0], f = p.id.split(".")[1];
    if (f === "name") { var c = (ceCur.custom || []).filter(function (x) { return x.id === sid; })[0]; return c ? c.name : ""; }
    var r = ceCur.subjects[sid];
    return r ? (r[f] || "") : "";
  }
  function ceSet(p, v) {
    var sid = p.id.split(".")[0], f = p.id.split(".")[1];
    if (f === "name") {
      var name = v.replace(/\s+/g, " ").trim();
      if (!name) return "Название не может быть пустым";
      if (name.length > 40) return "Название длиннее 40 символов";
      var dup = ceSubjects(ceCur).some(function (x) { return x.id !== sid && x.name.toLowerCase() === name.toLowerCase(); });
      if (dup) return "Такой предмет уже есть";
      ceCur.custom.forEach(function (c) { if (c.id === sid) c.name = name; });
      return null;
    }
    var r = ceCur.subjects[sid];
    if (f === "due" && v && !DATE_RE.test(v)) return "Дата вида 2026-12-31";
    if (!r) {
      if (!v) return null;
      r = ceCur.subjects[sid] = { text: "", due: "", updated: Date.now(), files: [] };
    }
    r[f] = v;
    r.updated = Date.now();
    if (!r.text.trim() && !(r.files || []).length && !r.due) delete ceCur.subjects[sid];
    return null;
  }

  function ceSay(t, cls) { ce.msg.textContent = t; ce.msg.className = "ce-msg" + (cls ? " " + cls : ""); }
  function ceWrite() { ce.ta.value = JSON.stringify(ceCur, null, 2); ceAt = ceFindAt(ce.ta.value); }
  function ceBand(line, scroll) {
    if (line === undefined) { ce.band.style.display = "none"; return; }
    ce.band.style.display = "block";
    if (scroll) {
      var top = line * CE_LH, vis = ce.ta.clientHeight;
      if (top < ce.ta.scrollTop || top + CE_LH > ce.ta.scrollTop + vis) ce.ta.scrollTop = Math.max(0, top - vis / 2 + CE_LH);
    }
    ce.band.style.top = (CE_PAD + line * CE_LH - ce.ta.scrollTop) + "px";
  }
  function ceFillSelect(keep) {
    ceBuildParams();
    ce.sel.textContent = "";
    var grp = null, last = null;
    ceParams.forEach(function (p) {
      if (p.group !== last) { grp = document.createElement("optgroup"); grp.label = p.group; ce.sel.appendChild(grp); last = p.group; }
      var o = document.createElement("option"); o.value = p.id; o.textContent = p.short; grp.appendChild(o);
    });
    ce.sel.value = ceParam(keep) ? keep : ceParams[0].id;
  }
  function ceShow() {
    var p = ceParam(ce.sel.value); if (!p) return;
    ce.lab.textContent = p.label;
    ce.txt.hidden = p.kind !== "text";
    ce.inp.hidden = p.kind === "text";
    if (p.kind === "text") ce.txt.value = ceGet(p);
    else { ce.inp.type = p.kind === "date" ? "date" : "text"; ce.inp.value = ceGet(p); }
    ceBand(ceAt[p.id], true);
  }
  function ceOnParam() {
    var p = ceParam(ce.sel.value), v = p.kind === "text" ? ce.txt.value : ce.inp.value;
    var snapshot = JSON.stringify(ceCur);
    var err = ceSet(p, v);
    if (err) { ceCur = JSON.parse(snapshot); ceSay("Не принято: " + err, "err"); return; }
    ceWrite(); ceBand(ceAt[p.id], true);
    ceSay("Код обновлён. Нажмите «Сохранить», чтобы увидели все.", "ok");
  }
  function ceOnCode() {
    var o;
    try { o = JSON.parse(ce.ta.value); } catch (e) { ceSay("Ошибка в коде: " + e.message.replace(/^JSON\.parse: /, ""), "err"); return; }
    var err = ceValidate(o);
    if (err) { ceSay("Не принято: " + err, "err"); return; }
    ceCur = o; ceAt = ceFindAt(ce.ta.value);
    var keep = ce.sel.value; ceFillSelect(keep); ceShow();
    ceSay("Код верный. Нажмите «Сохранить», чтобы увидели все.", "ok");
  }
  function ceCaret() {
    var line = ce.ta.value.slice(0, ce.ta.selectionStart).split("\n").length - 1, hit = null;
    Object.keys(ceAt).forEach(function (k) { if (ceAt[k] === line) hit = k; });
    if (hit && ceParam(hit) && ce.sel.value !== hit) { ce.sel.value = hit; ceShow(); }
    ceBand(line, false);
  }
  function ceSave() {
    var err = ceValidate(ceCur);
    if (err) { ceSay("Нельзя сохранить: " + err, "err"); return; }
    putNext(function () {
      if (state.updated !== ceBase) {
        toast("Доску изменили с другого устройства — закройте редактор и откройте заново");
        return null;
      }
      var n = JSON.parse(JSON.stringify(ceCur));
      n.updated = Date.now();
      if (!n.hidden || !n.hidden.length) delete n.hidden;
      if (!n.custom || !n.custom.length) delete n.custom;
      return n;
    }, "Правка кода: homework.json", "Сохранено", false, function (next) {
      ceCur = JSON.parse(JSON.stringify(next)); ceBase = next.updated;
      ceWrite(); ceFillSelect(ce.sel.value); ceShow();
      ceSay("Сохранено на GitHub. Страница обновится у всех примерно через минуту.", "ok");
    });
  }
  function ceReload() {
    ceCur = JSON.parse(JSON.stringify(state)); ceBase = state.updated;
    ceWrite(); ceFillSelect(ce.sel.value); ceShow();
    ceSay("Показан текущий файл с сайта.", "ok");
  }
  function ceCopy() {
    var done = function () { ceSay("Код скопирован.", "ok"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ce.ta.value).then(done, function () { ce.ta.select(); document.execCommand("copy"); done(); });
    else { ce.ta.select(); document.execCommand("copy"); done(); }
  }
  function ceClose() { if (ce) ce.root.hidden = true; document.body.classList.remove("editing"); }
  function ceBtn(text, fn, cls) {
    var b = document.createElement("button"); b.type = "button"; b.className = "btn" + (cls ? " " + cls : ""); b.textContent = text; b.onclick = fn; return b;
  }
  function ceMake() {
    var root = document.createElement("div"); root.id = "ce"; root.hidden = true;
    root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Правка кода доски");
    var inner = document.createElement("div"); inner.className = "ce-in";
    var hd = document.createElement("div"); hd.className = "ce-hd";
    var ttl = document.createElement("span"); ttl.className = "ce-ttl"; ttl.textContent = "Правка кода";
    hd.appendChild(ttl); hd.appendChild(ceBtn("Закрыть", ceClose));
    var l1 = document.createElement("label"); l1.htmlFor = "ceSel"; l1.textContent = "Что изменить";
    var sel = document.createElement("select"); sel.id = "ceSel";
    var lab = document.createElement("label"); lab.htmlFor = "ceVal";
    var txt = document.createElement("textarea"); txt.id = "ceVal"; txt.className = "ce-val"; txt.rows = 3;
    var inp = document.createElement("input"); inp.id = "ceVal2"; inp.className = "ce-val"; inp.hidden = true; inp.autocomplete = "off";
    var l3 = document.createElement("label"); l3.htmlFor = "ceCode"; l3.textContent = "Код (homework.json) — можно править прямо здесь";
    var cw = document.createElement("div"); cw.className = "ce-cw";
    var band = document.createElement("div"); band.className = "ce-band";
    var ta = document.createElement("textarea"); ta.id = "ceCode"; ta.className = "ce-code"; ta.spellcheck = false; ta.wrap = "off";
    ta.setAttribute("autocapitalize", "off"); ta.setAttribute("autocorrect", "off");
    cw.appendChild(band); cw.appendChild(ta);
    var msg = document.createElement("p"); msg.className = "ce-msg"; msg.setAttribute("aria-live", "polite");
    var row = document.createElement("div"); row.className = "edit-row"; row.style.marginTop = "12px";
    row.appendChild(ceBtn("Сохранить", ceSave, "primary")); row.appendChild(ceBtn("Скопировать код", ceCopy)); row.appendChild(ceBtn("Обновить из сайта", ceReload));
    [hd, l1, sel, lab, txt, inp, l3, cw, msg, row].forEach(function (e) { inner.appendChild(e); });
    root.appendChild(inner); document.body.appendChild(root);
    ce = { root: root, sel: sel, lab: lab, txt: txt, inp: inp, ta: ta, band: band, msg: msg };
    sel.addEventListener("change", ceShow);
    txt.addEventListener("input", ceOnParam);
    inp.addEventListener("input", ceOnParam);
    ta.addEventListener("input", ceOnCode);
    ta.addEventListener("scroll", function () {
      var p = ceParam(ce.sel.value);
      var line = document.activeElement === ta ? ta.value.slice(0, ta.selectionStart).split("\n").length - 1 : (p ? ceAt[p.id] : undefined);
      ceBand(line, false);
    });
    ["click", "keyup"].forEach(function (ev) { ta.addEventListener(ev, ceCaret); });
  }
  function openCodeEditor() {
    if (!token) return;
    toast("Загружаю свежий файл…");
    refreshFromApi(true).then(function () {
      if (!ce) ceMake();
      ceCur = JSON.parse(JSON.stringify(state)); ceBase = state.updated;
      if (!ceCur.subjects) ceCur.subjects = {};
      ceWrite(); ceFillSelect(ce.sel.value || ""); ceShow();
      ce.root.hidden = false; document.body.classList.add("editing");
      ceSay("Выберите параметр или правьте код. Строка в коде меняется сразу.");
    });
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

  // Файл отдаёт сам сайт — тот же домен, что и страница. У части пользователей
  // raw.githubusercontent заблокирован провайдером, и картинки не грузились.
  function fileUrl(path) {
    return path + "?t=" + Date.now();
  }
  // запасной адрес: свежезагруженный файл появляется на сайте через ~минуту
  function fileUrlFallback(path) {
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
    if (!t && typeof ceClose === "function") ceClose();
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

    var list = visibleSubjects();
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
              im.alt = f.name;
              im.loading = "lazy";
              im.onerror = function () {
                if (im.dataset.fallback) return;
                im.dataset.fallback = "1";
                im.src = fileUrlFallback(f.path);
              };
              im.src = fileUrl(f.path);
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
          var hideBtn = document.createElement("button");
          hideBtn.className = "btn danger";
          hideBtn.textContent = "Убрать предмет";
          hideBtn.title = "Скрыть предмет с доски; вернуть можно внизу страницы";
          hideBtn.onclick = function () {
            var msg = "Убрать предмет «" + s.name + "» с доски?" +
              (active ? "\nЗадание и файлы сохранятся — предмет можно вернуть." : "\nПредмет можно вернуть внизу страницы.");
            if (confirm(msg)) setHidden(s.id, true);
          };
          chips.appendChild(hideBtn);
        }
        if (chips.children.length) col.appendChild(chips);
      }

      row.appendChild(col);
      board.appendChild(row);
    });

    var restore = document.getElementById("restore");
    if (restore) {
      restore.textContent = "";
      restore.hidden = !token;
      if (token) {
        var addBtn = document.createElement("button");
        addBtn.className = "btn primary";
        addBtn.innerHTML = icon(PLUS) + "Добавить предмет";
        addBtn.onclick = addSubject;
        restore.appendChild(addBtn);
        var codeBtn = document.createElement("button");
        codeBtn.className = "btn";
        codeBtn.innerHTML = icon('<path d="m16 18 6-6-6-6"></path><path d="m8 6-6 6 6 6"></path>') + "Править код";
        codeBtn.onclick = openCodeEditor;
        restore.appendChild(codeBtn);
        var hs = hiddenList();
        if (hs.length) {
          var lab = document.createElement("span");
          lab.className = "chip plain";
          lab.textContent = "Убраны:";
          restore.appendChild(lab);
          hs.forEach(function (id) {
            var b = document.createElement("button");
            b.className = "btn";
            b.innerHTML = icon(PLUS) + subjectById(id).name;
            b.title = "Вернуть предмет на доску";
            b.onclick = function () { setHidden(id, false); };
            restore.appendChild(b);
          });
        }
      }
    }

    var soon = null;
    visibleSubjects().forEach(function (s) {
      var rec = state.subjects[s.id];
      if (!has(rec) || !rec.due) return;
      var d = daysLeft(rec.due);
      if (d === null || d < 0) return;
      if (!soon || d < soon.d) soon = { d: d, s: s, rec: rec };
    });
    var count = visibleSubjects().filter(function (s) { return has(state.subjects[s.id]); }).length;
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
  // сначала кеш (мгновенно и без лимитов), следом сверка с актуальным
  load().then(function () { return refreshFromApi(); });

  // вернулись на вкладку — проверяем, не появилось ли новое
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refreshFromApi();
  });
})();
