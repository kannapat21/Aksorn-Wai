'use strict';
/*
 * หน้าเว็บ "ใส่ซับอัตโนมัติ"
 *   /subtitles       เลือกแบบตัวอักษรจากคลัง + อัปคลิป + รายการคลิปของฉัน
 *   /subtitles/:id   รอถอดเสียง → แก้คำ/เลือกหน้าตา (ดูตัวอย่างสดบนคลิปจริง) → สร้างคลิป → ดาวน์โหลด MP4 / .srt
 */
const h = () => require('./views')._h;

const STATUS = {
  queued: ['รอคิวฟังเสียง', 'wait'], transcribing: ['กำลังฟังเสียง', 'run'], review: ['รอแก้คำ', 'wait'],
  queued_render: ['รอคิวสร้างคลิป', 'wait'], rendering: ['กำลังสร้างคลิป', 'run'], done: ['พร้อมโหลด', 'ok'], failed: ['ไม่สำเร็จ', 'bad'],
};
const MOTION_NOTE = {
  kinetic: 'คำเด้งขึ้นตรงจังหวะพูดทีละคำ มีไฮไลต์คำที่กำลังพูด',
  cinema: 'ตัวอักษรโผล่จากความเบลอทีละตัว มีเส้นบางบนล่าง',
  neon: 'ไฟนีออนติดแบบกระพริบ แสงฟุ้ง (สีขอบ = สีแสงฟุ้ง)',
  pop: 'แต่ละบรรทัดเด้งขยายเข้า แล้วจางออก',
  drop: 'แต่ละบรรทัดร่วงลงมาเด้งกระดอน',
};

const fmtDur = (sec) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const hoursLeft = (job, now) => { const ms = job.expires_at - now; return ms <= 0 ? 'กำลังลบ' : ms < 3600e3 ? `${Math.max(1, Math.round(ms / 60e3))} นาที` : `${Math.round(ms / 3600e3)} ชม.`; };
const badge = (job) => { const [l, c] = STATUS[job.status] || [job.status, '']; const { esc } = h(); return `<span class="badge ${c}">${esc(l)}</span>`; };

function jobList(jobs, now) {
  const { esc, ICON } = h();
  if (!jobs.length) return '';
  return `<section class="sub-jobs"><div class="section-head"><div><p class="eyebrow">ลบอัตโนมัติเพื่อความเป็นส่วนตัว</p><h2>คลิปของฉัน</h2></div></div>
  <ul class="versions">${jobs.map((j) => `
    <li class="v-row">
      <a class="v-link" href="/subtitles/${esc(j.id)}">
        <span class="sub-thumb ${j.height > j.width ? 'v' : 'h'}">${ICON.film}</span>
        <span class="v-main"><b>${esc(j.src_name || 'คลิป')}</b><small>${esc(fmtDur(j.duration))} นาที · ${esc(j.width)}×${esc(j.height)} · ลบอัตโนมัติในอีก ${esc(hoursLeft(j, now))}</small></span>
      </a>
      ${j.status === 'done' ? `<a class="btn small primary" href="/subtitles/${esc(j.id)}/download">${ICON.download} MP4</a>` : badge(j)}
    </li>`).join('')}</ul></section>`;
}

