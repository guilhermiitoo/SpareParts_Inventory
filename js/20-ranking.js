// ==========================================================================
// SPARE PARTS - 20-ranking.js (extraido do v16.32)
// ==========================================================================

// ============================================================
// MODULO: MEU RENDIMENTO (visao do proprio operador)
// ============================================================
// ============================================================
//  WEEKLY STATS (v16.28) — consolidado semanal do Ranking
// ------------------------------------------------------------
//  O historico (checkoutHistory) continua sendo purgado em 7 dias
//  para manter o JSON leve. Este modulo grava, POR SEMANA, APENAS
//  OS NUMEROS de cada funcionario (devolucoes, buscas, listas,
//  materiais e pontos). Nada de material, locacao, W/O ou listas.
//
//  Semana = de SEGUNDA 00:00 ate a SEGUNDA seguinte 00:00.
//  Retencao: 45 dias (semanas mais antigas sao descartadas).
//
//  Consolidacao: a cada gravacao do JSON e a cada abertura da aba
//  Ranking, recalcula as semanas cobertas pelo historico vivo e
//  faz merge por MAIOR VALOR — assim, quando o historico expira,
//  o numero ja consolidado permanece intacto.
// ============================================================
const WeeklyStats = {
    RETENTION_DAYS: 45,

    // Segunda-feira 00:00 da semana em que o timestamp cai
    weekStart(ts) {
        const d = new Date(ts);
        d.setHours(0, 0, 0, 0);
        const dow = d.getDay();               // 0=Dom, 1=Seg ...
        const back = (dow === 0) ? 6 : dow - 1;
        d.setDate(d.getDate() - back);
        return d.getTime();
    },

    weekEnd(startTs) { return startTs + 7 * 86400 * 1000; },

    key(ts) {
        const d = new Date(WeeklyStats.weekStart(ts));
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    },

    label(startTs) {
        const a = new Date(startTs);
        const b = new Date(WeeklyStats.weekEnd(startTs) - 86400 * 1000);
        const f = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        return f(a) + ' a ' + f(b) + '/' + b.getFullYear();
    },

    // Recalcula as semanas presentes no historico vivo e consolida
    sync() {
        if (!State.weeklyStats) State.weeklyStats = {};
        const hist = (State.checkoutHistory || []).filter(h =>
            h && h.timestamp && ['RETURN', 'MANUAL_KITTING', 'CHECKOUT'].includes(h.type));
        if (!hist.length) { WeeklyStats.prune(); return; }

        // Agrupa por semana -> matricula
        const calc = {};
        hist.forEach(h => {
            const k = WeeklyStats.key(h.timestamp);
            const mat = String(h.matricula || '--');
            calc[k] = calc[k] || {};
            const u = calc[k][mat] = calc[k][mat] || { d: 0, b: 0, l: 0, m: 0 };
            if (h.type === 'RETURN')         u.d++;
            if (h.type === 'MANUAL_KITTING') u.b++;
            if (h.type === 'CHECKOUT') {
                u.l++;
                u.m += (h.removedItems?.length) || (h._itemCount || 0);
            }
        });

        Object.keys(calc).forEach(k => {
            const startTs = WeeklyStats.weekStart(new Date(k + 'T12:00:00').getTime());
            const wk = State.weeklyStats[k] = State.weeklyStats[k] ||
                       { s: startTs, e: WeeklyStats.weekEnd(startTs), u: {} };
            wk.s = startTs; wk.e = WeeklyStats.weekEnd(startTs);
            Object.keys(calc[k]).forEach(mat => {
                const novo = calc[k][mat];
                const old  = wk.u[mat] || { d: 0, b: 0, l: 0, m: 0 };
                const user = (State.users || []).find(x => String(x.matricula) === mat);
                // Merge por MAIOR valor: o consolidado nunca regride
                wk.u[mat] = {
                    n: (user && user.nome) || old.n || mat,
                    d: Math.max(old.d || 0, novo.d),
                    b: Math.max(old.b || 0, novo.b),
                    l: Math.max(old.l || 0, novo.l),
                    m: Math.max(old.m || 0, novo.m),
                };
                // Pontos: 1 por devolucao + 1 por busca (listas nao pontuam)
                wk.u[mat].p = wk.u[mat].d + wk.u[mat].b;
            });
        });

        WeeklyStats.prune();
    },

    // Descarta semanas com mais de 45 dias
    prune() {
        if (!State.weeklyStats) return;
        const cut = Date.now() - WeeklyStats.RETENTION_DAYS * 86400 * 1000;
        Object.keys(State.weeklyStats).forEach(k => {
            const w = State.weeklyStats[k];
            if (!w || !w.s || w.e < cut) delete State.weeklyStats[k];
        });
    },

    // Lista de semanas (mais recente primeiro)
    weeks() {
        WeeklyStats.prune();
        return Object.keys(State.weeklyStats || {})
            .map(k => ({ key: k, ...State.weeklyStats[k] }))
            .sort((a, b) => b.s - a.s);
    },

    // Linhas de uma semana, ordenadas por pontos
    rows(key) {
        const w = (State.weeklyStats || {})[key];
        if (!w) return [];
        return Object.keys(w.u || {}).map(mat => ({ mat, ...w.u[mat] }))
            .sort((a, b) => (b.p || 0) - (a.p || 0) || (b.m || 0) - (a.m || 0));
    },
};

