// A small, safe markdown renderer for the World Constitution: builds DOM nodes, never HTML strings.
// Supports headings, paragraphs, ordered and bullet lists, fenced code, rules, **bold** and `code`.
import { h } from './dom.js';

function inline(text) {
  const out = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1] != null ? h('strong', {}, m[1]) : h('code', {}, m[2]));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function renderMarkdown(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) blocks.push(h('p', {}, inline(para.join(' '))));
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(h(list.tag, { start: list.start > 1 ? list.start : null }, list.items.map((it) => h('li', {}, inline(it.join(' '))))));
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      flushPara();
      flushList();
      const code = [];
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]);
      blocks.push(h('pre', {}, h('code', {}, code.join('\n'))));
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      blocks.push(h(`h${level + 1}`, { id: `c-${slug(heading[2])}` }, inline(heading[2])));
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      flushPara();
      flushList();
      blocks.push(h('hr', {}));
      continue;
    }
    const item = /^\s*(\d+\.|[-*])\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      const tag = item[1].endsWith('.') ? 'ol' : 'ul';
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [], start: parseInt(item[1], 10) || 1 };
      }
      list.items.push([item[2]]);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    // Indented continuation of a list item.
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1].push(line.trim());
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return h('div', { class: 'md' }, blocks);
}