function subtitlesHome({ cfg, user, csrf, owned, jobs, limits, ready, now, picked, browserMode = false }) {
  const { layout, esc, ICON, V } = h();
  const S = cfg.subtitles;
  const bm = Boolean(browserMode);
  const left = limits.maxPerDay > 0 ? Math.max(0, limits.maxPerDay - limits.today) : Infinity;
  const busy = limits.active > 0;
  const can = ready.ok && owned.length > 0 && left > 0 && !busy;
  const choice = owned.find((o) => o.order.id === picked) || owned.find((o) => o.p.motion === 'kinetic') || owned[0];
  const cards = owned.map(({ order, p }) => `
      <label class="sub-style">
        <input type="radio" name="order" value="${esc(order.id)}" ${choice && choice.order.id === order.id ? 'checked' : ''} required>
        <span class="sub-style-card">
          <img src="/previews/${esc(p.slug)}_vertical.jpg" alt="" width="540" height="960" loading="lazy">
          <span class="sub-style-txt"><b>${esc(p.title)}</b><small>${esc(MOTION_NOTE[p.motion] || '')}</small></span>
          ${p.motion === 'kinetic' ? '<i class="sub-rec">แนะนำสำหรับซับ</i>' : ''}
        </span>
      </label>`).join('');
  const state = !ready.ok ? `<div class="note warn">${ICON.shield}<span><b>ระบบใส่ซับยังไม่เปิดให้ใช้ชั่วคราว</b> ร้านกำลังเตรียมเครื่อง ลองใหม่ภายหลัง</span></div>`
    : busy ? `<div class="note">${ICON.bolt}<span>มีคลิปที่กำลังทำอยู่ รอให้เสร็จก่อนแล้วค่อยอัปคลิปใหม่ (ดูด้านล่าง)</span></div>`
      : left <= 0 ? `<div class="note warn">${ICON.shield}<span>วันนี้อัปครบ ${esc(limits.maxPerDay)} คลิปแล้ว อัปเพิ่มได้อีกครั้งพรุ่งนี้</span></div>` : '';
  return layout({
    title: 'ใส่ซับอัตโนมัติ', shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-subtitles',
    body: `
<nav class="crumb" aria-label="ตำแหน่งหน้า"><a href="/library">คลังของฉัน</a><span>/</span><span aria-current="page">ใส่ซับอัตโนมัติ</span></nav>
<div class="sub-hero">
  <p class="eyebrow">ใหม่ · ใช้ได้กับทุกแบบในคลังของคุณ</p>
  <h1>ใส่ซับอัตโนมัติ</h1>
  <p class="lead">อัปคลิปที่มีเสียงพูดภาษาไทย ระบบฟังแล้วพิมพ์ซับให้ แก้คำที่ผิดได้ก่อน แล้วได้คลิปพร้อมซับด้วยแบบตัวอักษรที่คุณเลือก</p>
  <ol class="sub-steps" aria-label="ขั้นตอน">
    <li><b>1</b><span>เลือกแบบ + อัปคลิป</span></li>
    <li><b>2</b><span>ระบบฟังเสียง ทำซับให้</span></li>
    <li><b>3</b><span>ตรวจคำ ปรับหน้าตา</span></li>
    <li><b>4</b><span>ได้คลิปพร้อมซับ + ไฟล์ .srt</span></li>
  </ol>
</div>
${state}
${owned.length ? `
<form class="sub-new" data-sub-new ${bm ? 'data-browser' : ''} data-csrf="${esc(csrf)}" data-max-mb="${esc(S.maxMb)}" data-max-sec="${esc(S.maxSeconds)}" ${can ? '' : 'data-off'}>
  <fieldset class="cz-field">
    <legend>1. เลือกแบบตัวอักษรจากคลัง <span class="muted small">เปลี่ยนฟอนต์ สี และแบบได้อีกทีตอนตรวจคำ</span></legend>
    <div class="sub-styles">${cards}</div>
  </fieldset>
  <fieldset class="cz-field">
    <legend>2. ${bm ? 'เลือกคลิป <span class="muted small">คลิปอยู่ในเครื่องคุณ ไม่ถูกอัปโหลด ร้านรับแค่เสียงพูดไปถอดเป็นข้อความ</span>' : 'อัปโหลดคลิป'}</legend>
    <label class="sub-drop" data-drop>
      <input type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.m4v,.webm,.mkv" data-file ${can ? '' : 'disabled'}>
      <span class="sub-drop-icon">${ICON.film}</span>
      <b data-file-name>แตะเพื่อเลือกคลิป หรือลากไฟล์มาวาง</b>
      <small class="muted" data-file-info>MP4 / MOV · ยาวไม่เกิน ${esc(Math.round(S.maxSeconds / 60))} นาที · ไม่เกิน ${esc(S.maxMb)} MB</small>
    </label>
    <div class="sub-up" data-up hidden>
      <div class="job-bar"><i data-up-bar style="width:0%"></i></div>
      <p class="small"><b data-up-pct>0%</b> · <span data-up-text>กำลังอัปโหลด</span></p>
    </div>
    <p class="error small" data-up-err role="alert" hidden></p>
  </fieldset>
  <button type="button" class="btn primary block lg" data-start disabled>${ICON.bolt} เริ่มทำซับ</button>
  <p class="muted small center">${left === Infinity ? 'ใช้ฟรีสำหรับเจ้าของแบบในคลัง' : `วันนี้อัปได้อีก ${esc(left)} คลิป`} · คลิป ซับ และไฟล์ที่ได้จะถูกลบอัตโนมัติหลัง ${esc(S.retentionHours)} ชั่วโมง ร้านไม่นำคลิปของคุณไปใช้ต่อ</p>
</form>` : `
<div class="empty">
  <p><b>ต้องมีแบบตัวอักษรในคลังก่อน 1 แบบ</b></p>
  <p class="muted small">มีแบบฟรีให้กดรับได้เลย หรือเลือกแบบพรีเมียม เช่น "คำเด้งทีละคำ" ที่เด้งตามจังหวะพูด</p>
  <p><a class="btn primary" href="/#catalog">เลือกแบบตัวอักษร</a></p>
</div>`}
${jobList(jobs, now)}
<script src="/subtitles.js?v=${V}" defer></script>
${bm ? h().browserScripts() : ''}`,
  });
}