// ============================================================
//  RANKING ENGINE — calculo centralizado (usado por Ranking e MeuRendimento)
// ============================================================
const RankingEngine = {
    WEEK_MS: 7 * 24 * 3600 * 1000,

    // v16.23: nova regra de pontuacao
    //   Devolucao ......... 1 ponto por acao
    //   Busca avulsa ...... 1 ponto por acao
    //   Lista (CHECKOUT) .. NAO pontua (apenas informativo: qtd de listas e de materiais)
    POINTS: {
        RETURN:         1,
        MANUAL_KITTING: 1,
        CHECKOUT_BASE:  0,
        CHECKOUT_ITEM:  0,
    },

    BADGES: [
        { id: 'devolvedor',  icon: '🔁', label: 'Devolvedor Fiel',  desc: '50 devoluções acumuladas',      check: (s) => s.totalReturn  >= 50 },
        { id: 'cacador',     icon: '🎯', label: 'Caçador',          desc: '10 buscas avulsas na semana',   check: (s) => s.weekBuscas   >= 10 },
        { id: 'listeiro',    icon: '📋', label: 'Listeiro',         desc: 'Primeira lista tirada',         check: (s) => s.totalListas  >= 1  },
        { id: 'veloz',       icon: '⚡', label: 'Veloz',            desc: '5 operações em 1 dia',          check: (s) => s.maxOpsDay    >= 5  },
    ],

    TIERS: [
        { pos: 1, label: 'Diamante', icon: '💎', color: '#7dd3fc', border: '#0ea5e9', bg: 'linear-gradient(135deg,#0c4a6e,#0369a1)' },
        { pos: 2, label: 'Ouro',     icon: '🥇', color: '#fde68a', border: '#f59e0b', bg: 'linear-gradient(135deg,#78350f,#d97706)' },
        { pos: 3, label: 'Prata',    icon: '🥈', color: '#e2e8f0', border: '#94a3b8', bg: 'linear-gradient(135deg,#334155,#64748b)' },
        { pos: 4, label: 'Bronze',   icon: '🥉', color: '#fed7aa', border: '#f97316', bg: 'linear-gradient(135deg,#7c2d12,#ea580c)' },
        { pos: 5, label: 'Cobre',    icon: '🏅', color: '#fca5a5', border: '#ef4444', bg: 'linear-gradient(135deg,#450a0a,#b91c1c)' },
    ],

    // Streak: bloco de 5h sem operacao quebra o streak
    _calcStreak(hist) {
        if (!hist.length) return 1;
        const sorted = [...hist].sort((a,b) => a.timestamp - b.timestamp);
        const BLOCK  = 5 * 3600 * 1000; // 5h em ms
        let streak = 1;
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].timestamp - sorted[i-1].timestamp <= BLOCK) streak++;
            else streak = 1;
        }
        // Multiplicador: cada 3 ops consecutivas = +10%, max x2.0
        const mult = Math.min(2.0, 1 + Math.floor(streak / 3) * 0.1);
        return Math.round(mult * 100) / 100;
    },

    _calcScore(hist) {
        let pts = 0;
        hist.forEach(h => {
            if (h.type === 'RETURN')         pts += RankingEngine.POINTS.RETURN;
            if (h.type === 'MANUAL_KITTING') pts += RankingEngine.POINTS.MANUAL_KITTING;
            // v16.23: listas NAO geram pontos (somente informativo)
        });
        return Math.round(pts * 100) / 100;
    },

    _maxOpsInDay(hist) {
        const byDay = {};
        hist.forEach(h => {
            const d = new Date(h.timestamp).toLocaleDateString('pt-BR');
            byDay[d] = (byDay[d] || 0) + 1;
        });
        return Math.max(0, ...Object.values(byDay));
    },

    // Retorna stats completos de um funcionario (semana atual + acumulado)
    buildStats(mat) {
        const allHist  = (State.checkoutHistory || []).filter(h => h.matricula === mat);
        const weekCut  = Date.now() - RankingEngine.WEEK_MS;
        const weekHist = allHist.filter(h => h.timestamp >= weekCut);

        const weekBuscas  = weekHist.filter(h => h.type === 'MANUAL_KITTING').length;
        const weekListas  = weekHist.filter(h => h.type === 'CHECKOUT').length;
        const weekDevolv  = weekHist.filter(h => h.type === 'RETURN').length;
        const weekOps     = weekBuscas + weekListas + weekDevolv;
        const weekPts     = RankingEngine._calcScore(weekHist);
        const streak      = RankingEngine._calcStreak(weekHist);
        const weekPtsMult = Math.round(weekPts * streak * 100) / 100;
        const maxOpsDay   = RankingEngine._maxOpsInDay(weekHist);

        const totalReturn = allHist.filter(h => h.type === 'RETURN').length;
        const totalListas = allHist.filter(h => h.type === 'CHECKOUT').length;
        // v16.23: quantidade de materiais das listas (informativo, nao pontua)
        const weekListaItens = weekHist.filter(h => h.type === 'CHECKOUT')
                                       .reduce((sum, h) => sum + ((h.removedItems?.length) || (h._itemCount || 0)), 0);

        const stats = { mat, weekBuscas, weekListas, weekListaItens, weekDevolv, weekOps, weekPts, streak, weekPtsMult, maxOpsDay, totalReturn, totalListas };

        stats.badges = RankingEngine.BADGES.filter(b => b.check(stats));
        return stats;
    },

    // Constroi ranking global — so quem operou na semana
    buildAllRanking() {
        const weekCut  = Date.now() - RankingEngine.WEEK_MS;
        const active   = new Set((State.checkoutHistory || []).filter(h => h.timestamp >= weekCut && ['RETURN','MANUAL_KITTING','CHECKOUT'].includes(h.type)).map(h => h.matricula));
        const users    = (State.users || []).filter(u => active.has(u.matricula));

        return users.map(u => {
            const s = RankingEngine.buildStats(u.matricula);
            s.nome = u.nome;
            return s;
        }).sort((a,b) => b.weekPtsMult - a.weekPtsMult);
    },

    getTier(pos) {
        return RankingEngine.TIERS.find(t => t.pos === pos) ||
               { pos, label: 'Cobre', icon: '🏅', color: '#fca5a5', border: '#ef4444', bg: '#1c0202' };
    },

    badgesHTML(badges, size) {
        if (!badges.length) return '<span style="color:#cbd5e1;font-size:0.72rem;">Nenhuma ainda</span>';
        return badges.map(b =>
            `<span title="${b.label} — ${b.desc}" style="font-size:${size || '1.1rem'};cursor:default;">${b.icon}</span>`
        ).join(' ');
    },
};

