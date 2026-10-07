// dsh-prompt-buttons — Client 半（浏览器 bundle，手写 __ModuleLoader__ 格式）。
// 三部分：① conversation.input.left 的提示词切换按钮（单选、发送后自动清除）；
// ② 提醒音引擎（完成/提问/审批/出错四类独立音色 + 阻断事件重复提醒）；
// ③ settings.section 的「插件设置」页，内置二级标签：提示词按钮 / 提醒音。
//
// 提醒音引擎的事件检测与音频排程思路参考自 @machine-126/dsh-alert-sound（MIT），
// 经吸收重写后配置与 UI 完全归本插件所有。
window.__ModuleLoader__.load({
  id: '@local/dsh-prompt-buttons',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useSyncExternalStore } = React;

    // ============================================================
    // 共享小件
    // ============================================================
    function makeStore(load, persist) {
      let value = load();
      const subs = new Set();
      return {
        get: () => value,
        set(next) {
          value = next;
          try { persist(next); } catch { /* ignore */ }
          subs.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
        },
        subscribe(fn) {
          subs.add(fn);
          return () => subs.delete(fn);
        },
        notify() {
          subs.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
        },
        reload() {
          value = load();
          subs.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
        },
      };
    }

    // ============================================================
    // ① 提示词按钮：配置存储
    // ============================================================
    const LS_KEY = 'dsh-prompt-buttons.v1';
    const DEFAULT_BUTTONS = [
      { id: 'concise', label: '简洁', prompt: '[输出格式：不要废话，只简洁明了输出回复]', enabled: true },
      { id: 'detailed', label: '详细', prompt: '[输出格式：尽可能详细，不要错过任何一个重点]', enabled: true },
    ];
    function sanitizeButtons(raw) {
      if (!raw || !Array.isArray(raw.buttons)) return { buttons: DEFAULT_BUTTONS.slice() };
      const buttons = raw.buttons
        .filter((b) => b && typeof b.id === 'string' && typeof b.label === 'string' && typeof b.prompt === 'string')
        .map((b) => ({ id: b.id, label: b.label, prompt: b.prompt, enabled: b.enabled !== false }));
      return { buttons: buttons.length ? buttons : DEFAULT_BUTTONS.slice() };
    }
    const buttonStore = makeStore(
      () => {
        try {
          const text = localStorage.getItem(LS_KEY);
          return text ? sanitizeButtons(JSON.parse(text)) : { buttons: DEFAULT_BUTTONS.slice() };
        } catch {
          return { buttons: DEFAULT_BUTTONS.slice() };
        }
      },
      (next) => localStorage.setItem(LS_KEY, JSON.stringify(next))
    );

    // ============================================================
    // ② 提醒音引擎
    // ============================================================
    const ALERT_KEY = 'dsh-prompt-buttons.alerts.v1';
    const ALERT_KINDS = ['approval', 'question', 'done', 'failed'];
    const ALERT_DEFAULTS = {
      volume: 0.7,
      scope: 'all', // 'all' | 'current'
      repeatMs: 20000, // 0 = 关；审批/提问挂着时按此间隔再响
      types: {
        approval: { enabled: true, sound: 'alarm' },
        question: { enabled: true, sound: 'tap' },
        done: { enabled: true, sound: 'ding' },
        failed: { enabled: true, sound: 'fault' },
      },
    };
    const ALERT_SOUNDS = ['ding', 'tap', 'alarm', 'fault', 'none'];
    // 音色数据（波形/频率）来自 @machine-126/dsh-alert-sound（MIT）。
    const PATTERNS = {
      ding: { notes: [{ at: 0, f: 523.25, d: 0.18, t: 'sine', g: 0.8 }, { at: 0.15, f: 783.99, d: 0.35, t: 'sine', g: 0.8 }] },
      fault: { notes: [{ at: 0, f: 196, d: 0.2, t: 'sawtooth', g: 0.35 }, { at: 0.18, f: 130.81, d: 0.4, t: 'sawtooth', g: 0.35 }] },
      tap: { notes: [{ at: 0, f: 1046.5, d: 0.07, t: 'triangle', g: 0.7 }, { at: 0.1, f: 1046.5, d: 0.07, t: 'triangle', g: 0.7 }] },
      alarm: { notes: [{ at: 0, f: 880, d: 0.1, t: 'square', g: 0.3 }, { at: 0.16, f: 1174.66, d: 0.12, t: 'square', g: 0.3 }, { at: 0.34, f: 1567.98, d: 0.22, t: 'square', g: 0.3 }] },
    };

    function sanitizeAlerts(raw) {
      const base = JSON.parse(JSON.stringify(ALERT_DEFAULTS));
      if (!raw || typeof raw !== 'object') return base;
      if (typeof raw.volume === 'number') base.volume = Math.min(2, Math.max(0, raw.volume));
      if (raw.scope === 'all' || raw.scope === 'current') base.scope = raw.scope;
      if (typeof raw.repeatMs === 'number') base.repeatMs = [0, 10000, 20000, 30000].includes(raw.repeatMs) ? raw.repeatMs : 20000;
      if (raw.types && typeof raw.types === 'object') {
        for (const kind of ALERT_KINDS) {
          const row = raw.types[kind];
          if (!row || typeof row !== 'object') continue;
          base.types[kind].enabled = row.enabled !== false;
          if (ALERT_SOUNDS.includes(row.sound)) base.types[kind].sound = row.sound;
        }
      }
      return base;
    }
    // 一次性迁移 dsh-alert-sound 的配置（它已被本插件吸收）。
    function migrateLegacy() {
      try {
        const raw = localStorage.getItem('dsh-alert-sound.v1');
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (!p || typeof p !== 'object') return null;
        const mapped = { volume: p.volume, scope: p.scope, repeatMs: p.repeatMs, types: {} };
        for (const kind of ALERT_KINDS) {
          const row = p.types && p.types[kind];
          if (!row) continue;
          mapped.types[kind] = {
            enabled: row.enabled,
            sound: ALERT_SOUNDS.includes(row.sound) ? row.sound : ALERT_DEFAULTS.types[kind].sound,
          };
        }
        return sanitizeAlerts(mapped);
      } catch {
        return null;
      }
    }
    const alertStore = makeStore(
      () => {
        try {
          const text = localStorage.getItem(ALERT_KEY);
          if (text) return sanitizeAlerts(JSON.parse(text));
        } catch { /* fall through */ }
        return migrateLegacy() || JSON.parse(JSON.stringify(ALERT_DEFAULTS));
      },
      (next) => localStorage.setItem(ALERT_KEY, JSON.stringify(next))
    );

    // ---- 音频播放（AudioContext + 串行队列 + 预热 + resume 处理）----
    let audioCtx = null;
    let master = null;
    function ensureCtx() {
      if (typeof window === 'undefined') return null;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!audioCtx) {
        try {
          audioCtx = new AC();
          master = audioCtx.createGain();
          master.connect(audioCtx.destination);
        } catch {
          return null;
        }
      }
      if (audioCtx.state === 'suspended') {
        try { audioCtx.resume(); } catch { /* ignore */ }
      }
      return audioCtx;
    }
    const playQueue = [];
    let playingNow = false;
    function enqueuePlay(start) {
      playQueue.push(start);
      if (playQueue.length > 8) playQueue.shift();
      drainPlay();
    }
    function drainPlay() {
      if (playingNow) return;
      const start = playQueue.shift();
      if (!start) return;
      playingNow = true;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        playingNow = false;
        drainPlay();
      };
      try { start(release); } catch { release(); }
    }
    function patternMs(pattern) {
      let end = 0;
      for (const n of pattern.notes) end = Math.max(end, n.at + n.d + 0.06);
      return end * 1000;
    }
    function schedulePatternNow(pattern, done) {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (done) done();
      };
      const ac = ensureCtx();
      if (!ac || !master) { finish(); return; }
      let fired = false;
      const schedule = () => {
        if (fired) return;
        fired = true;
        if (!audioCtx || audioCtx !== ac || !master) { finish(); return; }
        const vol = Math.min(2, Math.max(0, alertStore.get().volume));
        const base = ac.currentTime + 0.06;
        const warmup = 0.2;
        master.gain.setValueAtTime(vol, base);
        try {
          const wg = ac.createGain();
          wg.gain.value = 0;
          const wo = ac.createOscillator();
          wo.frequency.value = 440;
          wo.connect(wg);
          wg.connect(master);
          wo.start(base);
          wo.stop(base + warmup);
        } catch { /* ignore */ }
        const start = base + warmup;
        for (const n of pattern.notes) {
          const osc = ac.createOscillator();
          const g = ac.createGain();
          osc.type = n.t;
          osc.frequency.value = n.f;
          const at = start + n.at;
          g.gain.setValueAtTime(0, at);
          g.gain.linearRampToValueAtTime(n.g, at + 0.01);
          g.gain.exponentialRampToValueAtTime(0.001, at + n.d);
          osc.connect(g);
          g.connect(master);
          osc.start(at);
          osc.stop(at + n.d + 0.05);
        }
        if (!window.setTimeout(finish, warmup * 1000 + patternMs(pattern) + 80)) finish();
      };
      if (ac.state === 'running') schedule();
      else {
        try { ac.resume().then(schedule, schedule); } catch { schedule(); }
        window.setTimeout(() => {
          if (!fired) { fired = true; finish(); }
        }, 1200);
      }
    }
    function playPattern(sound) {
      const pattern = PATTERNS[sound];
      if (!pattern) return;
      enqueuePlay((release) => schedulePatternNow(pattern, release));
    }
    function playKind(kind) {
      const cfg = alertStore.get().types[kind];
      if (!cfg || !cfg.enabled || cfg.sound === 'none') return;
      playPattern(cfg.sound);
    }

    // ---- 事件检测（在 apply 中启动；适配 DSH 0.2.0-rc.2 的 uiSession.sessionStatus 面）----
    function startAlerts(ctx) {
      const ownTimeout = (fn, ms) => {
        let dispose = () => {};
        try {
          dispose = ctx.effect(() => {
            const id = window.setTimeout(() => {
              try { dispose(); } catch { /* ignore */ }
              fn();
            }, ms);
            return () => { try { window.clearTimeout(id); } catch { /* ignore */ } };
          });
        } catch {
          return () => {};
        }
        return dispose;
      };
      const ownInterval = (fn, ms) => {
        try {
          return ctx.effect(() => {
            const id = window.setInterval(fn, ms);
            return () => { try { window.clearInterval(id); } catch { /* ignore */ } };
          });
        } catch {
          return () => {};
        }
      };

      const prev = new Map();
      const runs = new Map();
      const settling = new Set();
      const lastFire = new Map();
      function shouldFire(id, kind) {
        const now = Date.now();
        const last = lastFire.get(id);
        if (last && last.kind === kind && now - last.at < 1500) return false;
        lastFire.set(id, { kind, at: now });
        return true;
      }
      function statusOf(id) {
        const ui = ctx.get('uiSession');
        if (!ui || !ui.sessionStatus) return undefined;
        try {
          const m = ui.sessionStatus.getSnapshot();
          return m ? m.get(id) : undefined;
        } catch {
          return undefined;
        }
      }
      function pendingOf(id) {
        const st = statusOf(id);
        return st ? st.pendingInteraction : undefined;
      }
      function pendingKindOf(id) {
        const p = pendingOf(id);
        if (!p || typeof p.kind !== 'string') return undefined;
        return p.kind === 'approval' ? 'approval' : 'question';
      }
      function runningOf(id, fallback) {
        const st = statusOf(id);
        return st && typeof st.running === 'boolean' ? st.running : !!fallback;
      }
      function isCurrentSession(row) {
        return !!(row && row.retainedBy && (row.retainedBy.mainView || 0) > 0);
      }
      function detailOf(id) {
        const s = ctx.get('sessions');
        try {
          const b = s && s.binding && s.binding(id);
          return b && b.session ? b.session.getSnapshot() || null : null;
        } catch {
          return null;
        }
      }
      function seed(list) {
        const byId = (list && list.byId) || {};
        for (const id of Object.keys(byId)) {
          const s = byId[id] || {};
          prev.set(id, { running: runningOf(id, s.running), pending: pendingKindOf(id) });
        }
      }
      function reseedPending(list) {
        const byId = (list && list.byId) || {};
        for (const id of Object.keys(byId)) {
          const p = prev.get(id);
          if (p) p.pending = pendingKindOf(id);
        }
      }
      function armRun(id) {
        const snap = detailOf(id);
        runs.set(id, { agentErr: snap ? snap.lastAgentError || null : null });
      }
      function settleRun(id) {
        const run = runs.get(id);
        if (!run || settling.has(id)) return;
        runs.delete(id);
        settling.add(id);
        ownTimeout(() => {
          if (runs.has(id)) { settling.delete(id); return; }
          try {
            const snap = detailOf(id);
            const failed = !!(snap && snap.lastAgentError != null && snap.lastAgentError !== run.agentErr);
            const kind = failed ? 'failed' : 'done';
            if (shouldFire(id, kind)) {
              playKind(kind);
              if (kind === 'failed') startRepeat(id, 'failed', 3);
            }
          } finally {
            settling.delete(id);
          }
        }, 250);
      }
      const repeatTimers = new Map();
      function stopRepeat(id) {
        const rec = repeatTimers.get(id);
        if (rec) { rec.disposer(); repeatTimers.delete(id); }
      }
      function startRepeat(id, kind, limit) {
        const existing = repeatTimers.get(id);
        if (existing) {
          if (existing.kind === kind) return;
          stopRepeat(id);
        }
        const rawMs = alertStore.get().repeatMs || 0;
        if (rawMs <= 0) return;
        const intervalMs = Math.max(3000, rawMs);
        const rec = { disposer: null, kind, count: 0, limit };
        const tick = () => {
          const pend = pendingKindOf(id);
          if (kind === 'approval' || kind === 'question') {
            if (pend !== kind) { stopRepeat(id); return; }
          } else {
            rec.count += 1;
            if (rec.count >= rec.limit) { stopRepeat(id); return; }
          }
          playKind(kind);
        };
        rec.disposer = ownInterval(tick, intervalMs);
        repeatTimers.set(id, rec);
      }
      function observe(list) {
        const byId = (list && list.byId) || {};
        const scope = alertStore.get().scope || 'all';
        for (const id of Object.keys(byId)) {
          const s = byId[id] || {};
          const running = runningOf(id, s.running);
          const pending = pendingKindOf(id);
          const p = prev.get(id);
          if (p && (scope !== 'current' || isCurrentSession(s))) {
            if (pending !== p.pending) {
              if (pending === 'approval') {
                if (shouldFire(id, 'approval')) { playKind('approval'); startRepeat(id, 'approval', Infinity); }
              } else if (pending === 'question') {
                if (shouldFire(id, 'question')) { playKind('question'); startRepeat(id, 'question', Infinity); }
              } else {
                stopRepeat(id);
              }
            }
            if (p.running && !running) settleRun(id);
            else if (!p.running && running) armRun(id);
          }
          prev.set(id, { running, pending });
        }
        for (const id2 of prev.keys()) {
          if (!Object.prototype.hasOwnProperty.call(byId, id2)) {
            prev.delete(id2);
            runs.delete(id2);
            settling.delete(id2);
            stopRepeat(id2);
          }
        }
      }

      ctx.inject(['sessions'], (scope) => {
        scope.effect(() => {
          const sessions = scope.get('sessions');
          if (!sessions || !sessions.list) return () => {};
          const list = sessions.list;
          seed(list.getSnapshot());
          return list.subscribe(() => observe(list.getSnapshot()));
        });
      });
      ctx.inject(['uiSession'], (scope) => {
        scope.effect(() => {
          const ui = scope.get('uiSession');
          if (!ui || !ui.sessionStatus || !ui.sessionStatus.subscribe) return () => {};
          const sessions0 = scope.get('sessions');
          const list0 = sessions0 && sessions0.list;
          if (list0) reseedPending(list0.getSnapshot());
          return ui.sessionStatus.subscribe(() => {
            const sessions = scope.get('sessions');
            const list = sessions && sessions.list;
            if (list) observe(list.getSnapshot());
          });
        });
      });
    }

    // ============================================================
    // ③ 文案
    // ============================================================
    const zh = {
      nav: '插件设置',
      tabButtons: '提示词按钮',
      tabSound: '提醒音',
      colEnabled: '启用',
      colLabel: '按钮名',
      colPrompt: '注入的提示词',
      colActions: '操作',
      addButton: '＋ 新增按钮',
      resetDefaults: '恢复默认',
      deleteRow: '删除',
      newButtonLabel: '新按钮',
      newButtonPrompt: '[在此填写要注入的提示词]',
      armedHint: '点击按钮：提示词换行追加到输入框末尾（可见可改）；再点一次移除；发送后自动取消选中。',
      soundTitle: '提醒音设置',
      masterVolume: '总音量',
      repeat: '重复提醒',
      repeatOff: '关',
      repeat10: '每 10 秒',
      repeat20: '每 20 秒',
      repeat30: '每 30 秒',
      repeatHint: '审批/提问未处理时按此间隔再响，直到处理',
      scope: '提醒范围',
      scopeAll: '所有会话',
      scopeCurrent: '仅当前会话',
      typeApproval: '需要审批',
      typeQuestion: '需要回答',
      typeDone: '输出完成',
      typeFailed: '发生错误',
      soundDing: '叮咚',
      soundTap: '轻点',
      soundAlarm: '警醒',
      soundFault: '低沉',
      soundNone: '静音',
      preview: '试听',
      colType: '类型',
      colSound: '音色',
      colPreview: '试听',
      resetSound: '恢复默认',
      soundHint: '提醒音引擎由本插件内置（原 dsh-alert-sound 已吸收），改动即时生效。',
      enabled: '开',
      disabled: '关',
    };
    const en = {
      nav: 'Plugin Settings',
      tabButtons: 'Prompt Buttons',
      tabSound: 'Alert Sound',
      colEnabled: 'On',
      colLabel: 'Label',
      colPrompt: 'Injected prompt',
      colActions: 'Actions',
      addButton: '+ Add button',
      resetDefaults: 'Reset defaults',
      deleteRow: 'Delete',
      newButtonLabel: 'New button',
      newButtonPrompt: '[prompt to inject]',
      armedHint: 'Armed: the next message you send gets this prompt appended, then the selection clears.',
      soundTitle: 'Alert Sound Settings',
      masterVolume: 'Master volume',
      repeat: 'Repeat',
      repeatOff: 'Off',
      repeat10: 'Every 10s',
      repeat20: 'Every 20s',
      repeat30: 'Every 30s',
      repeatHint: 'Re-ring unanswered approvals/questions at this interval',
      scope: 'Scope',
      scopeAll: 'All sessions',
      scopeCurrent: 'Current session only',
      typeApproval: 'Needs approval',
      typeQuestion: 'Needs answer',
      typeDone: 'Output complete',
      typeFailed: 'Error',
      soundDing: 'Ding-dong',
      soundTap: 'Tap',
      soundAlarm: 'Alert',
      soundFault: 'Low',
      soundNone: 'Mute',
      preview: 'Play',
      colType: 'Type',
      colSound: 'Sound',
      colPreview: 'Preview',
      resetSound: 'Reset defaults',
      soundHint: 'The alert engine is built into this plugin (dsh-alert-sound absorbed); changes apply instantly.',
      enabled: 'on',
      disabled: 'off',
    };
    let t = (key) => zh[key] || key;

    // ============================================================
    // 样式（只用主题 token）
    // ============================================================
    const styles = {
      bar: { display: 'flex', alignItems: 'center', gap: 4 },
      btn: (active) => ({
        font: 'inherit',
        fontSize: 12,
        lineHeight: '20px',
        height: 22,
        padding: '0 8px',
        borderRadius: 'var(--dsw-radius-xs, 6px)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        border: '1px solid ' + (active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)'),
        background: active ? 'var(--dsw-alias-brand-primary)' : 'transparent',
        color: active ? 'var(--dsw-alias-bg-base)' : 'var(--dsw-alias-label-secondary)',
      }),
      page: { padding: '0 20px 24px', color: 'var(--dsw-alias-label-primary)', maxWidth: 760 },
      tabs: { display: 'flex', gap: 4, borderBottom: '1px solid var(--dsw-alias-border-l1)', marginBottom: 16 },
      tab: (active) => ({
        font: 'inherit',
        fontSize: 13,
        padding: '8px 12px',
        cursor: 'pointer',
        border: 'none',
        background: 'transparent',
        color: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
        borderBottom: '2px solid ' + (active ? 'var(--dsw-alias-brand-primary)' : 'transparent'),
        marginBottom: -1,
      }),
      table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
      th: { textAlign: 'left', padding: '6px 8px', color: 'var(--dsw-alias-label-secondary)', fontWeight: 500, borderBottom: '1px solid var(--dsw-alias-border-l1)' },
      td: { padding: '8px', borderBottom: '1px solid var(--dsw-alias-border-l1)', verticalAlign: 'middle' },
      input: {
        font: 'inherit',
        fontSize: 13,
        width: '100%',
        boxSizing: 'border-box',
        padding: '4px 8px',
        borderRadius: 'var(--dsw-radius-xs, 6px)',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
      },
      textarea: {
        font: 'inherit',
        fontSize: 13,
        width: '100%',
        boxSizing: 'border-box',
        padding: '4px 8px',
        borderRadius: 'var(--dsw-radius-xs, 6px)',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        resize: 'vertical',
        minHeight: 44,
      },
      select: {
        font: 'inherit',
        fontSize: 13,
        padding: '4px 8px',
        borderRadius: 'var(--dsw-radius-xs, 6px)',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
      },
      smallBtn: {
        font: 'inherit',
        fontSize: 12,
        padding: '4px 10px',
        borderRadius: 'var(--dsw-radius-xs, 6px)',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
      },
      dangerBtn: {
        font: 'inherit',
        fontSize: 12,
        padding: '4px 10px',
        borderRadius: 'var(--dsw-radius-xs, 6px)',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-state-error-primary)',
        cursor: 'pointer',
      },
      hint: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 12 },
      row: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' },
      label: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)', minWidth: 64 },
    };

    // ============================================================
    // 组件：① 输入框工具条按钮（点击 = 提示词换行追加到草稿；再点 = 移除；发送后自动取消选中）
    // ============================================================
    function PromptButtonsBar(props) {
      const cfg = useSyncExternalStore(buttonStore.subscribe, buttonStore.get);
      const [armedId, setArmedId] = useState(null);
      const phase = props.useInput ? props.useInput((s) => s && s.phase) : undefined;
      const draft = props.useInput ? props.useInput((s) => (s && typeof s.draft === 'string' ? s.draft : '')) : '';
      const draftRef = useRef(draft);
      draftRef.current = draft;
      const prevPhase = useRef(phase);

      // 一次性：普通消息提交走 plain → adjudicating（不会进 submitting，那是斜杠命令专用），
      // 因此以"离开 plain 阶段"为发送开始的信号清除选择态。
      useEffect(() => {
        const prev = prevPhase.current;
        prevPhase.current = phase;
        if (armedId && prev === 'plain' && phase && phase !== 'plain') setArmedId(null);
      }, [phase, armedId]);

      if (!props.sessionId || !props.inputActions) return null;
      const buttons = cfg.buttons.filter((b) => b.enabled && b.label && b.prompt);
      if (!buttons.length) return null;
      const armedButton = buttons.find((b) => b.id === armedId);

      // 用户手动把追加的提示词删掉/改掉了 → 同步取消选中
      if (armedButton && !draft.includes(armedButton.prompt)) {
        setArmedId(null);
      }

      const arm = (b) => {
        const d = draftRef.current;
        const sep = d.trim() ? '\n' : '';
        props.inputActions.setDraft(d + sep + b.prompt);
        setArmedId(b.id);
      };
      const disarm = (b) => {
        const d = draftRef.current;
        if (d.endsWith(b.prompt)) {
          let next = d.slice(0, d.length - b.prompt.length);
          if (next.endsWith('\n')) next = next.slice(0, -1);
          props.inputActions.setDraft(next);
        }
        setArmedId(null);
      };
      const toggle = (b) => {
        if (armedId === b.id) {
          disarm(b);
          return;
        }
        if (armedButton) disarm(armedButton);
        arm(b);
      };

      return h(
        'div',
        { style: styles.bar },
        buttons.map((b) =>
          h(
            'button',
            {
              key: b.id,
              type: 'button',
              title: b.prompt,
              'aria-pressed': armedId === b.id,
              onClick: () => toggle(b),
              style: styles.btn(armedId === b.id),
            },
            b.label
          )
        ),
        armedButton ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-brand-primary)', marginLeft: 2 } }, '✦') : null
      );
    }

    // ============================================================
    // 组件：③a 提示词按钮编辑
    // ============================================================
    function ButtonsEditor() {
      const cfg = useSyncExternalStore(buttonStore.subscribe, buttonStore.get);
      const setButtons = (buttons) => buttonStore.set({ buttons });
      const patchRow = (id, patch) =>
        setButtons(cfg.buttons.map((b) => (b.id === id ? { ...b, ...patch } : b)));
      const removeRow = (id) => setButtons(cfg.buttons.filter((b) => b.id !== id));
      const addRow = () =>
        setButtons(
          cfg.buttons.concat([
            { id: 'b' + Date.now().toString(36), label: t('newButtonLabel'), prompt: t('newButtonPrompt'), enabled: true },
          ])
        );

      return h(
        'div',
        null,
        h(
          'table',
          { style: styles.table },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', { style: { ...styles.th, width: 48 } }, t('colEnabled')),
              h('th', { style: { ...styles.th, width: 140 } }, t('colLabel')),
              h('th', { style: styles.th }, t('colPrompt')),
              h('th', { style: { ...styles.th, width: 72 } }, t('colActions'))
            )
          ),
          h(
            'tbody',
            null,
            cfg.buttons.map((b) =>
              h(
                'tr',
                { key: b.id },
                h(
                  'td',
                  { style: styles.td },
                  h('input', {
                    type: 'checkbox',
                    role: 'switch',
                    'aria-checked': b.enabled,
                    checked: b.enabled,
                    onChange: (e) => patchRow(b.id, { enabled: e.target.checked }),
                  })
                ),
                h(
                  'td',
                  { style: styles.td },
                  h('input', {
                    style: styles.input,
                    value: b.label,
                    maxLength: 12,
                    onChange: (e) => patchRow(b.id, { label: e.target.value }),
                  })
                ),
                h(
                  'td',
                  { style: styles.td },
                  h('textarea', {
                    style: styles.textarea,
                    value: b.prompt,
                    onChange: (e) => patchRow(b.id, { prompt: e.target.value }),
                  })
                ),
                h(
                  'td',
                  { style: styles.td },
                  h('button', { type: 'button', style: styles.dangerBtn, onClick: () => removeRow(b.id) }, t('deleteRow'))
                )
              )
            )
          )
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 8, marginTop: 12 } },
          h('button', { type: 'button', style: styles.smallBtn, onClick: addRow }, t('addButton')),
          h(
            'button',
            { type: 'button', style: styles.smallBtn, onClick: () => setButtons(DEFAULT_BUTTONS.slice()) },
            t('resetDefaults')
          )
        ),
        h('div', { style: styles.hint }, t('armedHint'))
      );
    }

    // ============================================================
    // 组件：③b 提醒音设置（本插件自有引擎，改动即时生效）
    // ============================================================
    const SOUND_LABEL = { ding: 'soundDing', tap: 'soundTap', alarm: 'soundAlarm', fault: 'soundFault', none: 'soundNone' };
    const KIND_LABEL = { approval: 'typeApproval', question: 'typeQuestion', done: 'typeDone', failed: 'typeFailed' };

    function AlertSoundPanel() {
      const cfg = useSyncExternalStore(alertStore.subscribe, alertStore.get);
      const patch = (p) => alertStore.set({ ...cfg, ...p });
      const patchType = (kind, p) =>
        alertStore.set({ ...cfg, types: { ...cfg.types, [kind]: { ...cfg.types[kind], ...p } } });

      return h(
        'div',
        null,
        h('div', { style: { fontSize: 14, fontWeight: 600, marginBottom: 8 } }, t('soundTitle')),
        h(
          'table',
          { style: styles.table },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', { style: styles.th }, t('colType')),
              h('th', { style: { ...styles.th, width: 56 } }, t('colEnabled')),
              h('th', { style: { ...styles.th, width: 120 } }, t('colSound')),
              h('th', { style: { ...styles.th, width: 72 } }, t('colPreview'))
            )
          ),
          h(
            'tbody',
            null,
            ALERT_KINDS.map((kind) =>
              h(
                'tr',
                { key: kind },
                h('td', { style: styles.td }, t(KIND_LABEL[kind])),
                h(
                  'td',
                  { style: styles.td },
                  h('input', {
                    type: 'checkbox',
                    role: 'switch',
                    'aria-checked': cfg.types[kind].enabled,
                    checked: cfg.types[kind].enabled,
                    onChange: (e) => patchType(kind, { enabled: e.target.checked }),
                  })
                ),
                h(
                  'td',
                  { style: styles.td },
                  h(
                    'select',
                    {
                      style: styles.select,
                      value: cfg.types[kind].sound,
                      onChange: (e) => patchType(kind, { sound: e.target.value }),
                    },
                    ALERT_SOUNDS.map((s) => h('option', { key: s, value: s }, t(SOUND_LABEL[s])))
                  )
                ),
                h(
                  'td',
                  { style: styles.td },
                  h(
                    'button',
                    {
                      type: 'button',
                      style: styles.smallBtn,
                      onClick: () => {
                        const sound = alertStore.get().types[kind].sound;
                        if (sound !== 'none') playPattern(sound);
                      },
                    },
                    t('preview')
                  )
                )
              )
            )
          )
        ),
        h(
          'div',
          { style: styles.row },
          h('span', { style: styles.label }, t('masterVolume')),
          h('input', {
            type: 'range',
            min: 0,
            max: 100,
            value: Math.round(cfg.volume * 100),
            onChange: (e) => patch({ volume: Number(e.target.value) / 100 }),
            style: { flex: 1, maxWidth: 240 },
          }),
          h('span', { style: { fontSize: 12, minWidth: 36 } }, Math.round(cfg.volume * 100) + '%')
        ),
        h(
          'div',
          { style: styles.row },
          h('span', { style: styles.label }, t('repeat')),
          h(
            'select',
            {
              style: styles.select,
              value: cfg.repeatMs,
              onChange: (e) => patch({ repeatMs: Number(e.target.value) }),
            },
            h('option', { value: 0 }, t('repeatOff')),
            h('option', { value: 10000 }, t('repeat10')),
            h('option', { value: 20000 }, t('repeat20')),
            h('option', { value: 30000 }, t('repeat30'))
          ),
          h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('repeatHint'))
        ),
        h(
          'div',
          { style: styles.row },
          h('span', { style: styles.label }, t('scope')),
          h(
            'select',
            {
              style: styles.select,
              value: cfg.scope,
              onChange: (e) => patch({ scope: e.target.value }),
            },
            h('option', { value: 'all' }, t('scopeAll')),
            h('option', { value: 'current' }, t('scopeCurrent'))
          )
        ),
        h(
          'div',
          { style: { marginTop: 16 } },
          h(
            'button',
            {
              type: 'button',
              style: styles.smallBtn,
              onClick: () => alertStore.set(JSON.parse(JSON.stringify(ALERT_DEFAULTS))),
            },
            t('resetSound')
          )
        ),
        h('div', { style: styles.hint }, t('soundHint'))
      );
    }

    // ============================================================
    // 组件：③ 插件设置页（二级标签）
    // ============================================================
    function PluginSettingsPage() {
      useSyncExternalStore(buttonStore.subscribe, buttonStore.get);
      const [tab, setTab] = useState('buttons');
      return h(
        'div',
        { style: styles.page },
        h(
          'div',
          { style: styles.tabs },
          h('button', { type: 'button', style: styles.tab(tab === 'buttons'), onClick: () => setTab('buttons') }, t('tabButtons')),
          h('button', { type: 'button', style: styles.tab(tab === 'sound'), onClick: () => setTab('sound') }, t('tabSound'))
        ),
        tab === 'buttons' ? h(ButtonsEditor) : h(AlertSoundPanel)
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        if (ctx.locale) {
          ctx.locale.register('dsh-prompt-buttons', 'zh', zh);
          ctx.locale.register('dsh-prompt-buttons', 'en', en);
          t = ctx.locale.bind('dsh-prompt-buttons');
          ctx.locale.subscribe(() => {
            buttonStore.notify();
            alertStore.notify();
          });
        }
        // 跨标签页配置同步
        const onStorage = (e) => {
          if (!e || !e.key) {
            buttonStore.reload();
            alertStore.reload();
            return;
          }
          if (e.key === LS_KEY) buttonStore.reload();
          if (e.key === ALERT_KEY) alertStore.reload();
        };
        window.addEventListener('storage', onStorage);
        ctx.effect(() => () => window.removeEventListener('storage', onStorage));

        // 启动提醒音引擎
        startAlerts(ctx);

        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            { name: 'conversation.input.left', id: 'prompt-buttons', order: 40, label: () => t('tabButtons') },
            PromptButtonsBar
          )
        );
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'plugin-settings', order: 44, label: () => t('nav') },
            PluginSettingsPage
          )
        );
      },
    };
  },
});
