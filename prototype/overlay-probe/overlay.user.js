/* PROTOTYPE · C5 视觉覆层（一次性探针脚本）
 * 问题：在官方 Lexical 输入区上叠「metrics-neutral Markdown 渲染层」，
 *       打字/光标/IME 手感是否成立？
 * 注入方式：在官方 Web UI（无插件 profile）的控制台执行本文件。
 * 降级契约：找不到 data-composer-input 就 no-op。刷新页面即完全还原。
 */
(() => {
  if (window.__C5_OVERLAY__) { window.__C5_OVERLAY__.stop(); }
  const input = document.querySelector('[data-composer-input]');
  if (!input) { console.info('[c5-probe] no composer, no-op'); return; }
  const card = input.closest('[data-composer-card]') || input.parentElement;
  const scroller = input.closest('[data-input-scroll]') || input.parentElement;

  /* 呈现层规则：官方文字透明、光标保色、关拼写红线 */
  input.style.color = 'transparent';
  input.style.caretColor = '#93c5fd';
  input.spellcheck = false;

  /* 覆层本体 */
  const ov = document.createElement('div');
  ov.id = 'c5-overlay';
  ov.style.cssText = [
    'position:absolute', 'pointer-events:none', 'z-index:5',
    'white-space:pre-wrap', 'word-break:' + getComputedStyle(input).wordBreak,
    'font:' + getComputedStyle(input).font,
    'line-height:' + getComputedStyle(input).lineHeight,
    'padding:' + getComputedStyle(input).padding,
    'letter-spacing:' + getComputedStyle(input).letterSpacing,
    'color:#94a3b8', 'margin:0', 'border:0',
    'width:' + input.getBoundingClientRect().width + 'px',
  ].join(';');
  /* 覆层挂进 scroller：随内容滚动、被 max-height 裁剪 */
  scroller.style.position = 'relative';
  scroller.appendChild(ov);

  /* 状态徽章（原型规则：表面化状态） */
  const badge = document.createElement('div');
  badge.id = 'c5-badge';
  badge.style.cssText = 'position:fixed;top:8px;right:12px;z-index:99999;background:#dc2626;color:#fff;font:700 11px/1.6 system-ui;padding:2px 8px;border-radius:4px;';
  document.body.appendChild(badge);
  const say = (s) => { badge.textContent = 'C5 OVERLAY PROTOTYPE · ' + s; };

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  /* 标记保留原则：样式 span 必须包含原标记字符（字符网格 = 真实文本网格） */
  const INLINE = [
    [/~([^~\n]+)~/g, '<span style="text-decoration:line-through">$&</span>'],
    [/\*\*([^*\n]+)\*\*/g, '<span style="-webkit-text-stroke:0.5px currentColor;color:#e2e8f0">$&</span>'],
    [/`([^`\n]+)`/g, '<span style="background:rgba(148,163,184,.28);color:#dbeafe">$&</span>'],
    [/\[([^\]\n]*)\]\(([^)\n]*)\)/g, '<span style="color:#93c5fd">$&</span>'],
  ];
  function renderLine(line) {
    let h = esc(line);
    const fence = /^(```|~~~)/.test(line);
    const heading = /^#{1,6} /.test(line);
    const quote = /^> /.test(line);
    const task = /^[-*] \[( |x)\] /i.test(line);
    for (const [re, sub] of INLINE) h = h.replace(re, sub);
    let style = '';
    if (fence) style = 'background:rgba(148,163,184,.22);color:#cbd5e1;';
    else if (heading) style = '-webkit-text-stroke:0.5px currentColor;color:#f8fafc;';
    else if (quote) style = 'border-left:2px solid #64748b;padding-left:6px;margin-left:-8px;color:#a5b4cf;';
    else if (task) style = 'color:#bae6fd;';
    return '<div style="' + style + '">' + h + '</div>';
  }
  function render() {
    if (!scroller.contains(ov)) scroller.appendChild(ov); /* React 重排后自愈 */
    const text = input.textContent.replace(/\u00a0/g, ' ');
    ov.style.visibility = 'hidden';
    if (!text.trim()) { say('待输入'); return; }
    ov.innerHTML = text.split('\n').map(renderLine).join('');
    /* 锚定编辑器在 scroller 内容流中的原点（offset 即内容坐标，随滚动自然裁剪） */
    ov.style.top = input.offsetTop + 'px';
    ov.style.left = input.offsetLeft + 'px';
    ov.style.width = input.getBoundingClientRect().width + 'px';
    ov.style.visibility = 'visible';
    say('活跃 · ' + text.split('\n').length + ' 行');
  }

  /* 同步：文本变化 + 滚动 + IME 暂停 */
  let composition = false;
  const mo = new MutationObserver(() => { if (!composition) render(); });
  mo.observe(input, { characterData: true, childList: true, subtree: true });
  scroller.addEventListener('scroll', render, { passive: true });
  input.addEventListener('compositionstart', () => { composition = true; ov.style.visibility = 'hidden'; say('IME 组合中（显示原生文字）'); });
  input.addEventListener('compositionend', () => { composition = false; render(); });
  window.addEventListener('resize', render);

  window.__C5_OVERLAY__ = {
    stop() { mo.disconnect(); ov.remove(); badge.remove();
      input.style.color = ''; input.style.caretColor = ''; input.spellcheck = true;
      delete window.__C5_OVERLAY__; },
    render,
  };
  render();
  console.info('[c5-probe] overlay live — 在输入框打字试试；__C5_OVERLAY__.stop() 还原');
})();
