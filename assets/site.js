/* Signals: shared behaviour. Pages call Signals.renderHome() or Signals.renderDay(). */
(function () {
  'use strict';
  var S = (window.Signals = {});
  var WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MO = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return { y: +m[1], m: +m[2] - 1, d: +m[3], wd: d.getUTCDay() };
  }
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : null; }
  function splitFront(t) {
    var fm = {};
    var m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(t);
    if (m) {
      m[1].split(/\r?\n/).forEach(function (l) {
        var i = l.indexOf(':');
        if (i > 0) fm[l.slice(0, i).trim()] = l.slice(i + 1).trim();
      });
      t = t.slice(m[0].length);
    }
    return { fm: fm, body: t };
  }
  function svgIcon(path, cls) {
    var ns = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2.2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    if (cls) s.setAttribute('class', cls);
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('d', path);
    s.appendChild(p);
    return s;
  }
  var ICON_EXT = 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5';
  var ICON_DOWN = 'M6 9l6 6 6-6';

  function markdownToHtml(text) {
    if (!window.marked || !window.DOMPurify) return null; // fail closed: never inject unsanitized HTML
    var raw = window.marked.parse(text);
    return window.DOMPurify.sanitize(raw, { USE_PROFILES: { html: true, svg: true, svgFilters: true } });
  }
  function meter(level) {
    var m = el('span', 'meter m' + level);
    m.setAttribute('aria-hidden', 'true');
    m.appendChild(el('i')); m.appendChild(el('i')); m.appendChild(el('i'));
    return m;
  }

  /* ---------- theme + progress ---------- */
  S.initChrome = function () {
    var b = $('#theme-toggle');
    if (b) {
      b.addEventListener('click', function () {
        var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('signals-theme', next); } catch (e) {}
        b.setAttribute('aria-label', 'Switch to ' + (next === 'dark' ? 'light' : 'dark') + ' theme');
      });
    }
    var bar = $('#progress');
    if (bar) {
      var tick = function () {
        var h = document.documentElement;
        var max = h.scrollHeight - h.clientHeight;
        bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, h.scrollTop / max) : 0) + ')';
      };
      window.addEventListener('scroll', tick, { passive: true });
      tick();
    }
  };

  /* ---------- day page ---------- */
  function parseMeta(txt) {
    var parts = txt.split(/\s*[·•|]\s*/).filter(Boolean);
    var meta = { source: '', time: '', tag: '' };
    parts.forEach(function (p, i) {
      if (/\bmin\b/i.test(p)) meta.time = p;
      else if (/^(lead|core|need to know|discovery)$/i.test(p)) meta.tag = p.toLowerCase();
      else if (i === 0) meta.source = p;
    });
    return meta;
  }
  function verdictLevel(txt) {
    var head = txt.slice(0, 40);
    if (/skip/i.test(head)) return 1;
    if (/skim/i.test(head)) return 2;
    return 3;
  }
  function pullOriginalLink(root) {
    var found = null;
    $$('a', root).forEach(function (a) {
      if (/read the original/i.test(a.textContent)) {
        if (!found) found = safeUrl(a.getAttribute('href'));
        var p = a.parentNode;
        p.removeChild(a);
        if (p.tagName === 'P' && !p.textContent.replace(/[\s.\[\]()]/g, '')) p.parentNode && p.parentNode.removeChild(p);
      }
    });
    return found;
  }
  function classify(g) {
    if (!g.head) return 'prose';
    var t = g.head.textContent.trim();
    if (/^\d+\s*[.)]\s+/.test(t)) return 'story';
    if (/^quick hits?/i.test(t)) return 'quick';
    if (/^long read/i.test(t)) return 'long';
    if (/^also today/i.test(t)) return 'label';
    return 'block';
  }
  function hasTextBefore(node) {
    var n = node.previousSibling;
    while (n) { if ((n.textContent || '').trim()) return true; n = n.previousSibling; }
    return false;
  }
  // The agent sometimes forgets blank lines, gluing the meta line or the verdict into a body paragraph. Split them apart.
  function normalizeParagraphs(holder) {
    Array.prototype.slice.call(holder.children).forEach(function (p) {
      if (p.tagName !== 'P') return;
      var strongs = $$('strong', p);
      for (var i = 0; i < strongs.length; i++) {
        var st = strongs[i];
        if (st.parentNode === p && /^verdict\s*:?$/i.test(st.textContent.trim())) {
          if (hasTextBefore(st)) {
            var np = el('p'), moved = [], node = st;
            while (node) { moved.push(node); node = node.nextSibling; }
            moved.forEach(function (x) { np.appendChild(x); });
            p.parentNode.insertBefore(np, p.nextSibling);
          }
          break;
        }
      }
      var first = p.firstElementChild;
      if (first && first.tagName === 'EM' && p.firstChild === first && p.childNodes.length > 1 &&
          /[\u00B7\u2022|]/.test(first.textContent) && /\bmin\b/i.test(first.textContent)) {
        var mp = el('p');
        mp.appendChild(first);
        p.parentNode.insertBefore(mp, p);
        while (p.firstChild && ((p.firstChild.nodeType === 3 && !p.firstChild.nodeValue.trim()) || p.firstChild.tagName === 'BR')) p.removeChild(p.firstChild);
        if (p.firstChild && p.firstChild.nodeType === 3) p.firstChild.nodeValue = p.firstChild.nodeValue.replace(/^\s+/, '');
        if (!p.childNodes.length) p.parentNode.removeChild(p);
      }
    });
  }
  function buildStory(g, isLead) {
    var m = /^(\d+)\s*[.)]\s+([\s\S]*)$/.exec(g.head.textContent.trim());
    var num = m[1], title = m[2];
    var holder = el('div');
    g.nodes.forEach(function (n) { holder.appendChild(n); });
    normalizeParagraphs(holder);
    var link = pullOriginalLink(holder);

    var meta = { source: '', time: '', tag: '' }, verdictTxt = '', body = [];
    Array.prototype.slice.call(holder.children).forEach(function (n) {
      var txt = n.textContent.trim();
      if (n.tagName === 'P') {
        if (!meta.source && !meta.time && n.children.length === 1 && n.firstElementChild.tagName === 'EM' &&
            txt === n.firstElementChild.textContent.trim() && /[·•|]/.test(txt)) { meta = parseMeta(txt); return; }
        if (/^verdict\s*:/i.test(txt) && !verdictTxt) { verdictTxt = txt.replace(/^verdict\s*:\s*/i, '').trim(); return; }
      }
      body.push(n);
    });

    var tagCls = /need/.test(meta.tag) ? 'tag-need' : /discover/.test(meta.tag) ? 'tag-disc' : '';
    var sec = el('section', 'story' + (isLead ? ' lead' : '') + (tagCls ? ' ' + tagCls : ''));
    sec.id = 's' + num;
    sec.appendChild(el('div', 'story-num', num));
    var main = el('div', 'story-main');
    sec.appendChild(main);

    var tags = el('div', 'story-tags');
    if (meta.source) tags.appendChild(el('span', 'pill', meta.source));
    if (meta.time) tags.appendChild(el('span', 'pill', meta.time));
    if (/need/.test(meta.tag)) tags.appendChild(el('span', 'pill need', 'Need to know'));
    if (/discover/.test(meta.tag)) tags.appendChild(el('span', 'pill disc', 'Discovery'));
    if (tags.children.length) main.appendChild(tags);

    main.appendChild(el('h2', 'story-title', title));

    var bodyEl = el('div', 'story-body prose');
    var moreEl = el('div', 'story-more prose');
    body.forEach(function (n, i) { (isLead || i === 0 ? bodyEl : moreEl).appendChild(n); });
    main.appendChild(bodyEl);
    if (moreEl.children.length) {
      moreEl.hidden = true;
      moreEl.id = 'more-' + num;
      var btn = el('button', 'more-btn');
      btn.type = 'button';
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-controls', moreEl.id);
      var label = el('span', null, 'Read more');
      btn.appendChild(label);
      btn.appendChild(svgIcon(ICON_DOWN));
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!open));
        moreEl.hidden = open;
        label.textContent = open ? 'Read more' : 'Show less';
      });
      main.appendChild(moreEl);
      main.appendChild(btn);
    }

    var foot = el('div', 'story-foot');
    var level = verdictTxt ? verdictLevel(verdictTxt) : 0;
    if (verdictTxt) {
      var vm = /^(read in full|skim|skip unless curious|skip)\b/i.exec(verdictTxt);
      var word = vm ? vm[0] : verdictTxt.split(/\s+/).slice(0, 3).join(' ');
      var why = verdictTxt.slice(word.length).replace(/^[\s\u2014\u2013\-:.,;]+/, '');
      var v = el('span', 'verdict v-' + ['', 'skip', 'skim', 'read'][level]);
      v.appendChild(meter(level));
      var vt = el('span');
      vt.appendChild(el('span', 'vword', word));
      if (why) vt.appendChild(document.createTextNode(' \u2014 ' + why));
      v.appendChild(vt);
      foot.appendChild(v);
    }
    if (link) {
      var a = el('a', 'btn');
      a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.appendChild(document.createTextNode('Read original'));
      a.appendChild(svgIcon(ICON_EXT));
      foot.appendChild(a);
    }
    if (foot.children.length) main.appendChild(foot);

    return { node: sec, num: num, title: title, source: meta.source, level: level, tag: tagCls };
  }
  function buildQuick(g) {
    var sec = el('section', 'block');
    sec.appendChild(el('h2', 'block-title', g.head.textContent.trim()));
    var ul = null;
    g.nodes.forEach(function (n) { if (!ul && n.tagName === 'UL') ul = n; });
    if (ul) {
      ul.className = 'quick-list';
      $$('li', ul).forEach(function (li, i) {
        var letter = String.fromCharCode(65 + i);
        var w = document.createTreeWalker(li, NodeFilter.SHOW_TEXT, null);
        var t = w.nextNode();
        if (t) {
          var m = /^\s*([A-Za-z])[.)]\s*/.exec(t.nodeValue);
          if (m) { letter = m[1].toUpperCase(); t.nodeValue = t.nodeValue.slice(m[0].length); }
        }
        li.setAttribute('data-letter', letter);
        $$('a', li).forEach(function (a) { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
      });
      sec.appendChild(ul);
    }
    return sec;
  }
  function buildBlock(g, cls) {
    var sec = el('section', cls);
    var title = el('h2', 'block-title', g.head.textContent.trim());
    sec.appendChild(title);
    var p = el('div', 'prose');
    g.nodes.forEach(function (n) { p.appendChild(n); });
    $$('a', p).forEach(function (a) { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    sec.appendChild(p);
    return sec;
  }

  S.renderDay = function (mdPath) {
    S.initChrome();
    var root = $('#issue');
    fetch(mdPath || 'digest.md', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (text) {
      var parts = splitFront(text), fm = parts.fm;
      var html = markdownToHtml(parts.body);
      if (html == null) throw new Error('renderer unavailable');
      var tmp = el('div');
      tmp.innerHTML = html;

      var h1 = null, summary = null, groups = [], cur = null;
      Array.prototype.slice.call(tmp.children).forEach(function (n) {
        var tag = n.tagName;
        if (tag === 'H1' && !h1) { h1 = n; return; }
        if (tag === 'BLOCKQUOTE' && !summary && !groups.length) { summary = n; return; }
        if (tag === 'H2' || tag === 'H3') { cur = { head: n, nodes: [] }; groups.push(cur); return; }
        if (!cur) { cur = { head: null, nodes: [] }; groups.push(cur); }
        cur.nodes.push(n);
      });

      var pd = parseDate(fm.date);
      root.textContent = '';

      var head = el('header', 'issue-head');
      if (pd) {
        var mast = el('div', 'date-mast');
        mast.appendChild(el('span', 'date-day', String(pd.d)));
        var rest = el('span', 'date-rest');
        rest.appendChild(el('b', null, WD[pd.wd]));
        rest.appendChild(document.createTextNode(MO[pd.m] + ' ' + pd.y));
        mast.appendChild(rest);
        head.appendChild(mast);
        document.title = 'Signals \u2013 ' + pd.d + ' ' + MO[pd.m].slice(0, 3) + ' ' + pd.y;
        var crumb = $('#crumb');
        if (crumb) crumb.textContent = pd.d + ' ' + MO[pd.m].slice(0, 3);
      } else if (h1) {
        head.appendChild(el('h1', 'story-title', h1.textContent.trim()));
      }
      if (summary) head.appendChild(el('p', 'issue-summary', summary.textContent.trim()));

      var stories = [], body = el('div');
      groups.forEach(function (g) {
        var kind = classify(g);
        if (kind === 'story') {
          var s = buildStory(g, stories.length === 0);
          stories.push(s);
          body.appendChild(s.node);
        } else if (kind === 'quick') body.appendChild(buildQuick(g));
        else if (kind === 'long') body.appendChild(buildBlock(g, 'longread'));
        else if (kind === 'label') body.appendChild(el('h2', 'section-label', g.head.textContent.trim()));
        else if (kind === 'block') body.appendChild(buildBlock(g, 'block'));
        else {
          var p = el('div', 'prose');
          g.nodes.forEach(function (n) { p.appendChild(n); });
          body.appendChild(p);
        }
      });

      var words = (body.textContent || '').split(/\s+/).length;
      var pills = el('div', 'pills');
      pills.appendChild(el('span', 'pill', stories.length + (stories.length === 1 ? ' story' : ' stories')));
      pills.appendChild(el('span', 'pill', Math.max(1, Math.round(words / 220)) + ' min read'));
      if (/^(24|48)h?$/i.test(fm.window || '')) pills.appendChild(el('span', 'pill', 'Last ' + parseInt(fm.window, 10) + ' hours'));
      head.appendChild(pills);

      if (stories.length) {
        var toc = el('nav', 'toc');
        toc.setAttribute('aria-label', 'In this issue');
        toc.appendChild(el('div', 'toc-title', 'In this issue'));
        var ol = el('ol');
        stories.forEach(function (s) {
          var li = el('li');
          var a = el('a'); a.href = '#s' + s.num;
          a.appendChild(el('span', 'toc-n', s.num));
          var t = el('span');
          t.appendChild(el('span', 'toc-t', s.title));
          var sub = [s.source, /need/.test(s.tag) ? 'Need to know' : /disc/.test(s.tag) ? 'Discovery' : ''].filter(Boolean).join(', ');
          if (sub) t.appendChild(el('span', 'toc-s', sub));
          a.appendChild(t);
          if (s.level) a.appendChild(meter(s.level));
          li.appendChild(a); ol.appendChild(li);
        });
        toc.appendChild(ol);
        head.appendChild(toc);
      }
      root.appendChild(head);
      root.appendChild(body);

      var pager = el('div', 'pager');
      root.appendChild(pager);
      fetch('../manifest.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (list) {
        list = list.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
        var i = -1;
        list.forEach(function (x, idx) { if (x.date === fm.date) i = idx; });
        function link(entry, cls, label) {
          var a = el('a', cls); a.href = '../' + entry.date + '/';
          a.appendChild(el('small', null, label));
          a.appendChild(el('b', null, entry.lead || entry.date));
          pager.appendChild(a);
        }
        if (i >= 0 && list[i + 1]) link(list[i + 1], 'prev', 'Previous issue');
        if (i > 0) link(list[i - 1], 'next', 'Next issue');
        if (!pager.children.length) pager.remove();
      }).catch(function () { pager.remove(); });
    }).catch(function () {
      root.textContent = '';
      root.appendChild(el('div', 'state', 'This issue could not be loaded. Check your connection and refresh. If it keeps failing, the digest file may not be published yet.'));
    });
  };

  /* ---------- home ---------- */
  var DEFAULT_SITE = { name: 'Signals', sections: [{ id: 'daily', title: 'Daily digest', manifest: 'manifest.json', base: '' }] };
  function fetchJson(u) {
    return fetch(u, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  S.renderHome = function () {
    S.initChrome();
    var list = $('#list'), tabs = $('#tabs'), search = $('#search');
    var site = DEFAULT_SITE, section = null, entries = [];

    function entryUrl(e) { return e.url || (section.base || '') + e.date + '/'; }
    function dateBlock(pd) {
      var f = el('div', 'date-mast');
      f.appendChild(el('span', 'date-day', String(pd.d)));
      var r = el('span', 'date-rest');
      r.appendChild(el('b', null, WD[pd.wd]));
      r.appendChild(document.createTextNode(MO[pd.m] + ' ' + pd.y));
      f.appendChild(r);
      return f;
    }
    function draw() {
      var q = (search.value || '').trim().toLowerCase();
      var shown = entries.filter(function (e) {
        if (!q) return true;
        return ((e.lead || e.title || '') + ' ' + (e.one_liners || []).join(' ')).toLowerCase().indexOf(q) !== -1;
      });
      list.textContent = '';
      if (!entries.length) { list.appendChild(el('div', 'state', 'No issues yet. The first one appears after the next scheduled run.')); return; }
      if (!shown.length) { list.appendChild(el('div', 'state', 'Nothing matches \u201C' + search.value.trim() + '\u201D. Try a company, a topic or a date.')); return; }

      var rest = shown, first = shown[0], fpd = parseDate(first.date);
      if (!q && fpd) {
        var f = el('a', 'feature'); f.href = entryUrl(first);
        var top = el('div', 'feature-top');
        top.appendChild(dateBlock(fpd));
        top.appendChild(el('span', 'feature-badge', 'Latest issue'));
        f.appendChild(top);
        f.appendChild(el('h2', 'feature-lead', first.lead || first.title || first.date));
        if ((first.one_liners || []).length) {
          var ul = el('ul');
          first.one_liners.slice(0, 5).forEach(function (x) { ul.appendChild(el('li', null, x)); });
          f.appendChild(ul);
        }
        list.appendChild(f);
        rest = shown.slice(1);
      }
      var lastMonth = '';
      rest.forEach(function (e) {
        var pd = parseDate(e.date);
        if (pd) {
          var key = MO[pd.m] + ' ' + pd.y;
          if (key !== lastMonth) { list.appendChild(el('h2', 'month', key)); lastMonth = key; }
        }
        var a = el('a', 'row'); a.href = entryUrl(e);
        var d = el('span', 'row-date');
        d.appendChild(el('b', null, pd ? String(pd.d) : '\u2013'));
        d.appendChild(document.createTextNode(pd ? WD[pd.wd].slice(0, 3) : ''));
        a.appendChild(d);
        var m = el('span', 'row-main');
        m.appendChild(el('span', 'row-lead', e.lead || e.title || e.date));
        if ((e.one_liners || []).length) m.appendChild(el('span', 'row-lines', e.one_liners.join('  \u00B7  ')));
        if (e.stories) m.appendChild(el('span', 'pill row-n', e.stories + ' stories'));
        a.appendChild(m);
        list.appendChild(a);
      });
    }
    function load(sec) {
      section = sec;
      list.textContent = '';
      list.appendChild(el('div', 'state', 'Loading\u2026'));
      fetchJson(sec.manifest).then(function (data) {
        entries = (Array.isArray(data) ? data : []).slice().sort(function (a, b) {
          return (a.date || '') < (b.date || '') ? 1 : -1;
        });
        draw();
      }).catch(function () {
        entries = [];
        list.textContent = '';
        list.appendChild(el('div', 'state', 'The archive could not be loaded. Check your connection and refresh.'));
      });
    }
    function drawTabs() {
      tabs.textContent = '';
      if (site.sections.length < 2) { tabs.hidden = true; return; }
      tabs.hidden = false;
      site.sections.forEach(function (sec) {
        var b = el('button', 'tab', sec.title);
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(sec === section));
        b.addEventListener('click', function () { search.value = ''; load(sec); drawTabs(); });
        tabs.appendChild(b);
      });
    }
    search.addEventListener('input', draw);
    fetchJson('site.json').then(function (s) {
      if (s && Array.isArray(s.sections) && s.sections.length) site = s;
    }).catch(function () {}).then(function () {
      var h = $('#site-name'); if (h && site.name) h.textContent = site.name;
      var t = $('#site-tagline'); if (t && site.tagline) t.textContent = site.tagline;
      section = site.sections[0];
      drawTabs();
      load(section);
    });
  };
})();