function subtitleJob({ cfg, user, csrf, job, cues, owned, fonts, layoutInfo, position, now, save = false }) {
  const { layout, esc, ICON, V, fontFaces, fmtBytes, FILL_SWATCHES, STROKE_SWATCHES } = h();
  const busy = ['queued', 'transcribing', 'queued_render', 'rendering'].includes(job.status);
  const asr = job.status === 'queued' || job.status === 'transcribing';
  const p = cfg.products.find((x) => x.slug === job.product_slug) || {};
  const head = `
<nav class="crumb" aria-label="ตำแหน่งหน้า"><a href="/library">คลังของฉัน</a><span>/</span><a href="/subtitles">ใส่ซับอัตโนมัติ</a><span>/</span><span aria-current="page">${esc(job.src_name || 'คลิป')}</span></nav>
<div class="sub-head">
  <div><p class="eyebrow">${badge(job)} · ${esc(fmtDur(job.duration))} นาที · ${esc(job.width)}×${esc(job.height)}</p><h1>${esc(job.src_name || 'คลิปของฉัน')}</h1></div>
  <p class="muted small">ลบอัตโนมัติในอีก ${esc(hoursLeft(job, now))}</p>
</div>`;
  const poll = (title, note) => `
<div class="job sub-wait" data-sub-poll="/subtitles/${esc(job.id)}/status" data-status="${esc(job.status)}">
  <div class="sub-wave" aria-hidden="true">${'<i></i>'.repeat(9)}</div>
  <h2>${title}</h2>
  <div class="job-bar"><i data-job-bar style="width:${esc(job.progress)}%"></i></div>
  <p><b data-job-pct>${esc(job.progress)}%</b> · <span data-job-stage>${position ? `รอคิว (ลำดับที่ ${esc(position)})` : esc(job.stage || 'กำลังเริ่ม')}</span> <span class="muted" data-job-time></span></p>
  <p class="muted small">${note}</p>
</div>`;
  const bm = Boolean(job.browser);
  const clipAsk = (text) => `<label class="sub-drop" data-clip-ask hidden><input type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.mkv"><span class="sub-drop-icon">${ICON.film}</span><b>${text}</b><small class="muted">${esc(job.src_name || '')} · ร้านไม่ได้เก็บคลิปของคุณไว้</small></label>`;
  if (bm && (job.status === 'transcribing' || (job.status === 'failed' && !job.cues_json))) {
    return layout({
      title: 'กำลังฟังเสียง', shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-subtitles',
      body: `${head}
<div class="job sub-wait" data-sub-resume data-id="${esc(job.id)}" data-csrf="${esc(csrf)}">
  <div class="sub-wave" aria-hidden="true">${'<i></i>'.repeat(9)}</div>
  <h2>${job.status === 'failed' ? esc(job.error || 'ฟังเสียงไม่สำเร็จ') : 'ฟังเสียงพูดต่อจากคลิปในเครื่องคุณ'}</h2>
  <div class="job-bar"><i data-bar style="width:0%"></i></div>
  <p><b data-pct>0%</b> · <span data-stage>กำลังหาคลิปในเครื่อง</span></p>
  <p class="error small" data-err role="alert" hidden></p>
  <label class="sub-drop" data-pick hidden><input type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.mkv"><span class="sub-drop-icon">${ICON.film}</span><b>เลือกคลิปเดิมอีกครั้ง (${esc(job.src_name || 'คลิป')})</b><small class="muted">เปิดหน้านี้ค้างไว้จนเสร็จ</small></label>
</div>
${removeForm(job, csrf)}
${h().browserScripts()}`,
    });
  }
  if (bm && job.status === 'done') {
    return layout({
      title: 'คลิปพร้อมซับ', shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-subtitles',
      body: `${head}
<section class="ready-box sub-result" data-burn-again="${esc(job.id)}" data-csrf="${esc(csrf)}" ${save ? 'data-auto' : ''}>
  <div class="ready-head">${ICON.check}<div><h2>สร้างคลิปพร้อมซับแล้ว</h2><p class="muted small">MP4 ${esc(layoutInfo.w)}×${esc(layoutInfo.h)} · ใช้แบบ "${esc(p.title || '')}" · คลิปบันทึกลงเครื่องคุณตอนสร้างเสร็จ</p></div></div>
  ${clipAsk('เลือกคลิปต้นฉบับเพื่อสร้างไฟล์อีกครั้ง')}
  <div class="job-bar"><i data-bar style="width:0%"></i></div>
  <p class="small"><b data-pct>0%</b> · <span data-stage>กดปุ่มด้านล่างเพื่อสร้างไฟล์อีกครั้ง</span></p>
  <p class="error small" data-err role="alert" hidden></p>
  <video class="sub-out ${job.height > job.width ? 'v' : 'h'}" data-out-video controls playsinline hidden></video>
  <div class="dl-pair">
    <button type="button" class="btn primary lg block" data-go>${ICON.download} สร้างและดาวน์โหลด MP4 อีกครั้ง</button>
    <a class="btn block" href="/subtitles/${esc(job.id)}/srt">${ICON.download} ไฟล์ซับ .srt</a>
  </div>
  <form method="post" action="/subtitles/${esc(job.id)}/edit"><input type="hidden" name="csrf" value="${esc(csrf)}"><button class="btn ghost block" type="submit">${ICON.edit} แก้ซับหรือเปลี่ยนแบบ แล้วสร้างใหม่</button></form>
</section>
${removeForm(job, csrf)}
<span data-local-clip="${esc(job.id)}" hidden></span>
${h().browserScripts()}`,
    });
  }
  if (job.status === 'failed' && !job.cues_json) {
    return layout({
      title: 'ถอดเสียงไม่สำเร็จ', shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-subtitles',
      body: `${head}
<div class="job sub-wait">
  <h2>ถอดเสียงไม่สำเร็จ</h2>
  <p>${esc(job.error || 'ถอดเสียงไม่สำเร็จ')}</p>
  <form method="post" action="/subtitles/${esc(job.id)}/retry"><input type="hidden" name="csrf" value="${esc(csrf)}"><button class="btn primary" type="submit">ลองถอดเสียงใหม่</button></form>
</div>
${removeForm(job, csrf)}`,
    });
  }
  if (asr) {
    return layout({
      title: 'กำลังฟังเสียง', shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-subtitles',
      body: `${head}${poll('ระบบกำลังฟังเสียงพูดในคลิป', `คลิปยาว ${esc(fmtDur(job.duration))} นาที ใช้เวลาประมาณ ${esc(Math.max(1, Math.round(job.duration / 60 + 0.5)))}–${esc(Math.max(3, Math.round(job.duration / 20 + 1)))} นาที (นานขึ้นถ้าเครื่องร้านทำงานหนัก) · ปิดหน้านี้ได้ กลับมาที่ "ใส่ซับอัตโนมัติ" ในคลังภายหลัง`)}
${removeForm(job, csrf)}
<script src="/subtitles.js?v=${V}" defer></script>`,
    });
  }

  const outFile = job.status === 'done' ? `
<section class="ready-box sub-result">
  <div class="ready-head">${ICON.check}<div><h2>คลิปพร้อมซับเสร็จแล้ว</h2><p class="muted small">MP4 ${esc(job.width)}×${esc(job.height)}${job.out_bytes ? ` · ${fmtBytes(job.out_bytes)}` : ''} · ใช้แบบ "${esc(p.title || '')}"</p></div></div>
  <video class="sub-out ${job.height > job.width ? 'v' : 'h'}" src="/subtitles/${esc(job.id)}/download?inline=1" controls playsinline preload="metadata"></video>
  <div class="dl-pair">
    <a class="btn primary lg block" href="/subtitles/${esc(job.id)}/download">${ICON.download} ดาวน์โหลดคลิป MP4</a>
    <a class="btn block" href="/subtitles/${esc(job.id)}/srt">${ICON.download} ไฟล์ซับ .srt</a>
  </div>
  <p class="muted small">ไฟล์ .srt ใช้ใส่ซับเองใน CapCut / Premiere / YouTube ได้ · ไฟล์ทั้งหมดถูกลบอัตโนมัติในอีก ${esc(hoursLeft(job, now))} โหลดเก็บไว้ก่อน</p>
  <form method="post" action="/subtitles/${esc(job.id)}/edit"><input type="hidden" name="csrf" value="${esc(csrf)}"><button class="btn ghost block" type="submit">${ICON.edit} แก้ซับหรือเปลี่ยนแบบ แล้วสร้างใหม่</button></form>
</section>` : '';
  if (job.status === 'done') {
    return layout({ title: 'คลิปพร้อมซับ', shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-subtitles', body: `${head}${outFile}${removeForm(job, csrf)}<script src="/subtitles.js?v=${V}" defer></script>` });
  }

  const rendering = job.status === 'queued_render' || job.status === 'rendering';
  const data = {
    id: job.id, duration: job.duration, width: layoutInfo.w, height: layoutInfo.h, cues,
    style: { order: job.order_id, font: job.font, fill: job.fill, stroke: job.stroke, outline: job.outline, shadow: Boolean(job.shadow), size: String(sizePct(job.size)), position: job.position },
    owned: owned.map(({ order, p: pp }) => ({ id: order.id, title: pp.title, motion: pp.motion })),
    fonts: fonts.map((f) => ({ id: f.id, weight: f.weight, chars: f.chars || null, label: f.label })),
    csrf, disabled: rendering, browser: bm,
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const swatches = (name, list, cur) => list.map((c) => `<button type="button" class="swatch${c === cur ? ' active' : ''}" data-swatch="${name}" data-color="${c}" style="--c:${c}" aria-label="สี ${c}"></button>`).join('');
  const seg = (name, opts, cur) => `<div class="seg seg-wide">${opts.map(([k, l]) => `<label class="seg-opt"><input type="radio" name="${name}" value="${k}" ${cur === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
  const fontOpts = fonts.map((f) => `<label class="font-opt"><input type="radio" name="font" value="${esc(f.id)}" ${f.id === job.font ? 'checked' : ''}><span class="font-sample" style="font-family:'tt-${esc(f.id)}';font-weight:${esc(f.weight || 700)}">ซับไทย สวัสดี</span><small>${esc(f.label)}${f.user ? ' · <b>ของฉัน</b>' : ''}</small></label>`).join('');
  const styleCards = owned.map(({ order, p: pp }) => `<label class="sub-chip"><input type="radio" name="order" value="${esc(order.id)}" ${order.id === job.order_id ? 'checked' : ''}><span>${esc(pp.title)}</span></label>`).join('');

  return layout({
    title: 'ตรวจคำและเลือกแบบ', shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-subtitles page-sub-edit', wide: true,
    body: `
<style>${fontFaces(fonts)}</style>
${head}
${job.status === 'failed' ? `<div class="note warn">${ICON.shield}<span><b>${esc(job.error || 'ไม่สำเร็จ')}</b> แก้แล้วกดสร้างคลิปอีกครั้งได้</span></div>` : ''}
${rendering ? poll('กำลังสร้างคลิปพร้อมซับ', 'ปิดหน้านี้ได้ งานทำต่อเบื้องหลัง') : ''}
${!rendering && !cues.length ? `<div class="note">${ICON.shield}<span><b>ระบบไม่ได้ยินเสียงพูดในคลิปนี้</b> พิมพ์ซับเองได้: เล่นคลิปถึงจุดที่ต้องการ แล้วกด "+ เพิ่มบรรทัด"</span></div>` : ''}
<div class="sub-editor${rendering ? ' is-off' : ''}" data-sub-editor>
  <div class="sub-player-col">
    <div class="sub-player" data-player style="aspect-ratio:${esc(layoutInfo.w)} / ${esc(layoutInfo.h)}">
      <video ${bm ? '' : `src="/subtitles/${esc(job.id)}/source" `}playsinline preload="metadata" data-video></video>
      <div class="sub-band" data-band aria-hidden="true"><div class="cz-text sub-text" data-sub-text><span class="fill"></span></div></div>
      <button type="button" class="sub-play" data-play aria-label="เล่น/หยุด">${ICON.play}</button>
    </div>
    ${bm ? `<div data-local-clip="${esc(job.id)}">${clipAsk('เลือกคลิปเดิมเพื่อดูตัวอย่างและสร้างคลิป')}</div>` : ''}
  </div>
  <div class="sub-tl" data-tl>
    <div class="sub-tl-bar">
      <button type="button" class="sub-mini sub-tl-play" data-tl-play aria-label="เล่น/หยุด">${ICON.play}</button>
      <span class="sub-tl-clock" data-clock>0:00</span>
      <button type="button" class="sub-mini" data-tl-undo title="เลิกทำ (Ctrl/⌘+Z)" aria-label="เลิกทำ" disabled>↶</button>
      <span class="sub-tl-zoom"><button type="button" class="sub-mini" data-tl-zoom="-1" aria-label="ย่อไทม์ไลน์">−</button><button type="button" class="sub-mini" data-tl-zoom="1" aria-label="ขยายไทม์ไลน์">+</button></span>
    </div>
    <div class="sub-tl-scroll" data-tl-scroll>
      <div class="sub-tl-track" data-tl-track role="slider" tabindex="0" aria-label="ไทม์ไลน์ เลื่อนเวลา" aria-valuemin="0" aria-valuemax="${esc(Math.round(job.duration))}" aria-valuenow="0">
        <div class="sub-tl-cues" data-tl-cues></div>
        <div class="sub-tl-head" data-tl-head></div>
      </div>
      <canvas class="sub-tl-wave" data-tl-wave aria-hidden="true"></canvas>
    </div>
    <div class="sub-tl-tools" ${rendering ? 'hidden' : ''}>
      <button type="button" class="sub-tool" data-tl-edit>✎ แก้คำ</button>
      <button type="button" class="sub-tool" data-tl-split title="แบ่งบรรทัดตรงเส้นเวลา (S)">✂ แบ่ง</button>
      <button type="button" class="sub-tool" data-tl-del>🗑 ลบ</button>
      <button type="button" class="sub-tool" data-add>+ เพิ่ม</button>
    </div>
    <p class="muted small sub-tl-hint">แตะบล็อกซับเพื่อเลือก แตะซ้ำ (หรือกด ✎) เพื่อพิมพ์แก้ในบล็อกได้เลย · ลากขอบบล็อกเพื่อปรับเวลาเริ่ม/จบ</p>
  </div>
  <div data-filters></div>
  <div class="sub-go">
    <button type="button" class="btn primary lg block" data-render ${rendering ? 'disabled' : ''}>${ICON.bolt} สร้างคลิปพร้อมซับ</button>
    <p class="small muted sub-save" data-save-state role="status">บันทึกอัตโนมัติ</p>
    <p class="error" data-err role="alert" hidden></p>
${bm ? `    <section class="ready-box sub-result" data-burn hidden>
      <div class="job-bar"><i data-bar style="width:0%"></i></div>
      <p class="small"><b data-pct>0%</b> · <span data-stage>กำลังเริ่ม</span></p>
      <p class="error small" data-err role="alert" hidden></p>
      <p class="muted small">สร้างในเบราว์เซอร์ของคุณ เปิดหน้านี้ค้างไว้จนเสร็จ (คลิป 1 นาทีใช้ราว 1–3 นาที)</p>
      <video class="sub-out ${job.height > job.width ? 'v' : 'h'}" data-out-video controls playsinline hidden></video>
    </section>
` : ''}  </div>
  <details class="sub-look">
    <summary><b>หน้าตาซับ</b><span class="muted small" data-look-sum></span></summary>
    <fieldset class="cz-field" ${rendering ? 'disabled' : ''} data-look>
      <legend class="sr-only">หน้าตาซับ</legend>
      <p class="sub-label">แบบในคลัง</p>
      <div class="sub-chips">${styleCards}</div>
      <p class="muted small" data-motion-note></p>
      <p class="sub-label" id="sub-font-l">ฟอนต์</p>
      <div class="font-pick" data-font-pick>
        <button type="button" class="font-cur" data-font-cur aria-expanded="false" aria-labelledby="sub-font-l"><span data-font-cur-name></span><i aria-hidden="true">▾</i></button>
        <div class="font-list" data-font-list role="radiogroup" aria-labelledby="sub-font-l" hidden>
          ${fontOpts}
          <a class="font-add" href="/library/fonts">+ เพิ่มฟอนต์ของฉัน (.ttf / .otf)</a>
        </div>
      </div>
      <div class="sub-size">
        <label class="sub-label" for="sub-size">ขนาดตัวอักษร <output data-size-out></output></label>
        <input type="range" id="sub-size" name="size" min="${SIZE_MIN}" max="${SIZE_MAX}" step="5" value="${esc(sizePct(job.size))}" data-size>
        <div class="sub-size-q"><button type="button" class="sub-mini" data-size-q="80">เล็ก</button><button type="button" class="sub-mini" data-size-q="100">กลาง</button><button type="button" class="sub-mini" data-size-q="125">ใหญ่</button><button type="button" class="sub-mini" data-size-q="150">ใหญ่มาก</button></div>
      </div>
      <p class="sub-label">ตำแหน่ง</p>
      ${seg('position', [['top', 'บน'], ['middle', 'กลาง'], ['bottom', 'ล่าง']], job.position)}
      <p class="sub-label">สีตัวอักษร</p>
      <div class="swatches">${swatches('fill', FILL_SWATCHES, job.fill)}<label class="swatch-pick"><input type="color" name="fill" value="${esc(job.fill)}" aria-label="เลือกสีเอง"><span>เลือกเอง</span></label></div>
      <p class="sub-label">ขอบ</p>
      ${seg('outline', [['none', 'ไม่มี'], ['thin', 'บาง'], ['medium', 'กลาง'], ['thick', 'หนา']], job.outline)}
      <div class="swatches" data-stroke-row>${swatches('stroke', STROKE_SWATCHES, job.stroke)}<label class="swatch-pick"><input type="color" name="stroke" value="${esc(job.stroke)}" aria-label="เลือกสีขอบเอง"><span>เลือกเอง</span></label></div>
      <label class="toggle sub-toggle"><input type="checkbox" name="shadow" value="1" ${job.shadow ? 'checked' : ''}><span class="toggle-ui"></span><span>เงาใต้ตัวอักษร <small class="muted">(อ่านง่ายบนพื้นสว่าง)</small></span></label>
    </fieldset>
  </details>
  <p class="sub-more"><a class="btn small ghost" href="/subtitles/${esc(job.id)}/srt" data-srt>${ICON.download} ไฟล์ซับ .srt</a></p>
</div>
${removeForm(job, csrf)}
<script type="application/json" id="sub-data">${json}</script>
<script src="/motion.js?v=${V}" defer></script>
<script src="/subplan.js?v=${V}" defer></script>
<script src="/subtitles.js?v=${V}" defer></script>
${bm ? `<script type="module" src="/render-ui.js?v=${V}"></script>` : ''}`,
  });
}

// ขนาดซับเป็น % ของขนาดมาตรฐาน (ค่าเก่า sm/md/lg ยังอ่านได้)
const { SIZE_MIN, SIZE_MAX, sizePct } = require('../public/subplan');

function removeForm(job, csrf) {
  const { esc } = h();
  return `<form method="post" action="/subtitles/${esc(job.id)}/delete" class="danger-zone" data-confirm-title="ลบคลิปนี้เลยไหม?" data-confirm="คลิปต้นฉบับ ข้อความซับ และไฟล์ที่สร้างแล้วจะถูกลบถาวร กู้คืนไม่ได้" data-confirm-ok="ลบเลย" data-confirm-danger>
  <input type="hidden" name="csrf" value="${esc(csrf)}">
  <button type="submit" class="linklike danger">ลบคลิปนี้ทันที (ไม่ต้องรอลบอัตโนมัติ)</button>
</form>`;
}

module.exports = { subtitlesHome, subtitleJob };