// ============================================================
//  RANKING
// ============================================================
const Ranking = {
    // Armazena posicoes da semana ANTERIOR para seta ↑↓
    // Chave: matricula -> posicao (calculado uma vez por sessao)
    _prevPositions: null,

    _getPrevPositions() {
        // Usa a janela 7-14 dias atras como "semana passada"
        if (Ranking._prevPositions) return Ranking._prevPositions;
        const now   = Date.now();
        const cut1  = now - RankingEngine.WEEK_MS;
        const cut2  = now - 2 * RankingEngine.WEEK_MS;
        const allH  = State.checkoutHistory || [];
        const prevH = allH.filter(h => h.timestamp >= cut2 && h.timestamp < cut1 && ['RETURN','MANUAL_KITTING','CHECKOUT'].includes(h.type));
        const active = new Set(prevH.map(h => h.matricula));
        const users  = (State.users || []).filter(u => active.has(u.matricula));
        const sorted = users.map(u => {
            const hist = prevH.filter(h => h.matricula === u.matricula);
            const pts  = RankingEngine._calcScore(hist);
            return { mat: u.matricula, pts };
        }).sort((a,b) => b.pts - a.pts);
        Ranking._prevPositions = {};
        sorted.forEach((u, i) => { Ranking._prevPositions[u.mat] = i + 1; });
        return Ranking._prevPositions;
    },

    _arrowHTML(mat, curPos) {
        const prev = Ranking._getPrevPositions()[mat];
        if (!prev) return '';
        if (prev > curPos)  return '<span title="Subiu no ranking" style="color:#10b981;font-size:0.85rem;margin-left:4px;">↑</span>';
        if (prev < curPos)  return '<span title="Caiu no ranking"  style="color:#ef4444;font-size:0.85rem;margin-left:4px;">↓</span>';
        return '<span title="Mesma posicao" style="color:#94a3b8;font-size:0.8rem;margin-left:4px;">—</span>';
    },

    _moveOf(mat, curPos) {
        const prev = Ranking._getPrevPositions()[mat];
        if (!prev)          return 'same';
        if (prev > curPos)  return 'up';
        if (prev < curPos)  return 'down';
        return 'same';
    },
    _injectCSS() {
        if (document.getElementById('rkStyle')) return;
        const css = `
        #rankingContent .rk-wrap{max-width:1180px;margin:0 auto;font-family:'Roboto',sans-serif;color:#1e293b;}
        @keyframes rk-riseIn{from{opacity:0;transform:translateY(28px) scale(.96);}to{opacity:1;transform:none;}}
        @keyframes rk-rowIn{from{opacity:0;transform:translateX(-14px);}to{opacity:1;transform:none;}}
        @keyframes rk-glowPulse{0%,100%{box-shadow:0 0 0 2px rgba(0,102,161,.35),0 0 30px rgba(0,102,161,.30);}50%{box-shadow:0 0 0 2px rgba(0,102,161,.6),0 0 50px rgba(0,102,161,.5);}}
        @keyframes rk-flame{0%,100%{transform:translateY(0) scale(1);opacity:.95;}50%{transform:translateY(-1px) scale(1.12);opacity:1;}}
        @keyframes rk-sweep{0%{transform:translateX(-120%);}100%{transform:translateX(220%);}}
        @keyframes rk-barGrow{from{width:0;}}
        #rankingContent .rk-titlerow{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px;flex-wrap:wrap;}
        #rankingContent .rk-title{font-weight:900;font-size:28px;letter-spacing:2px;color:var(--tpv-dark-blue);line-height:1;text-transform:uppercase;}
        #rankingContent .rk-title-underline{height:4px;width:128px;margin-top:9px;border-radius:3px;background:linear-gradient(90deg,var(--ind-yellow),#f59e0b);}
        #rankingContent .rk-week{font-family:'Roboto Mono',monospace;font-size:12px;letter-spacing:1px;color:#94a3b8;text-transform:uppercase;}
        #rankingContent .rk-hero{position:relative;overflow:hidden;border-radius:12px;padding:13px 18px;margin-bottom:14px;background:linear-gradient(115deg,var(--tpv-dark-blue) 0%,var(--tpv-blue) 100%);box-shadow:0 16px 40px -22px rgba(0,90,160,.7);display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;}
        #rankingContent .rk-hero-sweep{position:absolute;top:-40%;left:-10%;width:60%;height:200%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.12),transparent);transform:skewX(-18deg);animation:rk-sweep 6s ease-in-out infinite;pointer-events:none;}
        #rankingContent .rk-hero-left{display:flex;align-items:center;gap:11px;position:relative;}
        #rankingContent .rk-hero-ico{width:38px;height:38px;border-radius:10px;background:rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;font-size:18px;border:1px solid rgba(255,255,255,.25);}
        #rankingContent .rk-hero-h{font-weight:900;font-size:14.5px;letter-spacing:.8px;color:#fff;line-height:1.1;text-transform:uppercase;}
        #rankingContent .rk-hero-sub{font-size:11px;color:rgba(255,255,255,.75);margin-top:2px;}
        #rankingContent .rk-hero-stats{display:flex;gap:20px;position:relative;}
        #rankingContent .rk-stat{text-align:center;}
        #rankingContent .rk-stat-num{font-family:'Roboto Mono',monospace;font-weight:700;font-size:20px;color:#fff;line-height:1;}
        #rankingContent .rk-stat-num.gold{color:var(--ind-yellow);text-shadow:0 0 18px rgba(251,191,36,.45);}
        #rankingContent .rk-stat-lbl{font-size:8.5px;letter-spacing:1px;color:rgba(255,255,255,.65);text-transform:uppercase;margin-top:4px;}
        #rankingContent .rk-stat-div{width:1px;background:rgba(255,255,255,.25);}
        #rankingContent .rk-rules{display:flex;align-items:center;gap:18px;flex-wrap:wrap;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:11px 18px;margin-bottom:28px;font-size:12.5px;color:#64748b;}
        #rankingContent .rk-rules b{font-family:'Roboto Mono',monospace;color:var(--ind-green);}
        #rankingContent .rk-rules .rk-rule{display:flex;align-items:center;gap:6px;}
        #rankingContent .rk-rules .rk-streak-rule{margin-left:auto;color:#ea580c;display:flex;align-items:center;gap:6px;}
        #rankingContent .rk-sec{display:flex;align-items:center;gap:9px;margin-bottom:14px;}
        #rankingContent .rk-sec-t{font-weight:900;font-size:13px;letter-spacing:1.5px;color:#475569;text-transform:uppercase;}
        #rankingContent .rk-sec-hint{font-size:11px;color:#94a3b8;}
        #rankingContent .rk-sec-line{flex:1;height:1px;background:linear-gradient(90deg,#cbd5e1,transparent);}
        #rankingContent .rk-podium{display:flex;align-items:flex-end;justify-content:center;gap:18px;margin-bottom:38px;}
        #rankingContent .rk-col{flex:0 1 270px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;animation:rk-riseIn .6s cubic-bezier(.2,.7,.3,1) both;}
        #rankingContent .rk-card{position:relative;width:100%;border-radius:16px 16px 0 0;padding:20px 16px 18px;text-align:center;border-bottom:none;}
        #rankingContent .rk-crown{position:absolute;top:-13px;left:50%;transform:translateX(-50%);filter:drop-shadow(0 3px 6px rgba(0,0,0,.25));}
        #rankingContent .rk-avatar{position:relative;margin:6px auto 12px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;color:#fff;}
        #rankingContent .rk-avatar span{letter-spacing:1px;}
        #rankingContent .rk-avatar-rank{position:absolute;bottom:-10px;left:50%;transform:translateX(-50%);width:30px;height:30px;border-radius:50%;color:#fff;font-weight:900;font-size:15px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3);}
        #rankingContent .rk-tierchip{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;margin-bottom:8px;}
        #rankingContent .rk-tierchip span.lbl{font-weight:900;font-size:11px;letter-spacing:1px;text-transform:uppercase;}
        #rankingContent .rk-name{font-weight:900;letter-spacing:.3px;color:#fff;line-height:1.15;}
        #rankingContent .rk-mat{font-family:'Roboto Mono',monospace;font-size:11px;color:rgba(255,255,255,.6);margin-top:2px;}
        #rankingContent .rk-pts{margin:12px 0 4px;display:flex;align-items:baseline;justify-content:center;gap:6px;}
        #rankingContent .rk-pts-num{font-family:'Roboto Mono',monospace;font-weight:700;color:#fff;line-height:1;}
        #rankingContent .rk-pts-u{font-size:11px;letter-spacing:1.5px;color:rgba(255,255,255,.7);text-transform:uppercase;}
        #rankingContent .rk-chips{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:8px;flex-wrap:wrap;}
        #rankingContent .rk-streak{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;background:rgba(234,88,12,.22);border:1px solid rgba(234,88,12,.5);}
        #rankingContent .rk-streak .fl{animation:rk-flame 1.4s ease-in-out infinite;}
        #rankingContent .rk-streak .v{font-family:'Roboto Mono',monospace;font-weight:700;font-size:11px;color:#fed7aa;}
        #rankingContent .rk-move{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;font-size:10px;font-weight:900;}
        #rankingContent .rk-badges{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:12px;padding-top:11px;border-top:1px solid rgba(255,255,255,.18);}
        #rankingContent .rk-badge{width:26px;height:26px;border-radius:8px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:13px;}
        #rankingContent .rk-plinth{position:relative;width:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;}
        #rankingContent .rk-plinth-sheen{position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.18),transparent 40%);}
        #rankingContent .rk-plinth-num{font-weight:900;opacity:.9;line-height:1;color:#fff;}
        #rankingContent .rk-champs{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:38px;}
        #rankingContent .rk-champ{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px 16px 8px;}
        #rankingContent .rk-champ-head{display:flex;align-items:center;gap:10px;padding-bottom:12px;border-bottom:1px solid #f1f5f9;margin-bottom:8px;}
        #rankingContent .rk-champ-ico{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:17px;}
        #rankingContent .rk-champ-t{font-weight:900;font-size:14px;letter-spacing:1px;text-transform:uppercase;}
        #rankingContent .rk-champ-row{display:flex;align-items:center;gap:10px;padding:8px 4px;}
        #rankingContent .rk-champ-medal{font-size:15px;width:20px;text-align:center;}
        #rankingContent .rk-champ-av{width:28px;height:28px;border-radius:50%;background:#f1f5f9;border:1px solid #e2e8f0;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:11px;color:#475569;}
        #rankingContent .rk-champ-nm{flex:1;font-size:13px;font-weight:600;color:#334155;}
        #rankingContent .rk-champ-nm.top{color:#1e293b;font-weight:900;}
        #rankingContent .rk-champ-val{font-family:'Roboto Mono',monospace;font-weight:700;font-size:14px;}
        #rankingContent .rk-champ-unit{font-size:10px;color:#94a3b8;margin-left:3px;}
        #rankingContent .rk-champ-empty{color:#cbd5e1;font-style:italic;font-size:12px;padding:8px 4px;}
        #rankingContent .rk-board{background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;}
        #rankingContent .rk-board-head{display:grid;grid-template-columns:60px 1fr 82px 82px 72px 82px 110px;align-items:center;gap:10px;padding:13px 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0;}
        #rankingContent .rk-board-head span{font-weight:900;font-size:11px;letter-spacing:1px;color:#94a3b8;text-transform:uppercase;}
        #rankingContent .rk-board-head .r{text-align:right;}
        #rankingContent .rk-board-head .c{text-align:center;}
        #rankingContent .rk-row{display:grid;grid-template-columns:60px 1fr 82px 82px 72px 82px 110px;align-items:center;gap:10px;padding:13px 20px;border-bottom:1px solid #f1f5f9;animation:rk-rowIn .45s ease both;}
        #rankingContent .rk-row:last-child{border-bottom:none;}
        #rankingContent .rk-row:hover{background:#f8fafc;}
        #rankingContent .rk-row.you{background:#fffbeb;box-shadow:inset 3px 0 0 var(--ind-yellow);}
        #rankingContent .rk-pos{display:flex;align-items:center;gap:6px;}
        #rankingContent .rk-pos-n{font-weight:900;font-size:17px;color:#475569;}
        #rankingContent .rk-pos-move{font-size:9px;font-weight:900;}
        #rankingContent .rk-emp{display:flex;align-items:center;gap:11px;min-width:0;}
        #rankingContent .rk-emp-av{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--tpv-blue),var(--tpv-dark-blue));border:1px solid #cbd5e1;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;color:#fff;flex-shrink:0;}
        #rankingContent .rk-emp-nm{font-weight:900;font-size:13.5px;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        #rankingContent .rk-emp-mat{font-family:'Roboto Mono',monospace;font-size:10.5px;color:#94a3b8;}
        #rankingContent .rk-cell{text-align:center;font-family:'Roboto Mono',monospace;font-weight:500;font-size:14px;color:#64748b;}
        #rankingContent .rk-ptscell{text-align:right;}
        #rankingContent .rk-ptscell .v{font-family:'Roboto Mono',monospace;font-weight:900;font-size:16px;color:#b45309;}
        #rankingContent .rk-bar{height:4px;border-radius:3px;background:linear-gradient(90deg,#f59e0b,var(--ind-yellow));margin-top:5px;margin-left:auto;animation:rk-barGrow 1s cubic-bezier(.2,.7,.3,1) both;}
        #rankingContent .rk-foot{margin-top:18px;text-align:center;font-size:11px;color:#94a3b8;letter-spacing:.5px;}
        @media(max-width:860px){
            #rankingContent .rk-champs{grid-template-columns:1fr;}
            #rankingContent .rk-board-head,#rankingContent .rk-row{grid-template-columns:50px 1fr 70px 90px;}
            #rankingContent .rk-board-head .col-listas,#rankingContent .rk-row .col-listas{display:none;}
            #rankingContent .rk-podium{flex-wrap:wrap;}
        }`;
        const st = document.createElement('style');
        st.id = 'rkStyle';
        st.textContent = css;
        document.head.appendChild(st);
    },
    render() {
        const el = document.getElementById('rankingContent');
        if (!el) return;
        Ranking._prevPositions = null; // reset para recalcular
        Ranking._injectCSS();
        try { WeeklyStats.sync(); } catch (e) {}   // v16.28: consolida a semana atual

        const all    = RankingEngine.buildAllRanking();
        const myMat  = State.currentUser?.matricula;
        const now    = new Date();
        const wCut   = Date.now() - RankingEngine.WEEK_MS;
        const wLabel = new Date(wCut).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})
                     + ' — ' + now.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});

        if (!all.length) {
            el.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:40px;font-style:italic;">Nenhuma operacao registrada nos ultimos 7 dias.</div>';
            return;
        }

        const initials = (nome) => {
            const p = String(nome || '?').trim().split(/\s+/);
            return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase();
        };
        const moveInfo = (m) => {
            if (m === 'up')   return {ic:'▲',c:'#059669',t:'subiu', bg:'rgba(16,185,129,.16)'};
            if (m === 'down') return {ic:'▼',c:'#dc2626',t:'caiu',  bg:'rgba(220,38,38,.14)'};
            return {ic:'—',c:'#94a3b8',t:'mantém',bg:'rgba(148,163,184,.16)'};
        };
        const esc = (s) => Security.sanitize(String(s == null ? '' : s));

        // Tiers do podio (1=Diamante TPV-azul, 2=Ouro, 3=Prata) — tema claro
        const TIERS = {
            1:{label:'Diamante',icon:'💎',ring:'#0066A1',glow:'rgba(0,102,161,.5)',
               cardBg:'linear-gradient(180deg,#0066A1,#004065)',
               tierChipBg:'rgba(255,255,255,.16)',plinthBg:'linear-gradient(180deg,#005b96,#003a5e)',
               avatarBg:'linear-gradient(135deg,#0ea5e9,#0369a1)',crown:'👑',crownSize:30,
               avatarSize:92,initialsSize:30,nameSize:19,ptsSize:44,plinthH:128,plinthNumSize:76,
               avatarAnim:'animation:rk-glowPulse 2.6s ease-in-out infinite;'},
            2:{label:'Ouro',icon:'🥇',ring:'#fbbf24',glow:'rgba(251,191,36,.5)',
               cardBg:'linear-gradient(180deg,#b45309,#92400e)',
               tierChipBg:'rgba(255,255,255,.16)',plinthBg:'linear-gradient(180deg,#a8480a,#7c3a0a)',
               avatarBg:'linear-gradient(135deg,#f59e0b,#b45309)',crown:'',crownSize:0,
               avatarSize:74,initialsSize:24,nameSize:17,ptsSize:34,plinthH:92,plinthNumSize:58,
               avatarAnim:'box-shadow:0 0 26px rgba(251,191,36,.4);'},
            3:{label:'Prata',icon:'🥈',ring:'#cbd5e1',glow:'rgba(100,116,139,.35)',
               cardBg:'linear-gradient(180deg,#64748b,#475569)',
               tierChipBg:'rgba(255,255,255,.16)',plinthBg:'linear-gradient(180deg,#5b6675,#434c5a)',
               avatarBg:'linear-gradient(135deg,#94a3b8,#475569)',crown:'',crownSize:0,
               avatarSize:74,initialsSize:24,nameSize:17,ptsSize:34,plinthH:66,plinthNumSize:48,
               avatarAnim:'box-shadow:0 0 22px rgba(100,116,139,.3);'},
        };

        const badgesFor = (u) => {
            const b = [];
            if (u.weekDevolv >= 400) b.push({icon:'🔁',label:'Devolvedor Fiel'});
            if (u.weekBuscas >= 50)  b.push({icon:'🎯',label:'Caçador'});
            if (u.weekListas >= 5)   b.push({icon:'📋',label:'Listeiro'});
            if (u.streak >= 1.8)     b.push({icon:'⚡',label:'Em sequência'});
            return b;
        };

        const totalPts = Math.round(all.reduce((s,u)=>s+u.weekPtsMult,0));
        // v16.23: listas nao pontuam — sao mostradas apenas como informacao agregada
        const totListas     = all.reduce((s,u)=>s+(u.weekListas||0),0);
        const totListaItens = all.reduce((s,u)=>s+(u.weekListaItens||0),0);

        // ---- Podio (ordem visual: 2º, 1º, 3º) ----
        const podOrder = [[all[1],2],[all[0],1],[all[2],3]];
        const podiumHTML = podOrder.map(([u,rank]) => {
            if (!u) return '';
            const t = TIERS[rank];
            const mv = moveInfo(Ranking._moveOf(u.mat, rank));
            const isMe = u.mat === myMat;
            const badges = badgesFor(u).map(b=>`<span class="rk-badge" title="${esc(b.label)}">${b.icon}</span>`).join('');
            return `
            <div class="rk-col">
              <div class="rk-card" style="background:${t.cardBg};box-shadow:0 12px 34px -18px ${t.glow};${isMe?'outline:3px solid var(--ind-yellow);outline-offset:2px;':''}">
                ${t.crown?`<div class="rk-crown" style="font-size:${t.crownSize}px;">${t.crown}</div>`:''}
                <div class="rk-avatar" style="width:${t.avatarSize}px;height:${t.avatarSize}px;background:${t.avatarBg};border:3px solid ${t.ring};${t.avatarAnim}">
                  <span style="font-size:${t.initialsSize}px;">${initials(u.nome)}</span>
                  <div class="rk-avatar-rank" style="background:${t.ring};border:2px solid #fff;${rank===3?'color:#475569;':''}">${rank}</div>
                </div>
                <div class="rk-tierchip" style="background:${t.tierChipBg};border:1px solid ${t.ring};">
                  <span>${t.icon}</span><span class="lbl" style="color:#fff;">${t.label}</span>
                </div>
                <div class="rk-name" style="font-size:${t.nameSize}px;">${esc(u.nome || u.mat)}${isMe?' <span style="background:var(--ind-yellow);color:#1e293b;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:900;vertical-align:middle;">VOCÊ</span>':''}</div>
                <div class="rk-mat">mat. ${esc(u.mat)}</div>
                <div class="rk-pts">
                  <span class="rk-pts-num" style="font-size:${t.ptsSize}px;text-shadow:0 0 22px ${t.glow};">${u.weekPtsMult.toFixed(1)}</span>
                  <span class="rk-pts-u">pts</span>
                </div>
                <div class="rk-chips">
                  ${u.streak > 1 ? `<span class="rk-streak"><span class="fl">🔥</span><span class="v">x${u.streak.toFixed(1)}</span></span>` : ''}
                  <span class="rk-move" style="background:${mv.bg};color:${mv.c};"><span>${mv.ic}</span><span>${mv.t}</span></span>
                </div>
                ${badges?`<div class="rk-badges">${badges}</div>`:''}
              </div>
              <div class="rk-plinth" style="height:${t.plinthH}px;background:${t.plinthBg};border-top:2px solid ${t.ring};">
                <div class="rk-plinth-sheen"></div>
                <span class="rk-plinth-num" style="font-size:${t.plinthNumSize}px;">${rank}</span>
              </div>
            </div>`;
        }).join('');

        // ---- Campeoes por categoria ----
        const cats = [
            {title:'Devolvedor',icon:'🔁',color:'#059669',bg:'rgba(16,185,129,.13)',key:'weekDevolv',unit:'devol.'},
            {title:'Caçador',   icon:'🎯',color:'#0369a1',bg:'rgba(3,105,161,.13)', key:'weekBuscas',unit:'buscas'},
            {title:'Listas (info)', icon:'📋',color:'#7c3aed',bg:'rgba(124,58,237,.13)',key:'weekListas',unit:'listas',extraKey:'weekListaItens',extraUnit:'materiais'},
        ];
        const champsHTML = cats.map(c => {
            const top3 = [...all].filter(u=>u[c.key]>0).sort((a,b)=>b[c.key]-a[c.key]).slice(0,3);
            const rows = top3.length ? top3.map((u,i)=>{
                const isMe = u.mat === myMat;
                return `
                <div class="rk-champ-row">
                  <div class="rk-champ-medal">${['🥇','🥈','🥉'][i]}</div>
                  <div class="rk-champ-av">${initials(u.nome)}</div>
                  <div class="rk-champ-nm${i===0?' top':''}">${esc(u.nome || u.mat)}${isMe?' <span style="background:var(--ind-yellow);color:#1e293b;font-size:9px;padding:0 5px;border-radius:8px;font-weight:900;">VOCÊ</span>':''}</div>
                  <div class="rk-champ-val" style="color:${c.color};">${u[c.key]}<span class="rk-champ-unit">${c.unit}</span>${c.extraKey ? `<div style="font-size:11px;font-weight:700;color:#94a3b8;margin-top:2px;">${u[c.extraKey]||0} ${c.extraUnit}</div>` : ''}</div>
                </div>`;
            }).join('') : '<div class="rk-champ-empty">Sem dados</div>';
            return `
            <div class="rk-champ">
              <div class="rk-champ-head">
                <div class="rk-champ-ico" style="background:${c.bg};">${c.icon}</div>
                <div class="rk-champ-t" style="color:${c.color};">${c.title}</div>
              </div>
              ${rows}
            </div>`;
        }).join('');

        // ---- Leaderboard (posicoes 4+) ----
        const rest = all.slice(3);
        const maxRest = Math.max(1, ...rest.map(u=>u.weekPtsMult));
        const rowsHTML = rest.map((u,i)=>{
            const mv = moveInfo(Ranking._moveOf(u.mat, i+4));
            const pct = Math.max(8, Math.round((u.weekPtsMult/maxRest)*100));
            const isMe = u.mat === myMat;
            return `
            <div class="rk-row${isMe?' you':''}" style="animation-delay:${i*45}ms;">
              <div class="rk-pos">
                <span class="rk-pos-n">${i+4}º</span>
                <span class="rk-pos-move" style="color:${mv.c};">${mv.ic}</span>
              </div>
              <div class="rk-emp">
                <div class="rk-emp-av">${initials(u.nome)}</div>
                <div style="min-width:0;">
                  <div class="rk-emp-nm">${esc(u.nome || u.mat)}${isMe?' <span style="color:#b45309;font-size:10px;">(você)</span>':''}</div>
                  <div class="rk-emp-mat">mat. ${esc(u.mat)}</div>
                </div>
              </div>
              <div class="rk-cell">${u.weekDevolv}</div>
              <div class="rk-cell">${u.weekBuscas}</div>
              <div class="rk-cell col-listas">${u.weekListas}</div>
              <div class="rk-cell col-listas">${u.weekListaItens}</div>
              <div class="rk-ptscell">
                <span class="v">${u.weekPtsMult.toFixed(1)}</span>
                <div class="rk-bar" style="width:${pct}%;animation-delay:${i*45}ms;"></div>
              </div>
            </div>`;
        }).join('');

        el.innerHTML = `
        <div class="rk-wrap">

          <div class="rk-titlerow" style="justify-content:flex-end;">
            <div class="rk-week">${esc(wLabel)}</div>
          </div>

          <div class="rk-hero">
            <div class="rk-hero-sweep"></div>
            <div class="rk-hero-left">
              <div class="rk-hero-ico">🏆</div>
              <div>
                <div class="rk-hero-h">Campeonato Semanal</div>
                <div class="rk-hero-sub">1 ponto por devolução e 1 ponto por busca avulsa — com bônus de sequência. Listas são apenas informativas.</div>
              </div>
            </div>
            <div class="rk-hero-stats">
              <div class="rk-stat"><div class="rk-stat-num">${all.length}</div><div class="rk-stat-lbl">Ativos</div></div>
              <div class="rk-stat-div"></div>
              <div class="rk-stat"><div class="rk-stat-num gold">${totalPts}</div><div class="rk-stat-lbl">Total de Pontos</div></div>
              <div class="rk-stat-div"></div>
              <div class="rk-stat"><div class="rk-stat-num">${totListas}</div><div class="rk-stat-lbl">Listas Feitas</div></div>
              <div class="rk-stat-div"></div>
              <div class="rk-stat"><div class="rk-stat-num">${totListaItens}</div><div class="rk-stat-lbl">Materiais nas Listas</div></div>
            </div>
          </div>

          <div class="rk-rules">
            <span class="rk-rule"><b>+1</b> Devolução (por ação)</span>
            <span class="rk-rule"><b>+1</b> Busca avulsa (por ação)</span>
            <span class="rk-rule" style="color:#7c3aed;"><b style="color:#7c3aed;">Listas</b> não pontuam &mdash; apenas informativo</span>
            <span class="rk-streak-rule">🔥 Streak a cada 3 ops em &lt;5h = x+10%</span>
          </div>

          <div class="rk-sec">
            <span class="rk-sec-t">Pódio Geral</span>
            <span class="rk-sec-hint">pontos com bônus de sequência</span>
            <div class="rk-sec-line"></div>
          </div>
          <div class="rk-podium">${podiumHTML}</div>

          <div class="rk-sec">
            <span class="rk-sec-t">Campeões por Categoria</span>
            <div class="rk-sec-line"></div>
          </div>
          <div class="rk-champs">${champsHTML}</div>

          ${all.length > 3 ? `
          <div class="rk-sec">
            <span class="rk-sec-t">Demais Classificados</span>
            <div class="rk-sec-line"></div>
          </div>
          <div class="rk-board">
            <div class="rk-board-head">
              <span>Pos.</span>
              <span>Funcionário</span>
              <span class="c">Devol.</span>
              <span class="c">Buscas</span>
              <span class="c col-listas">Listas</span>
              <span class="c col-listas">Materiais</span>
              <span class="r">Pontos</span>
            </div>
            ${rowsHTML}
          </div>` : ''}

          <div class="rk-sec" style="margin-top:34px;">
            <span class="rk-sec-t">Histórico Semanal</span>
            <span class="rk-sec-hint">somente os números — guardados por 45 dias</span>
            <div class="rk-sec-line"></div>
          </div>
          <div id="rkHistBox"></div>

          <div class="rk-foot">Atualizado automaticamente • ${esc(wLabel)}</div>

        </div>`;

        Ranking.renderHistory();
    },

    // ========================================================
    // v16.28 — HISTORICO SEMANAL (somente numeros, 45 dias)
    // Semana de SEGUNDA a SEGUNDA. Nao guarda material, locacao
    // nem listas — apenas contadores por funcionario.
    // ========================================================
    _histWeek: null,

    renderHistory() {
        const box = document.getElementById('rkHistBox');
        if (!box) return;
        const esc = (s) => Security.sanitize(String(s == null ? '' : s));
        const weeks = WeeklyStats.weeks();

        if (!weeks.length) {
            box.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:26px;font-style:italic;font-size:0.9rem;">Ainda nao ha semanas consolidadas.</div>';
            return;
        }

        const curKey = WeeklyStats.key(Date.now());
        // Por padrao mostra a SEMANA ANTERIOR (se existir); senao, a mais recente
        if (!Ranking._histWeek || !weeks.some(w => w.key === Ranking._histWeek)) {
            const anterior = weeks.find(w => w.key !== curKey);
            Ranking._histWeek = (anterior || weeks[0]).key;
        }
        const sel = Ranking._histWeek;

        const opts = weeks.map(w => {
            const tag = (w.key === curKey) ? ' (semana atual)'
                      : (w.key === weeks.filter(x => x.key !== curKey)[0]?.key ? ' (semana anterior)' : '');
            return `<option value="${esc(w.key)}"${w.key === sel ? ' selected' : ''}>${esc(WeeklyStats.label(w.s))}${tag}</option>`;
        }).join('');

        const rows = WeeklyStats.rows(sel);
        const tot = rows.reduce((a, r) => ({
            d: a.d + (r.d||0), b: a.b + (r.b||0), l: a.l + (r.l||0), m: a.m + (r.m||0), p: a.p + (r.p||0)
        }), { d:0, b:0, l:0, m:0, p:0 });

        const myMat = State.currentUser?.matricula;
        const body = rows.length ? rows.map((r, i) => `
            <tr style="${String(r.mat) === String(myMat) ? 'background:#fffbeb;' : ''}">
              <td style="padding:9px 10px;border-bottom:1px solid #e2e8f0;font-weight:900;color:#94a3b8;width:44px;">${i+1}º</td>
              <td style="padding:9px 10px;border-bottom:1px solid #e2e8f0;font-weight:700;">${esc(r.n || r.mat)}
                  <div style="font-size:10px;color:#94a3b8;font-family:'Roboto Mono',monospace;">mat. ${esc(r.mat)}</div></td>
              <td style="padding:9px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-family:'Roboto Mono',monospace;">${r.d||0}</td>
              <td style="padding:9px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-family:'Roboto Mono',monospace;">${r.b||0}</td>
              <td style="padding:9px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-family:'Roboto Mono',monospace;color:#7c3aed;">${r.l||0}</td>
              <td style="padding:9px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-family:'Roboto Mono',monospace;color:#7c3aed;">${r.m||0}</td>
              <td style="padding:9px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:900;font-family:'Roboto Mono',monospace;color:var(--tpv-dark-blue);">${r.p||0}</td>
            </tr>`).join('')
          : '<tr><td colspan="7" style="padding:22px;text-align:center;color:#94a3b8;font-style:italic;">Sem movimentacao nesta semana.</td></tr>';

        box.innerHTML = `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
            <label style="font-size:12px;font-weight:900;letter-spacing:1px;color:#475569;text-transform:uppercase;">Semana</label>
            <select id="rkHistSel" onchange="Ranking._histWeek=this.value;Ranking.renderHistory();"
                    style="padding:7px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:0.88rem;font-weight:700;color:#1e293b;background:#f8fafc;cursor:pointer;">
              ${opts}
            </select>
            <span style="margin-left:auto;font-size:11px;color:#94a3b8;">De segunda a segunda • ${rows.length} funcionario(s)</span>
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.87rem;">
              <thead>
                <tr style="background:#f1f5f9;">
                  <th style="padding:9px 10px;text-align:left;font-size:11px;letter-spacing:1px;color:#64748b;text-transform:uppercase;">#</th>
                  <th style="padding:9px 10px;text-align:left;font-size:11px;letter-spacing:1px;color:#64748b;text-transform:uppercase;">Funcionario</th>
                  <th style="padding:9px 10px;text-align:center;font-size:11px;letter-spacing:1px;color:#64748b;text-transform:uppercase;">Devol.</th>
                  <th style="padding:9px 10px;text-align:center;font-size:11px;letter-spacing:1px;color:#64748b;text-transform:uppercase;">Buscas</th>
                  <th style="padding:9px 10px;text-align:center;font-size:11px;letter-spacing:1px;color:#7c3aed;text-transform:uppercase;">Listas</th>
                  <th style="padding:9px 10px;text-align:center;font-size:11px;letter-spacing:1px;color:#7c3aed;text-transform:uppercase;">Materiais</th>
                  <th style="padding:9px 10px;text-align:right;font-size:11px;letter-spacing:1px;color:#64748b;text-transform:uppercase;">Pontos</th>
                </tr>
              </thead>
              <tbody>${body}</tbody>
              <tfoot>
                <tr style="background:#f8fafc;font-weight:900;">
                  <td colspan="2" style="padding:10px;border-top:2px solid #cbd5e1;font-size:12px;letter-spacing:1px;color:#475569;text-transform:uppercase;">Total da semana</td>
                  <td style="padding:10px;border-top:2px solid #cbd5e1;text-align:center;font-family:'Roboto Mono',monospace;">${tot.d}</td>
                  <td style="padding:10px;border-top:2px solid #cbd5e1;text-align:center;font-family:'Roboto Mono',monospace;">${tot.b}</td>
                  <td style="padding:10px;border-top:2px solid #cbd5e1;text-align:center;font-family:'Roboto Mono',monospace;color:#7c3aed;">${tot.l}</td>
                  <td style="padding:10px;border-top:2px solid #cbd5e1;text-align:center;font-family:'Roboto Mono',monospace;color:#7c3aed;">${tot.m}</td>
                  <td style="padding:10px;border-top:2px solid #cbd5e1;text-align:right;font-family:'Roboto Mono',monospace;color:var(--tpv-dark-blue);">${tot.p}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>`;
    },
};
