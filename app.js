/*
 * 1bit Calendar
 * 写真を2色のドット(ディザ)に変換し、カレンダーを重ねたスマホ壁紙を作る。
 * すべてブラウザ内(Canvas)で処理し、サーバーには何も送らない。
 *
 * 目次(上から順に並んでいる)
 *   状態 S とカラーテンプレート
 *   ベイヤー行列 / サンプル画像 / 2色の点線
 *   写真のディザ           renderPhoto()
 *   カレンダー             drawCal()
 *   描画                   render(), finalImage(), fit()
 *   UI の同期              syncUI()   … 状態 S を画面の入力欄に反映する
 *   入力の配線             各スライダー・ボタン → 状態 S
 *   ドラッグ・ピンチ・ホイール
 *   保存                   PNG の書き出し
 *   色の計算 / サイトの色  applyTheme()  … UI はドットの色と背景の色の2色だけ
 *   辺のスナップ           snapTo()
 *   トリミング
 *   全画面表示
 *   効果音                 sfx
 *   タブのドットアイコン   ICONS, drawIcon()
 *   言語                   EN 表, t(), applyLang()
 *   起動
 */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const cv = $('#cv'),
    ctx = cv.getContext('2d');
  const lo = document.createElement('canvas'),
    lctx = lo.getContext('2d', { willReadFrequently: true });
  const out = document.createElement('canvas'),
    octx = out.getContext('2d');
  const FONT = '"DotGothic16","Hiragino Sans","Yu Gothic",monospace';
  const now = new Date();

  const S = {
    W: 1179,
    H: 2556,
    src: null,
    photo: { x: 0.5, y: 0.36, scale: 1 },
    dither: { algo: 'b4', px: 4, bright: 0, contrast: 0, invert: false },
    cal: {
      show: true,
      x: 0.5,
      y: 0.74,
      size: 1,
      year: now.getFullYear(),
      month: now.getMonth(),
      style: 'grid',
      weekStart: 0,
      lang: 'en',
      font: 'DotGothic16',
      frame: true,
      bg: true
    },
    lang: 'en',
    color: { ink: '#000000', paper: '#ffffff' },
    hsl: { ink: [0, 0, 0], paper: [0, 0, 100] },
    guide: false,
    snap: true,
    sound: true,
    calBox: null
  };

  // カラーテンプレート(ドットの色, 背景の色)。参考画像から取った配色(モノクロ・漫画・紺・夜の街・月)と、同じ落ち着いた調子で足した配色(苔・錆・深い青緑)
  const PRESETS = [
    ['#000000', '#ffffff'], // モノクロ
    ['#494949', '#fdf8d8'], // 漫画のトーン
    ['#00314f', '#e2dac5'], // 紺と生成り
    ['#2e3a28', '#d9ddc8'], // 苔
    ['#8c3b2b', '#efe6d8'], // 錆
    ['#ededed', '#332d58'], // 夜の街
    ['#c6a370', '#171516'], // 月
    ['#cfe3de', '#1f3a3d'] // 深い青緑
  ];

  const hex = h => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  /* ---------- ベイヤー行列 ---------- */
  function bayerMatrix(n) {
    let m = [[0]];
    while (m.length < n) {
      const s = m.length,
        nm = [];
      for (let y = 0; y < 2 * s; y++) {
        nm[y] = [];
        for (let x = 0; x < 2 * s; x++) {
          const q = (y < s ? 0 : 2) + (x < s ? 0 : 1);
          nm[y][x] = 4 * m[y % s][x % s] + [0, 2, 3, 1][q];
        }
      }
      m = nm;
    }
    return m;
  }
  const MAT = { b2: bayerMatrix(2), b4: bayerMatrix(4), b8: bayerMatrix(8) };

  /* ---------- サンプル画像 ---------- */
  function makeSample() {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 1600;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 1600);
    sky.addColorStop(0, '#000');
    sky.addColorStop(0.6, '#d8d8d8');
    sky.addColorStop(1, '#fff');
    g.fillStyle = sky;
    g.fillRect(0, 0, 1200, 1600);
    const sun = g.createRadialGradient(600, 700, 0, 600, 700, 300);
    sun.addColorStop(0, 'rgba(255,255,255,1)');
    sun.addColorStop(0.7, 'rgba(255,255,255,1)');
    sun.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sun;
    g.beginPath();
    g.arc(600, 700, 300, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#4a4a4a';
    g.beginPath();
    g.moveTo(0, 1150);
    g.quadraticCurveTo(300, 980, 600, 1110);
    g.quadraticCurveTo(900, 1230, 1200, 1060);
    g.lineTo(1200, 1600);
    g.lineTo(0, 1600);
    g.closePath();
    g.fill();
    g.fillStyle = '#0c0c0c';
    g.beginPath();
    g.moveTo(0, 1350);
    g.quadraticCurveTo(400, 1210, 800, 1330);
    g.quadraticCurveTo(1000, 1380, 1200, 1300);
    g.lineTo(1200, 1600);
    g.lineTo(0, 1600);
    g.closePath();
    g.fill();
    return c;
  }

  /* ---------- 2色の点線(ドットの色と背景の色が交互) ---------- */
  function dashLine(g, lw, dash, path) {
    g.save();
    g.lineWidth = lw;
    g.setLineDash([]);
    g.strokeStyle = S.color.paper;
    path();
    g.stroke();
    g.setLineDash(dash);
    g.strokeStyle = S.color.ink;
    path();
    g.stroke();
    g.restore();
  }

  /* ---------- 写真のディザ ---------- */
  function renderPhoto() {
    const px = S.dither.px,
      lw = Math.ceil(S.W / px),
      lh = Math.ceil(S.H / px);
    if (lo.width !== lw || lo.height !== lh) {
      lo.width = lw;
      lo.height = lh;
      out.width = lw;
      out.height = lh;
    } else lctx.clearRect(0, 0, lw, lh);
    const src = S.src;
    const dw = (S.W * S.photo.scale) / px,
      dh = (dw * src.height) / src.width;
    lctx.imageSmoothingEnabled = true;
    lctx.imageSmoothingQuality = 'high';
    lctx.drawImage(src, S.photo.x * lw - dw / 2, S.photo.y * lh - dh / 2, dw, dh);
    const d = lctx.getImageData(0, 0, lw, lh).data,
      n = lw * lh,
      g = new Float32Array(n);
    const f = 1 + S.dither.contrast / 100,
      b = S.dither.bright * 2.55;
    for (let i = 0; i < n; i++) {
      const k = i * 4;
      if (d[k + 3] < 128) {
        g[i] = 255;
        continue;
      }
      let v = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2];
      v = (v - 128) * f + 128 + b;
      if (S.dither.invert) v = 255 - v;
      g[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    const bits = new Uint8Array(n); // 1 = 地, 0 = ドット
    const a = S.dither.algo;
    if (a[0] === 'b') {
      const m = MAT[a],
        s = m.length,
        s2 = s * s;
      for (let y = 0; y < lh; y++)
        for (let x = 0; x < lw; x++) {
          const i = y * lw + x;
          bits[i] = g[i] > ((m[y % s][x % s] + 0.5) / s2) * 255 ? 1 : 0;
        }
    } else if (a === 'th') {
      for (let i = 0; i < n; i++) bits[i] = g[i] >= 128 ? 1 : 0;
    } else {
      const spread =
        a === 'fs'
          ? [
              [1, 0, 7 / 16],
              [-1, 1, 3 / 16],
              [0, 1, 5 / 16],
              [1, 1, 1 / 16]
            ]
          : [
              [1, 0, 1 / 8],
              [2, 0, 1 / 8],
              [-1, 1, 1 / 8],
              [0, 1, 1 / 8],
              [1, 1, 1 / 8],
              [0, 2, 1 / 8]
            ];
      for (let y = 0; y < lh; y++)
        for (let x = 0; x < lw; x++) {
          const i = y * lw + x,
            old = g[i],
            nv = old < 128 ? 0 : 255,
            err = old - nv;
          bits[i] = nv ? 1 : 0;
          for (let j = 0; j < spread.length; j++) {
            const sx = x + spread[j][0],
              sy = y + spread[j][1];
            if (sx < 0 || sx >= lw || sy >= lh) continue;
            g[sy * lw + sx] += err * spread[j][2];
          }
        }
    }
    const oid = octx.createImageData(lw, lh),
      o = oid.data,
      c = hex(S.color.ink);
    for (let i = 0; i < n; i++)
      if (!bits[i]) {
        const k = i * 4;
        o[k] = c[0];
        o[k + 1] = c[1];
        o[k + 2] = c[2];
        o[k + 3] = 255;
      }
    octx.putImageData(oid, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(out, 0, 0, lw * px, lh * px);
  }

  /* ---------- カレンダー ---------- */
  const WJ = ['日', '月', '火', '水', '木', '金', '土'];
  const WE = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const WL = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const MONTHS = [
    'JANUARY',
    'FEBRUARY',
    'MARCH',
    'APRIL',
    'MAY',
    'JUNE',
    'JULY',
    'AUGUST',
    'SEPTEMBER',
    'OCTOBER',
    'NOVEMBER',
    'DECEMBER'
  ];

  // フォントごとの文字幅の補正
  const FK = {
    DotGothic16: 1,
    'Press Start 2P': 0.6,
    VT323: 1.2,
    'Space Mono': 0.9,
    'Shippori Mincho': 1,
    'Dela Gothic One': 0.8,
    'Yusei Magic': 1
  };
  // スタイルごとの基準文字サイズ(出力幅に対する比)
  const CAL_F = {
    grid: 0.034,
    list: 0.026,
    list2: 0.026,
    transpose: 0.03,
    bigmonth: 0.03,
    strip: 0.018,
    plain: 0.034
  };

  function drawCal(guides) {
    const c = S.cal,
      st = c.style,
      ja = c.lang === 'ja';
    const days = new Date(c.year, c.month + 1, 0).getDate();
    const first = new Date(c.year, c.month, 1).getDay();
    const off = (first - c.weekStart + 7) % 7;
    const f = S.W * (CAL_F[st] || 0.03) * c.size;
    const cf = s => `${s * (FK[c.font] || 1)}px "${c.font}", ${FONT}`;
    const wk = i => (ja ? WJ : WE)[(i + c.weekStart) % 7];
    const col = S.color.ink,
      paper = S.color.paper;
    const pad = c.frame || c.bg ? f * 0.9 : 0;
    const rule = Math.max(2, Math.round(f * 0.1)),
      thin = Math.max(1, Math.round(rule / 2));
    const dot = Math.max(2, Math.round(f * 0.1));

    // 大きさ
    let w,
      h,
      cw,
      ch,
      rows,
      titleH = f * 2.5;
    if (st === 'grid') {
      cw = f * 2.1;
      ch = f * 1.7;
      rows = Math.ceil((off + days) / 7);
      w = cw * 7;
      h = titleH + ch * (rows + 1);
    } else if (st === 'list') {
      ch = f * 1.35;
      w = f * 10.5;
      h = titleH + ch * days;
    } else if (st === 'list2') {
      rows = Math.ceil(days / 2);
      ch = f * 1.35;
      cw = f * 8.2;
      w = cw * 2 + f * 1.6;
      h = titleH + ch * rows;
    } else if (st === 'transpose') {
      rows = Math.ceil((off + days) / 7);
      cw = f * 2;
      ch = f * 1.7;
      w = Math.max(f * 11, f * 2.4 + cw * rows);
      h = titleH + ch * 7;
    } else if (st === 'bigmonth') {
      titleH = f * 6.4;
      cw = f * 2.1;
      ch = f * 1.7;
      rows = Math.ceil((off + days) / 7);
      w = cw * 7;
      h = titleH + ch * (rows + 1);
    } else if (st === 'strip') {
      titleH = f * 2.6;
      cw = f * 1.55;
      ch = f * 1.7;
      w = cw * days;
      h = titleH + ch * 2;
    } else {
      cw = f * 2.1;
      ch = f * 1.7;
      rows = Math.ceil((off + days) / 7);
      w = cw * 7;
      h = ch * rows;
    }

    // 位置・背景・枠
    const bw = w + 2 * pad,
      bh = h + 2 * pad,
      sh = Math.round(f * 0.3);
    clampCalPos(bw, bh, c.frame ? f * 0.3 : 0);
    const bx = c.x * S.W - bw / 2,
      by = c.y * S.H - bh / 2;
    S.calBox = { x: bx, y: by, w: bw + f * 0.3, h: bh + f * 0.3 };
    S.calRect = { x: bx, y: by, w: bw, h: bh };
    if (c.bg) {
      ctx.fillStyle = paper;
      ctx.fillRect(bx, by, bw, bh);
    }
    if (c.frame) {
      const lwf = Math.max(2, Math.round(f * 0.09));
      ctx.fillStyle = col;
      ctx.fillRect(bx + bw, by + sh, sh, bh);
      ctx.fillRect(bx + sh, by + bh, bw - sh, sh);
      ctx.strokeStyle = col;
      ctx.lineWidth = lwf;
      ctx.strokeRect(bx + lwf / 2, by + lwf / 2, bw - lwf, bh - lwf);
    }
    const ox = bx + pad,
      oy = by + pad;
    ctx.fillStyle = col;
    ctx.textBaseline = 'middle';

    // 部品
    const title = sz => {
      ctx.textAlign = 'left';
      ctx.font = cf(f * sz);
      ctx.fillText(ja ? c.month + 1 + '月' : MONTHS[c.month], ox, oy + titleH * 0.42);
      ctx.textAlign = 'right';
      ctx.font = cf(f);
      ctx.fillText(String(c.year), ox + w, oy + titleH * 0.5);
      ctx.fillRect(ox, oy + titleH * 0.84, w, rule);
    };
    const gridAt = (gy, head) => {
      let top = gy;
      if (head) {
        ctx.textAlign = 'center';
        ctx.font = cf(f * 0.95);
        for (let i = 0; i < 7; i++) ctx.fillText(wk(i), ox + cw * (i + 0.5), gy + ch * 0.5);
        ctx.fillRect(ox, gy + ch * 0.98, w, thin);
        top = gy + ch;
      }
      ctx.textAlign = 'center';
      ctx.font = cf(f * 1.15);
      for (let d = 1; d <= days; d++) {
        const idx = off + d - 1;
        ctx.fillText(String(d), ox + cw * ((idx % 7) + 0.5), top + ch * (Math.floor(idx / 7) + 0.5));
      }
    };
    // 日付・点線・曜日の1行(リスト系)。l/r は点線の左右の余白、inset は文字の余白
    const listRow = (d, x0, rw, cy, l, r, inset) => {
      const dow = (first + d - 1) % 7;
      for (let x = x0 + f * l; x < x0 + rw - f * r; x += f * 0.4)
        ctx.fillRect(Math.round(x), Math.round(cy + f * 0.15), dot, dot);
      ctx.textAlign = 'left';
      ctx.fillText(String(d).padStart(2, '0'), x0 + f * inset, cy);
      ctx.textAlign = 'right';
      ctx.fillText(ja ? WJ[dow] : WL[dow], x0 + rw - f * inset, cy);
    };

    if (st === 'grid') {
      title(1.7);
      gridAt(oy + titleH, true);
    } else if (st === 'list') {
      title(1.3);
      ctx.font = cf(f);
      for (let d = 1; d <= days; d++) listRow(d, ox, w, oy + titleH + ch * (d - 0.5), 2.6, 3.4, 0.4);
    } else if (st === 'list2') {
      title(1.5);
      ctx.font = cf(f);
      for (let d = 1; d <= days; d++) {
        const idx = d - 1,
          colI = idx >= rows ? 1 : 0;
        listRow(d, ox + colI * (cw + f * 1.6), cw, oy + titleH + ch * ((idx % rows) + 0.5), 2.4, 2.6, 0.2);
      }
    } else if (st === 'transpose') {
      title(1.5);
      const lw0 = f * 2.4,
        gy = oy + titleH;
      ctx.textAlign = 'center';
      ctx.font = cf(f * 0.95);
      for (let i = 0; i < 7; i++) ctx.fillText(wk(i), ox + lw0 / 2, gy + ch * (i + 0.5));
      ctx.fillRect(ox + lw0 - thin, gy, thin, ch * 7);
      ctx.font = cf(f * 1.15);
      for (let d = 1; d <= days; d++) {
        const idx = off + d - 1;
        ctx.fillText(String(d), ox + lw0 + cw * (Math.floor(idx / 7) + 0.5), gy + ch * ((idx % 7) + 0.5));
      }
    } else if (st === 'bigmonth') {
      ctx.textAlign = 'left';
      ctx.font = cf(f * 6.2);
      ctx.fillText(String(c.month + 1), ox, oy + titleH * 0.45);
      ctx.textAlign = 'right';
      ctx.font = cf(f * 1.1);
      ctx.fillText(String(c.year), ox + w, oy + titleH * 0.28);
      ctx.fillText(MONTHS[c.month].slice(0, 3), ox + w, oy + titleH * 0.5);
      ctx.fillRect(ox, oy + titleH * 0.9, w, rule);
      gridAt(oy + titleH, true);
    } else if (st === 'strip') {
      title(1.7);
      const gy = oy + titleH;
      ctx.textAlign = 'center';
      ctx.font = cf(f * 0.9);
      for (let d = 1; d <= days; d++)
        ctx.fillText((ja ? WJ : WE)[(first + d - 1) % 7], ox + cw * (d - 0.5), gy + ch * 0.5);
      ctx.fillRect(ox, gy + ch * 0.98, w, thin);
      ctx.font = cf(f);
      for (let d = 1; d <= days; d++) ctx.fillText(String(d), ox + cw * (d - 0.5), gy + ch * 1.5);
    } else {
      gridAt(oy, false);
    }

    if (guides) {
      const dl = Math.max(6, f * 0.35);
      dashLine(ctx, Math.max(3, f * 0.1), [dl, dl], () => {
        ctx.beginPath();
        ctx.rect(bx - f * 0.3, by - f * 0.3, bw + f * 0.9, bh + f * 0.9);
      });
    }
  }

  /* ---------- 描画 ---------- */
  // preview=true のときだけガイド類を重ねる(保存・全画面は false)
  let dragging = false,
    snapG = { xs: [], ys: [] };
  function render(preview) {
    ctx.fillStyle = S.color.paper;
    ctx.fillRect(0, 0, S.W, S.H);
    renderPhoto();
    if (S.cal.show) drawCal(preview && dragging && target === 'cal');
    else {
      S.calBox = null;
      S.calRect = null;
    }
    if (!preview) return;
    const u = S.W / (cv.clientWidth || S.W); // 画面上の1pxに当たる出力px
    const lines = (xs, ys, lw) =>
      dashLine(ctx, lw, [u * 6, u * 4], () => {
        ctx.beginPath();
        xs.forEach(x => {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, S.H);
        });
        ys.forEach(y => {
          ctx.moveTo(0, y);
          ctx.lineTo(S.W, y);
        });
      });
    if (S.guide) lines([S.W / 2], [S.H / 2], u);
    if (dragging && (snapG.xs.length || snapG.ys.length)) lines(snapG.xs, snapG.ys, u * 2);
  }
  // 保存・全画面用の画像(ガイドなし)
  function finalImage() {
    render(false);
    const c = document.createElement('canvas');
    c.width = S.W;
    c.height = S.H;
    c.getContext('2d').drawImage(cv, 0, 0);
    schedule();
    return c;
  }
  let raf = 0;
  function schedule() {
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0;
        render(true);
      });
  }

  // プレビューの大きさ: ボタンの段(18pxあけて下に置く)の分を引いて、表示領域に収める
  function fit() {
    const stage = $('#stage'),
      tools = $('.tools'),
      pad = 20,
      gap = 18,
      shadow = 4;
    const aw = Math.max(50, stage.clientWidth - pad - shadow);
    const ah = Math.max(50, stage.clientHeight - pad - gap - tools.offsetHeight - shadow);
    const k = Math.min(aw / S.W, ah / S.H),
      w = Math.floor(S.W * k);
    cv.style.width = w + 'px';
    cv.style.height = Math.floor(S.H * k) + 'px';
    // ボタンの段の横幅はプレビューにそろえる(細いときはボタンが収まる幅まで)
    tools.style.width = Math.min(stage.clientWidth - pad, Math.max(w + 4, 340)) + 'px';
    // PC: 右のパネルの上端をプレビューの上端にそろえる
    const panel = $('.panel');
    if (window.matchMedia('(min-width:860px)').matches) {
      const top = cv.getBoundingClientRect().top - $('.app').getBoundingClientRect().top;
      panel.style.marginTop = top + 'px';
      panel.style.maxHeight = `calc(100dvh - 44px - ${top}px - 12px)`;
    } else {
      panel.style.marginTop = '';
      panel.style.maxHeight = '';
    }
  }

  /* ---------- UI の同期 ---------- */
  const MONTH_JA = m => m + 1 + '月';
  function syncUI() {
    $('#algo').value = S.dither.algo;
    $('#px').value = S.dither.px;
    $('#v-px').textContent = S.dither.px + 'px';
    $('#bright').value = S.dither.bright;
    $('#v-bright').textContent = S.dither.bright;
    $('#contrast').value = S.dither.contrast;
    $('#v-contrast').textContent = S.dither.contrast;
    $('#pscale').value = S.photo.scale;
    $('#v-pscale').textContent = '×' + S.photo.scale.toFixed(2);
    $('#invert').checked = S.dither.invert;
    $('#calShow').checked = S.cal.show;
    $('#monthLabel').textContent =
      S.lang === 'ja'
        ? S.cal.year + '年' + MONTH_JA(S.cal.month)
        : MONTHS[S.cal.month][0] + MONTHS[S.cal.month].slice(1).toLowerCase() + ' ' + S.cal.year;
    // 今の言語のコードを表示(押すたびに EN と JA が入れ替わる)
    const ls = $('#langSw');
    ls.textContent = S.lang.toUpperCase();
    ls.setAttribute('aria-label', S.lang === 'en' ? 'Language: English' : '言語: 日本語');
    $('#calStyle').value = S.cal.style;
    $('#calWeek').value = String(S.cal.weekStart);
    $('#calLang').value = S.cal.lang;
    $('#calSize').value = S.cal.size;
    $('#v-calSize').textContent = '×' + S.cal.size.toFixed(2);
    $('#calFont').value = S.cal.font;
    $('#calFrame').checked = S.cal.frame;
    $('#calBg').checked = S.cal.bg;
    $('#guide').setAttribute('aria-pressed', String(S.guide));
    $('#snap').setAttribute('aria-pressed', String(S.snap));
    $('#sound').setAttribute('aria-pressed', String(S.sound));
    drawIcon($('#sound svg'), S.sound ? 'sndOn' : 'sndOff');
    ['ink', 'paper'].forEach(c => {
      const hx = $('#hex-' + c);
      if (document.activeElement !== hx) hx.value = S.color[c].toUpperCase();
      'hsl'.split('').forEach((k, i) => {
        $(`#${c}-${k}`).value = S.hsl[c][i];
        $(`#v-${c}-${k}`).textContent = S.hsl[c][i];
      });
      // 色が出ない組み合わせ(灰色・真っ黒・真っ白)では、効かないスライダーを点線にする
      const [, sat, lit] = S.hsl[c],
        flat = lit === 0 || lit === 100;
      $(`#${c}-h`).classList.toggle('inert', flat || sat === 0);
      $(`#${c}-s`).classList.toggle('inert', flat);
    });
    document
      .querySelectorAll('.sw')
      .forEach(b =>
        b.setAttribute(
          'aria-pressed',
          String(b.dataset.ink === S.color.ink && b.dataset.paper === S.color.paper)
        )
      );
    $('#size').value = S.W + 'x' + S.H;
    // ヘッダーには寸法を除いた短い名前だけ出す(例: iPhone、この端末)
    const so = $('#size').selectedOptions[0];
    $('#sizeLabel').textContent = so ? so.textContent.replace(/\s*\(.*$/, '') : '';
    $('#cropBtns').classList.toggle('single', !S.crop);
    applyTheme();
  }

  function autoPlace() {
    S.photo.scale = 1;
    const dh = (S.W * S.src.height) / S.src.width;
    S.photo.x = 0.5;
    S.photo.y = Math.min(0.5, dh / 2 / S.H + 0.04);
  }

  /* ---------- 入力の配線 ---------- */
  const bindInput = (id, fn, ev = 'input') =>
    $(id).addEventListener(ev, e => {
      fn(e.target);
      syncUI();
      schedule();
    });
  bindInput('#algo', t => (S.dither.algo = t.value), 'change');
  bindInput('#px', t => (S.dither.px = +t.value));
  bindInput('#bright', t => (S.dither.bright = +t.value));
  bindInput('#contrast', t => (S.dither.contrast = +t.value));
  bindInput('#pscale', t => (S.photo.scale = +t.value));
  bindInput('#invert', t => (S.dither.invert = t.checked), 'change');
  bindInput('#calShow', t => (S.cal.show = t.checked), 'change');
  bindInput('#calStyle', t => (S.cal.style = t.value), 'change');
  bindInput('#calWeek', t => (S.cal.weekStart = +t.value), 'change');
  bindInput('#calLang', t => (S.cal.lang = t.value), 'change');
  bindInput('#calSize', t => (S.cal.size = +t.value));
  bindInput('#calFrame', t => (S.cal.frame = t.checked), 'change');
  bindInput('#calBg', t => (S.cal.bg = t.checked), 'change');
  $('#guide').addEventListener('click', () => {
    S.guide = !S.guide;
    syncUI();
    schedule();
  });
  $('#snap').addEventListener('click', () => {
    S.snap = !S.snap;
    syncUI();
    schedule();
  });
  $('#sound').addEventListener('click', () => {
    S.sound = !S.sound;
    syncUI();
  });
  $('#calFont').addEventListener('change', async e => {
    S.cal.font = e.target.value;
    schedule();
    try {
      await document.fonts.load(`16px "${S.cal.font}"`, '0123456789年月日火水木金土SMTWFJANUARYBCDEGHILOPRV');
    } catch (_) {}
    schedule();
  });
  // 色: スライダー(HSL)で調整。色相を保つため HSL を別に持つ
  const toHSL = h => {
    const [r, g, b] = hex(h);
    return rgb2hsl(r, g, b).map(Math.round);
  };
  function setColors(ink, paper) {
    S.color.ink = ink;
    S.color.paper = paper;
    S.hsl = { ink: toHSL(ink), paper: toHSL(paper) };
  }
  // カラーコードの直接入力(#RRGGBB / #RGB、# は省略可)。正しい形になった時点で反映し、確定時に整える
  const parseHex = v => {
    const m = v.trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{6}$/.test(m)) return '#' + m;
    if (/^[0-9a-f]{3}$/.test(m)) return '#' + [...m].map(x => x + x).join('');
    return null;
  };
  document.querySelectorAll('input[data-hex]').forEach(el => {
    const c = el.dataset.hex;
    const apply = full => {
      const h = parseHex(el.value);
      if (!h || (!full && el.value.replace('#', '').length < 6)) return false;
      S.color[c] = h;
      S.hsl[c] = toHSL(h);
      syncUI();
      schedule();
      return true;
    };
    el.addEventListener('input', () => apply(false));
    el.addEventListener('change', () => {
      apply(true);
      el.value = S.color[c].toUpperCase();
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') el.blur();
    });
  });
  document.querySelectorAll('input[data-c]').forEach(el =>
    bindInput('#' + el.id, t => {
      const c = t.dataset.c,
        hsl = S.hsl[c];
      hsl[+t.dataset.i] = +t.value;
      S.color[c] = toHex(hsl2rgb(hsl[0], hsl[1], hsl[2]));
    })
  );

  function shiftMonth(delta) {
    const d = new Date(S.cal.year, S.cal.month + delta, 1);
    S.cal.year = d.getFullYear();
    S.cal.month = d.getMonth();
    syncUI();
    schedule();
  }
  $('#prevM').addEventListener('click', () => shiftMonth(-1));
  $('#nextM').addEventListener('click', () => shiftMonth(1));
  $('#thisM').addEventListener('click', () => {
    S.cal.year = now.getFullYear();
    S.cal.month = now.getMonth();
    syncUI();
    schedule();
  });
  $('#resetCal').addEventListener('click', () => {
    S.cal.x = 0.5;
    S.cal.y = 0.74;
    S.cal.size = 1;
    syncUI();
    schedule();
  });
  $('#resetPhoto').addEventListener('click', () => {
    autoPlace();
    syncUI();
    schedule();
  });

  function setSize(v) {
    const [w, h] = v.split('x').map(Number);
    S.W = w;
    S.H = h;
    cv.width = w;
    cv.height = h;
    if (w > h) {
      S.photo.y = 0.5;
      S.cal.y = 0.5;
      S.cal.x = 0.75;
      S.cal.size = 0.8;
    }
  }
  $('#size').addEventListener('change', e => {
    setSize(e.target.value);
    fit();
    syncUI();
    schedule();
  });
  // スマホで開いたときは、その端末の画面サイズを最初から選んでおく
  (() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const r = window.devicePixelRatio || 1,
      a = Math.round(screen.width * r),
      b = Math.round(screen.height * r);
    const w = Math.min(a, b),
      h = Math.max(a, b);
    if (w < 600 || h > 4000) return;
    const v = w + 'x' + h,
      sel = $('#size');
    if (![...sel.options].some(o => o.value === v))
      sel.insertAdjacentHTML('afterbegin', `<option value="${v}" data-device="${w}×${h}"></option>`);
    setSize(v);
  })();

  // 配色
  const sws = $('#swatches');
  PRESETS.forEach(([ink, paper]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw';
    b.textContent = (ink + '×' + paper).toUpperCase();
    b.dataset.ink = ink;
    b.dataset.paper = paper;
    b.addEventListener('click', () => {
      setColors(ink, paper);
      syncUI();
      schedule();
    });
    sws.appendChild(b);
  });

  // タブ
  document.querySelectorAll('.tabs button').forEach(b =>
    b.addEventListener('click', () => {
      document
        .querySelectorAll('.tabs button')
        .forEach(x => x.setAttribute('aria-selected', String(x === b)));
      document.querySelectorAll('.pane').forEach(p => (p.hidden = p.id !== 'pane-' + b.dataset.tab));
    })
  );

  // 写真の読み込み
  const msg = $('#msg');
  $('#pick').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onerror = () => {
      msg.textContent = t('写真を読み込めませんでした。');
    };
    fr.onload = () => {
      const im = new Image();
      im.onerror = () => {
        msg.textContent = t('写真を読み込めませんでした。JPEG・PNG・WebPを選んでください。');
      };
      im.onload = () => {
        const k = Math.min(1, 2400 / Math.max(im.width, im.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.width * k));
        c.height = Math.max(1, Math.round(im.height * k));
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        S.src = c;
        S.orig = c;
        S.crop = null;
        autoPlace();
        syncUI();
        schedule();
        msg.textContent = '';
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
    e.target.value = '';
  });

  /* ---------- ドラッグ・ピンチ・ホイール ---------- */
  const ptrs = new Map();
  let target = null,
    start = null,
    pinch = null;
  function toCanvas(e) {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * S.W, y: ((e.clientY - r.top) / r.height) * S.H };
  }
  function hitCal(p) {
    const b = S.calBox;
    return !!(S.cal.show && b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const dist = () => {
    const a = [...ptrs.values()];
    return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
  };
  const getScale = () => (target === 'cal' ? S.cal.size : S.photo.scale);
  function setScale(v) {
    if (target === 'cal') S.cal.size = clamp(v, 0.4, 2.5);
    else S.photo.scale = clamp(v, 0.2, 4);
    syncUI();
  }

  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) {
      const p = toCanvas(e);
      target = hitCal(p) ? 'cal' : 'photo';
      const o = target === 'cal' ? S.cal : S.photo;
      start = { px: p.x, py: p.y, ox: o.x, oy: o.y };
      dragging = true;
      snapG = { xs: [], ys: [] };
      cv.classList.add('dragging');
    } else if (ptrs.size === 2) {
      pinch = { d: dist(), s: getScale() };
      start = null;
    }
    schedule();
  });
  cv.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2 && pinch) {
      setScale((pinch.s * dist()) / pinch.d);
      schedule();
    } else if (ptrs.size === 1 && start) {
      const p = toCanvas(e),
        o = target === 'cal' ? S.cal : S.photo;
      o.x = start.ox + (p.x - start.px) / S.W;
      o.y = start.oy + (p.y - start.py) / S.H;
      // 新しい位置に吸着した瞬間だけ音を鳴らす
      const key = () => snapG.xs.join() + '|' + snapG.ys.join(),
        was = key();
      snapG = { xs: [], ys: [] };
      if (S.snap) snapTo(o, (14 * S.W) / cv.getBoundingClientRect().width);
      if (key() !== '|' && key() !== was) sfx.snap();
      schedule();
    }
  });
  const endPtr = e => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0) {
      start = null;
      target = null;
      dragging = false;
      snapG = { xs: [], ys: [] };
      cv.classList.remove('dragging');
    } else if (ptrs.size === 1) start = null;
    schedule();
  };
  cv.addEventListener('pointerup', endPtr);
  cv.addEventListener('pointercancel', endPtr);
  cv.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      target = hitCal(toCanvas(e)) ? 'cal' : 'photo';
      setScale(getScale() * Math.exp(-e.deltaY * 0.0012));
      target = null;
      schedule();
    },
    { passive: false }
  );

  /* ---------- 保存 ---------- */
  let dl = null;
  if (window.claude && typeof window.claude.use === 'function') {
    window.claude
      .use('downloads')
      .then(x => {
        dl = x || null;
      })
      .catch(() => {
        dl = null;
      });
  }
  function showOverlay(img) {
    $('#outImg').src = img.toDataURL('image/png');
    $('#overlay').classList.add('open');
    $('#closeOv').focus();
  }
  $('#closeOv').addEventListener('click', () => $('#overlay').classList.remove('open'));
  $('#overlay').addEventListener('click', e => {
    if (e.target.id === 'overlay') $('#overlay').classList.remove('open');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      $('#overlay').classList.remove('open');
      $('#fs').classList.remove('open');
    }
  });

  function download(blob, name) {
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  $('#save').addEventListener('click', async () => {
    const img = finalImage();
    const name = `1bit-calendar-${S.cal.year}-${String(S.cal.month + 1).padStart(2, '0')}.png`;
    msg.textContent = '';
    try {
      const blob = await new Promise(r => img.toBlob(r, 'image/png'));
      if (!blob) throw new Error('toBlob');
      if (dl) await dl.save({ filename: name, data: blob });
      else download(blob, name);
      sfx.save();
    } catch (err) {
      if (err && err.code === 'declined') msg.textContent = t('保存をキャンセルしました。');
      else showOverlay(img);
    }
  });

  /* ---------- 色の計算 ---------- */
  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s /= 100;
    l /= 100;
    const k = n => (n + h / 30) % 12,
      a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)].map(v => Math.round(v * 255));
  }
  function rgb2hsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const mx = Math.max(r, g, b),
      mn = Math.min(r, g, b),
      l = (mx + mn) / 2,
      d = mx - mn;
    let h = 0,
      s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, s * 100, l * 100];
  }
  const lum = rgb => {
    const f = v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  };
  const contrast = (a, b) => {
    const x = lum(a),
      y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const toHex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
  $('#resetColors').addEventListener('click', () => {
    setColors('#000000', '#ffffff');
    syncUI();
    schedule();
  });
  $('#swapColors').addEventListener('click', () => {
    const h = S.hsl;
    setColors(S.color.paper, S.color.ink);
    S.hsl = { ink: h.paper, paper: h.ink };
    syncUI();
    schedule();
  });

  /* ---------- サイトの色をパレットに合わせる ---------- */
  // UIも選んだ2色をそのまま使う(読みにくい配色でも補正しない)
  function applyTheme() {
    const ink = S.color.ink,
      paper = S.color.paper,
      st = document.documentElement.style;
    st.setProperty('--bg', paper);
    st.setProperty('--fg', ink);
    st.setProperty('--panel', paper);
    st.setProperty('--mute', ink);
    st.setProperty('--on-fg', paper);
    st.setProperty('--ink', ink);
    st.setProperty('--paper', paper);
    // 2色が近くて見にくいときだけリセットを出す。色は背景の色を反転した色
    // (中間の明るさで反転するとほぼ同じ色になるときだけ、白か黒の見やすい方)
    const p = hex(paper),
      inv = p.map(v => 255 - v);
    const alert =
      contrast(inv, p) >= 1.5
        ? inv
        : contrast([0, 0, 0], p) > contrast([255, 255, 255], p)
          ? [0, 0, 0]
          : [255, 255, 255];
    st.setProperty('--alert', toHex(alert));
    $('#resetColors').classList.toggle('show', contrast(hex(ink), p) < 2);
  }

  /* ---------- 辺のスナップ(カレンダーと写真) ---------- */
  function clampCalPos(bw, bh, sh) {
    const loX = bw / 2 / S.W,
      hiX = 1 - (bw / 2 + sh) / S.W;
    const loY = bh / 2 / S.H,
      hiY = 1 - (bh / 2 + sh) / S.H;
    S.cal.x = loX > hiX ? 0.5 : clamp(S.cal.x, loX, hiX);
    S.cal.y = loY > hiY ? 0.5 : clamp(S.cal.y, loY, hiY);
  }
  function photoRect() {
    const w = S.W * S.photo.scale,
      h = (w * S.src.height) / S.src.width;
    return { x: S.photo.x * S.W - w / 2, y: S.photo.y * S.H - h / 2, w, h };
  }
  // スナップ: 動かしている側の辺が、もう一方の4辺に吸着する。
  // ガイドONのときは、中央のガイド線にも辺・中心が吸着する。
  function snapTo(o, thr) {
    const isCal = target === 'cal';
    if (isCal && !S.calRect) return;
    const R = isCal
      ? { x: o.x * S.W - S.calRect.w / 2, y: o.y * S.H - S.calRect.h / 2, w: S.calRect.w, h: S.calRect.h }
      : photoRect();
    const O = isCal ? photoRect() : S.calRect;
    const axis = (lo, size, olo, osize, mid) => {
      let b = null;
      const add = (at, p) => {
        const d = at - p;
        if (Math.abs(d) < thr && (!b || Math.abs(d) < Math.abs(b.d))) b = { d, at };
      };
      if (O)
        for (const at of [olo, olo + osize]) {
          add(at, lo);
          add(at, lo + size);
        }
      if (S.guide) {
        add(mid, lo);
        add(mid, lo + size / 2);
        add(mid, lo + size);
      }
      return b;
    };
    const bx = axis(R.x, R.w, O && O.x, O && O.w, S.W / 2);
    if (bx) {
      o.x += bx.d / S.W;
      snapG.xs.push(bx.at);
    }
    const by = axis(R.y, R.h, O && O.y, O && O.h, S.H / 2);
    if (by) {
      o.y += by.d / S.H;
      snapG.ys.push(by.at);
    }
  }

  /* ---------- トリミング ---------- */
  const crop = { rect: null, asp: 'free', k: 1, dpr: 1, drag: null };
  const cropCv = $('#cropCv'),
    cctx = cropCv.getContext('2d');
  function aspValue() {
    if (crop.asp === 'free') return null;
    if (crop.asp === 'screen') return S.W / S.H;
    return +crop.asp;
  }
  function updateAspUI() {
    document
      .querySelectorAll('#cropAsp button')
      .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.asp === crop.asp)));
  }
  function fitRectToAspect() {
    const a = aspValue();
    if (!a) return;
    const iw = S.orig.width,
      ih = S.orig.height,
      r = crop.rect;
    const cx = r.x + r.w / 2,
      cy = r.y + r.h / 2;
    let w = r.w,
      h = w / a;
    if (h > ih) {
      h = ih;
      w = h * a;
    }
    if (w > iw) {
      w = iw;
      h = w / a;
    }
    crop.rect = { x: clamp(cx - w / 2, 0, iw - w), y: clamp(cy - h / 2, 0, ih - h), w, h };
  }
  function cropLayout() {
    const st = $('#cropStage').getBoundingClientRect();
    const iw = S.orig.width,
      ih = S.orig.height;
    crop.k = Math.min((st.width - 8) / iw, (st.height - 8) / ih);
    crop.dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.floor(iw * crop.k)),
      ch = Math.max(1, Math.floor(ih * crop.k));
    cropCv.style.width = cw + 'px';
    cropCv.style.height = ch + 'px';
    cropCv.width = Math.round(cw * crop.dpr);
    cropCv.height = Math.round(ch * crop.dpr);
    drawCrop();
  }
  function cropHandles() {
    const r = crop.rect,
      k = crop.k,
      x = r.x * k,
      y = r.y * k,
      w = r.w * k,
      h = r.h * k;
    const hs = [
      ['nw', x, y],
      ['ne', x + w, y],
      ['sw', x, y + h],
      ['se', x + w, y + h]
    ];
    if (!aspValue())
      hs.push(['n', x + w / 2, y], ['s', x + w / 2, y + h], ['w', x, y + h / 2], ['e', x + w, y + h / 2]);
    return hs;
  }
  function drawCrop() {
    const cw = cropCv.width / crop.dpr,
      ch = cropCv.height / crop.dpr,
      k = crop.k,
      r = crop.rect;
    cctx.setTransform(crop.dpr, 0, 0, crop.dpr, 0, 0);
    cctx.clearRect(0, 0, cw, ch);
    cctx.drawImage(S.orig, 0, 0, cw, ch);
    const x = r.x * k,
      y = r.y * k,
      w = r.w * k,
      h = r.h * k;
    // 枠の外は背景の色の網点で覆う(半透明は使わない)
    const pc = document.createElement('canvas');
    pc.width = pc.height = 2;
    const pg = pc.getContext('2d');
    pg.fillStyle = S.color.paper;
    pg.fillRect(0, 0, 1, 1);
    pg.fillRect(1, 1, 1, 1);
    const pat = cctx.createPattern(pc, 'repeat');
    pat.setTransform(new DOMMatrix().scale(1 / crop.dpr));
    cctx.fillStyle = pat;
    cctx.fillRect(0, 0, cw, y);
    cctx.fillRect(0, y + h, cw, ch - y - h);
    cctx.fillRect(0, y, x, h);
    cctx.fillRect(x + w, y, cw - x - w, h);
    dashLine(cctx, 1, [4, 4], () => {
      cctx.beginPath();
      for (let i = 1; i < 3; i++) {
        cctx.moveTo(x + (w * i) / 3, y);
        cctx.lineTo(x + (w * i) / 3, y + h);
        cctx.moveTo(x, y + (h * i) / 3);
        cctx.lineTo(x + w, y + (h * i) / 3);
      }
    });
    dashLine(cctx, 2, [6, 6], () => {
      cctx.beginPath();
      cctx.rect(x, y, w, h);
    });
    cropHandles().forEach(p => {
      cctx.fillStyle = S.color.paper;
      cctx.fillRect(p[1] - 7, p[2] - 7, 14, 14);
      cctx.strokeStyle = S.color.ink;
      cctx.lineWidth = 2;
      cctx.strokeRect(p[1] - 6, p[2] - 6, 12, 12);
    });
  }
  function openCrop() {
    const iw = S.orig.width,
      ih = S.orig.height;
    crop.rect = S.crop ? { ...S.crop } : { x: 0, y: 0, w: iw, h: ih };
    crop.asp = 'free';
    crop.drag = null;
    updateAspUI();
    $('#crop').classList.add('open');
    cropLayout();
  }
  function closeCrop() {
    $('#crop').classList.remove('open');
    crop.drag = null;
  }
  function applyCrop() {
    const r = crop.rect,
      c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.w));
    c.height = Math.max(1, Math.round(r.h));
    c.getContext('2d').drawImage(S.orig, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    const full = r.w >= S.orig.width - 1 && r.h >= S.orig.height - 1;
    S.src = full ? S.orig : c;
    S.crop = full ? null : { ...r };
    autoPlace();
    closeCrop();
    syncUI();
    schedule();
  }
  const cropPos = e => {
    const b = cropCv.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  cropCv.addEventListener('pointerdown', e => {
    cropCv.setPointerCapture(e.pointerId);
    const p = cropPos(e),
      r = crop.rect,
      k = crop.k;
    let mode = null,
      best = 26;
    cropHandles().forEach(h => {
      const d = Math.hypot(p.x - h[1], p.y - h[2]);
      if (d < best) {
        best = d;
        mode = h[0];
      }
    });
    if (!mode && p.x >= r.x * k && p.x <= (r.x + r.w) * k && p.y >= r.y * k && p.y <= (r.y + r.h) * k)
      mode = 'move';
    if (mode) crop.drag = { mode, sx: p.x, sy: p.y, r: { ...r } };
  });
  cropCv.addEventListener('pointermove', e => {
    const d = crop.drag;
    if (!d) return;
    const p = cropPos(e),
      k = crop.k,
      iw = S.orig.width,
      ih = S.orig.height,
      s = d.r;
    const dx = (p.x - d.sx) / k,
      dy = (p.y - d.sy) / k,
      min = Math.max(16, 24 / k);
    if (d.mode === 'move') {
      crop.rect = { x: clamp(s.x + dx, 0, iw - s.w), y: clamp(s.y + dy, 0, ih - s.h), w: s.w, h: s.h };
    } else if (!aspValue()) {
      let x1 = s.x,
        y1 = s.y,
        x2 = s.x + s.w,
        y2 = s.y + s.h;
      if (d.mode.includes('w')) x1 = clamp(s.x + dx, 0, x2 - min);
      if (d.mode.includes('e')) x2 = clamp(s.x + s.w + dx, x1 + min, iw);
      if (d.mode.includes('n')) y1 = clamp(s.y + dy, 0, y2 - min);
      if (d.mode.includes('s')) y2 = clamp(s.y + s.h + dy, y1 + min, ih);
      crop.rect = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    } else {
      const a = aspValue(),
        W = d.mode.includes('w'),
        N = d.mode.includes('n');
      const ax = W ? s.x + s.w : s.x,
        ay = N ? s.y + s.h : s.y;
      const nx = (W ? s.x : s.x + s.w) + dx,
        ny = (N ? s.y : s.y + s.h) + dy;
      let w = Math.abs(nx - ax),
        h = Math.abs(ny - ay);
      if (w / a > h) h = w / a;
      else w = h * a;
      const maxW = W ? ax : iw - ax,
        maxH = N ? ay : ih - ay;
      const f = Math.min(1, maxW / w, maxH / h);
      w *= f;
      h *= f;
      if (w < min) {
        w = min;
        h = w / a;
      }
      crop.rect = { x: W ? ax - w : ax, y: N ? ay - h : ay, w, h };
    }
    drawCrop();
  });
  const endCropDrag = () => {
    crop.drag = null;
  };
  cropCv.addEventListener('pointerup', endCropDrag);
  cropCv.addEventListener('pointercancel', endCropDrag);
  document.querySelectorAll('#cropAsp button').forEach(b =>
    b.addEventListener('click', () => {
      crop.asp = b.dataset.asp;
      updateAspUI();
      fitRectToAspect();
      drawCrop();
    })
  );
  $('#cropOpen').addEventListener('click', openCrop);
  $('#cropCancel').addEventListener('click', closeCrop);
  $('#cropApply').addEventListener('click', applyCrop);
  $('#cropFull').addEventListener('click', () => {
    crop.rect = { x: 0, y: 0, w: S.orig.width, h: S.orig.height };
    fitRectToAspect();
    drawCrop();
  });
  $('#cropReset').addEventListener('click', () => {
    S.src = S.orig;
    S.crop = null;
    autoPlace();
    syncUI();
    schedule();
  });
  window.addEventListener('resize', () => {
    if ($('#crop').classList.contains('open')) cropLayout();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCrop();
  });

  /* ---------- 全画面表示 ---------- */
  const fs = $('#fs'),
    fsCv = $('#fsCv');
  let fsImg = null;
  // 余白は2色の市松模様の網点(壁紙の外だと分かるように)。壁紙のまわりにドットの色の細い枠
  function drawFs() {
    if (!fsImg || !fs.classList.contains('open')) return;
    const dpr = window.devicePixelRatio || 1,
      W = Math.round(fs.clientWidth * dpr),
      H = Math.round(fs.clientHeight * dpr);
    fsCv.width = W;
    fsCv.height = H;
    const g = fsCv.getContext('2d'),
      u = Math.max(1, Math.round(dpr * 2)); // 網点1つ = 画面上の2px
    const pc = document.createElement('canvas');
    pc.width = pc.height = u * 2;
    const pg = pc.getContext('2d');
    pg.fillStyle = S.color.paper;
    pg.fillRect(0, 0, u * 2, u * 2);
    pg.fillStyle = S.color.ink;
    pg.fillRect(0, 0, u, u);
    pg.fillRect(u, u, u, u);
    g.fillStyle = g.createPattern(pc, 'repeat');
    g.fillRect(0, 0, W, H);
    const fr = Math.max(1, Math.round(dpr * 2)),
      k = Math.min((W - fr * 2) / S.W, (H - fr * 2) / S.H);
    const w = Math.round(S.W * k),
      h = Math.round(S.H * k),
      x = Math.round((W - w) / 2),
      y = Math.round((H - h) / 2);
    g.fillStyle = S.color.ink;
    g.fillRect(x - fr, y - fr, w + fr * 2, h + fr * 2);
    g.imageSmoothingQuality = 'high';
    g.drawImage(fsImg, x, y, w, h);
  }
  function openFs() {
    fsImg = finalImage();
    fs.classList.add('open');
    drawFs();
    if (fs.requestFullscreen)
      fs.requestFullscreen()
        .then(() => setTimeout(drawFs, 50))
        .catch(() => {});
  }
  function closeFs() {
    fs.classList.remove('open');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }
  $('#fsOpen').addEventListener('click', openFs);
  fs.addEventListener('click', closeFs);
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) fs.classList.remove('open');
    else drawFs();
  });
  window.addEventListener('resize', drawFs);

  /* ---------- 効果音(道具らしい短いクリック音。Web Audio で生成) ---------- */
  // 音階やメロディは使わず、スイッチやダイヤルのような短いノイズのクリックで鳴らす
  const sfx = (() => {
    let ac = null,
      noiseBuf = null,
      lastTick = 0;
    const audio = () => {
      if (!ac) {
        const A = window.AudioContext || window.webkitAudioContext;
        if (!A) return null;
        ac = new A();
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    };
    // 帯域を絞ったノイズを短く鳴らす。freq が高いほど軽く硬い音
    const click = (freq, dur, vol, delay = 0) => {
      if (!S.sound) return;
      const a = audio();
      if (!a) return;
      if (!noiseBuf) {
        noiseBuf = a.createBuffer(1, Math.round(a.sampleRate * 0.05), a.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const t = a.currentTime + 0.005 + delay;
      const src = a.createBufferSource(),
        bp = a.createBiquadFilter(),
        g = a.createGain();
      src.buffer = noiseBuf;
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = 2.5;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp).connect(g).connect(a.destination);
      src.start(t);
      src.stop(t + dur + 0.01);
    };
    return {
      unlock: audio,
      click: () => click(3200, 0.018, 0.5),
      on: () => click(4200, 0.02, 0.55),
      off: () => click(2400, 0.02, 0.5),
      snap: () => click(5500, 0.012, 0.45),
      // シャッターのような2回のクリック
      save: () => {
        click(2000, 0.03, 0.6);
        click(3000, 0.025, 0.5, 0.07);
      },
      // スライダー: ダイヤルの目盛りのような小さなチック(鳴らしすぎない)
      tick: () => {
        const n = performance.now();
        if (n - lastTick < 45) return;
        lastTick = n;
        click(6000, 0.006, 0.3);
      }
    };
  })();
  // 最初の操作で音声を使えるようにする(ブラウザの自動再生制限のため)
  document.addEventListener(
    'pointerdown',
    () => {
      if (S.sound) sfx.unlock();
    },
    { once: true }
  );
  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.id === 'save') return;
    if (b.hasAttribute('aria-pressed')) {
      if (b.id === 'sound' && !S.sound) return;
      b.getAttribute('aria-pressed') === 'true' ? sfx.on() : sfx.off();
    } else sfx.click();
  });
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.type !== 'range') return;
    sfx.tick();
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.type === 'checkbox') t.checked ? sfx.on() : sfx.off();
    else if (t.tagName === 'SELECT') sfx.click();
  });

  /* ---------- タブのドットアイコン(# が1ドット。16×16に中央寄せ) ---------- */
  const ICONS = {
    photo: [
      '....####......',
      '.############.',
      '.#.......##.#.',
      '.#...####...#.',
      '.#..#....#..#.',
      '.#..#....#..#.',
      '.#..#....#..#.',
      '.#...####...#.',
      '.#..........#.',
      '.############.'
    ],
    cal: [
      '...#.....#...',
      '.###########.',
      '.###########.',
      '.#.........#.',
      '.#.#.#.#.#.#.',
      '.#.........#.',
      '.#.#.#.#.#.#.',
      '.#.........#.',
      '.#.#.#.#...#.',
      '.#.........#.',
      '.###########.'
    ],
    color: [
      '....######....',
      '..##......##..',
      '.#..##..##..#.',
      '#...##..##...#',
      '#.##.......##.',
      '#.##......#...',
      '#.........#...',
      '#..##......##.',
      '.#.##.......#.',
      '..##......##..',
      '....######....'
    ],
    sndOn: [
      '.....#........',
      '....##...#....',
      '...###....#...',
      '######..#..#..',
      '######...#.#..',
      '######...#.#..',
      '######..#..#..',
      '...###....#...',
      '....##...#....',
      '.....#........'
    ],
    sndOff: [
      '.....#........',
      '....##........',
      '...###........',
      '######.#...#..',
      '######..#.#...',
      '######...#....',
      '######..#.#...',
      '...###.#...#..',
      '....##........',
      '.....#........'
    ],
    out: [
      '############..',
      '#..#######..#.',
      '#..####.##..##',
      '#..####.##...#',
      '#..#######...#',
      '#............#',
      '#............#',
      '#.##########.#',
      '#.#........#.#',
      '#.#........#.#',
      '#.#........#.#',
      '#.#........#.#',
      '##############'
    ]
  };
  function drawIcon(svg, name) {
    const rows = ICONS[name],
      h = rows.length,
      w = Math.max(...rows.map(r => r.length));
    const ox = Math.floor((16 - w) / 2),
      oy = Math.floor((16 - h) / 2);
    let d = '';
    rows.forEach((r, y) =>
      [...r].forEach((c, x) => {
        if (c === '#') d += `M${x + ox} ${y + oy}h1v1h-1z`;
      })
    );
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.innerHTML = `<path d="${d}"/>`;
  }
  document.querySelectorAll('svg.ico').forEach(svg => drawIcon(svg, svg.dataset.ico));

  /* ---------- 言語(日本語 / English。初期は English) ---------- */
  // HTML は日本語で書き、英語はこの表で置き換える。UI に文言を足したら、ここにも英語を足すこと
  const EN = {
    音: 'Sound',
    言語: 'Language',
    プレビュー: 'Preview',
    プレビューの設定: 'Preview settings',
    '壁紙のプレビュー。ドラッグで写真やカレンダーを動かせます':
      'Wallpaper preview. Drag to move the photo or calendar.',
    ガイド: 'Guide',
    スナップ: 'Snap',
    全画面: 'Fullscreen',
    保存: 'Save',
    写真: 'Photo',
    カレンダー: 'Calendar',
    色: 'Color',
    画像のサイズ: 'Image size',
    '正方形(1080×1080)': 'Square (1080×1080)',
    この端末: 'This device',
    写真を選ぶ: 'Choose photo',
    トリミング: 'Crop',
    トリミング解除: 'Remove crop',
    ドットの模様: 'Dot pattern',
    '格子(粗い)': 'Grid (coarse)',
    格子: 'Grid',
    '格子(細かい)': 'Grid (fine)',
    砂目: 'Grain',
    '砂目(くっきり)': 'Grain (crisp)',
    白黒のみ: 'No dither',
    ドットの大きさ: 'Dot size',
    明るさ: 'Brightness',
    コントラスト: 'Contrast',
    写真の大きさ: 'Photo size',
    明暗を反転する: 'Invert tones',
    写真の位置をリセット: 'Reset photo position',
    カレンダーを表示する: 'Show calendar',
    前の月: 'Previous month',
    次の月: 'Next month',
    今月にする: 'This month',
    レイアウト: 'Layout',
    グリッド: 'Grid',
    縦リスト: 'List',
    '2列リスト': '2-column list',
    縦横入れ替え: 'Transposed',
    ビッグ月: 'Big month',
    '1行': 'Single row',
    数字のみ: 'Numbers only',
    フォント: 'Font',
    'ドット(ドットゴシック)': 'Dot (DotGothic)',
    'ピクセル(英数字)': 'Pixel (Latin only)',
    ターミナル: 'Terminal',
    等幅: 'Monospace',
    明朝: 'Mincho',
    極太ゴシック: 'Heavy gothic',
    手書き: 'Handwritten',
    週の始まり: 'Week starts on',
    日曜: 'Sunday',
    月曜: 'Monday',
    カレンダーの大きさ: 'Calendar size',
    枠をつける: 'Frame',
    背景をつける: 'Background',
    カレンダーの位置をリセット: 'Reset calendar position',
    ドットと背景を入れ替え: 'Swap dot and background',
    ドットの色: 'Dot color',
    背景の色: 'Background color',
    色相: 'Hue',
    鮮やかさ: 'Saturation',
    写真をトリミング: 'Crop photo',
    縦横比: 'Aspect ratio',
    自由: 'Free',
    画面: 'Screen',
    キャンセル: 'Cancel',
    全体: 'Full image',
    適用: 'Apply',
    壁紙の全画面表示: 'Fullscreen wallpaper',
    閉じる: 'Close',
    画像を保存: 'Save image',
    書き出した壁紙: 'Exported wallpaper',
    '画像を長押し(PCは右クリック)して保存できます。': 'Long-press the image (right-click on PC) to save it.',
    '写真を読み込めませんでした。': "Couldn't load the photo.",
    '写真を読み込めませんでした。JPEG・PNG・WebPを選んでください。':
      "Couldn't load the photo. Choose a JPEG, PNG or WebP file.",
    '保存をキャンセルしました。': 'Save canceled.'
  };
  const t = ja => (S.lang === 'en' ? EN[ja] || ja : ja);
  // 置き換え対象の文字と属性を、最初に日本語の原文ごと覚えておく
  const i18nText = [],
    i18nAttr = [];
  (() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: n =>
        n.parentNode.closest('script,style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    for (let n; (n = w.nextNode()); ) {
      const ja = n.nodeValue.trim();
      if (EN[ja]) i18nText.push({ n, ja, raw: n.nodeValue });
    }
    document.querySelectorAll('[aria-label],[title],[alt]').forEach(el =>
      ['aria-label', 'title', 'alt'].forEach(a => {
        const ja = el.getAttribute(a);
        if (ja && EN[ja]) i18nAttr.push({ el, a, ja });
      })
    );
  })();
  function applyLang() {
    document.documentElement.lang = S.lang;
    i18nText.forEach(({ n, ja, raw }) => {
      n.nodeValue = raw.replace(ja, t(ja));
    });
    i18nAttr.forEach(({ el, a, ja }) => el.setAttribute(a, t(ja)));
    document.querySelectorAll('option[data-device]').forEach(o => {
      o.textContent = `${t('この端末')}(${o.dataset.device})`;
    });
    if (msg.textContent) msg.textContent = '';
    syncUI();
    fit();
  }
  $('#langSw').addEventListener('click', () => {
    S.lang = S.lang === 'en' ? 'ja' : 'en';
    applyLang();
  });

  /* ---------- 起動 ---------- */
  S.src = makeSample();
  S.orig = S.src;
  S.crop = null;
  autoPlace();
  applyLang();
  render(true);
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe($('#stage'));
  if (document.fonts && document.fonts.load) {
    document.fonts
      .load(`16px "DotGothic16"`, '0123456789年月日火水木金土SMTWFJANUARYBCDEGHILOPRV')
      .then(() => schedule())
      .catch(() => {});
    document.fonts.ready.then(() => schedule());
  }
})();
