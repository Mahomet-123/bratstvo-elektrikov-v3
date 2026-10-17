// util.js — общие помощники интерфейса (DOM, форматирование, тосты, модалки).
window.U = {
  $: function (sel, root) { return (root || document).querySelector(sel); },
  $$: function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); },

  // Создать DOM-элемент декларативно.
  el: function (tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') { Object.assign(node.style, v); }
      else if (k === 'dataset' && typeof v === 'object') { Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; }); }
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') { node.addEventListener(k.slice(2).toLowerCase(), v); }
      else node.setAttribute(k, v);
    });
    if (children !== undefined && children !== null) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c === null || c === undefined) return;
        node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      });
    }
    return node;
  },

  clear: function (node) { while (node && node.firstChild) node.removeChild(node.firstChild); },

  // Деньги: 12 345 ₽ (рус. формат, без копеек).
  money: function (n) {
    var v = Math.round(Number(n) || 0);
    return v.toLocaleString('ru-RU') + ' ₽';
  },
  moneySigned: function (n) {
    var v = Math.round(Number(n) || 0);
    return (v >= 0 ? '+' : '−') + Math.abs(v).toLocaleString('ru-RU') + ' ₽';
  },

  date: function (s) {
    if (!s) return '';
    var d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    return d.toLocaleDateString('ru-RU');
  },
  datetime: function (s) {
    if (!s) return '';
    var d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    return d.toLocaleString('ru-RU');
  },
  todayISO: function () { return new Date().toISOString().slice(0, 10); },

  escape: function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  },

  copy: function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    return Promise.resolve();
  },

  // Тост-уведомление.
  toast: function (msg, type) {
    var c = U.$('#toast'); if (!c) return;
    var t = U.el('div', { class: 'toast toast--' + (type || 'info'), text: msg });
    c.appendChild(t);
    setTimeout(function () {
      t.classList.add('toast--out');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, 3200);
  },

  // Модальное окно. Возвращает { close, box }.
  modal: function (contentNode, opts) {
    opts = opts || {};
    var root = U.$('#modalRoot');
    var overlay = U.el('div', { class: 'modal-overlay' });
    var box = U.el('div', { class: 'modal' });
    if (!opts.noClose) {
      box.appendChild(U.el('button', { class: 'modal__close', text: '×', 'aria-label': 'Закрыть', onclick: function () { close(); } }));
    }
    box.appendChild(contentNode);
    overlay.appendChild(box);
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    overlay.addEventListener('click', function (e) { if (e.target === overlay && !opts.noClose) close(); });
    root.appendChild(overlay);
    return { close: close, box: box };
  },

  // Подтверждение (промис: true/false).
  confirm: function (message, okLabel) {
    return new Promise(function (resolve) {
      var body = U.el('div', { class: 'modal__body' }, [
        U.el('p', { class: 'modal__text', text: message }),
        U.el('div', { class: 'row row--end' }, [
          U.el('button', { class: 'btn btn--ghost', text: 'Отмена', onclick: function () { m.close(); resolve(false); } }),
          U.el('button', { class: 'btn btn--danger', text: okLabel || 'Да', onclick: function () { m.close(); resolve(true); } })
        ])
      ]);
      var m = U.modal(body);
    });
  },

  // Спиннер-индикатор загрузки в контейнере.
  loading: function (node, text) {
    U.clear(node);
    node.appendChild(U.el('div', { class: 'loading' }, [
      U.el('div', { class: 'spinner' }),
      U.el('div', { class: 'loading__text', text: text || 'Загрузка…' })
    ]));
  },

  // Простая карточка-сообщение (пусто / ошибка).
  emptyState: function (node, text, sub) {
    U.clear(node);
    node.appendChild(U.el('div', { class: 'empty' }, [
      U.el('div', { class: 'empty__icon', text: '📭' }),
      U.el('div', { class: 'empty__text', text: text || 'Нет данных' }),
      sub ? U.el('div', { class: 'empty__sub', text: sub }) : null
    ]));
  },

  // Лайтбокс просмотра фото: открывает фото в полноэкранной модалке,
  // поддерживает листание (кнопки + свайп + клавиатура) при нескольких фото.
  lightbox: function (urls, index) {
    if (!urls || !urls.length) return null;
    index = index || 0;
    var root = U.$('#modalRoot') || document.body;
    var img = U.el('img', { class: 'lightbox__img', src: urls[index], alt: '' });
    var counter = U.el('div', { class: 'lightbox__counter' });
    var prev = U.el('button', { class: 'lightbox__nav lightbox__nav--prev', 'aria-label': 'Предыдущее', text: '‹' });
    var next = U.el('button', { class: 'lightbox__nav lightbox__nav--next', 'aria-label': 'Следующее', text: '›' });
    var closeB = U.el('button', { class: 'lightbox__close', 'aria-label': 'Закрыть', text: '✕' });
    function render(i) {
      index = (i + urls.length) % urls.length;
      img.src = urls[index];
      counter.textContent = (index + 1) + ' / ' + urls.length;
      var multi = urls.length > 1;
      prev.style.display = multi ? '' : 'none';
      next.style.display = multi ? '' : 'none';
    }
    prev.addEventListener('click', function (e) { e.stopPropagation(); render(index - 1); });
    next.addEventListener('click', function (e) { e.stopPropagation(); render(index + 1); });
    closeB.addEventListener('click', function (e) { e.stopPropagation(); close(); });
    var overlay = U.el('div', { class: 'lightbox-overlay' }, [closeB, prev, img, next, counter]);
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); document.removeEventListener('keydown', onKey); }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    var startX = null;
    overlay.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
    overlay.addEventListener('touchend', function (e) {
      if (startX == null) return;
      var dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) render(index + (dx < 0 ? 1 : -1));
      startX = null;
    });
    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') render(index - 1);
      else if (e.key === 'ArrowRight') render(index + 1);
    }
    document.addEventListener('keydown', onKey);
    root.appendChild(overlay);
    render(index);
    return { close: close };
  }
};
