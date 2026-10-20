// ==========================================================================
// SPARE PARTS - 23-etiquetas.js (portado do v16.37-38)
// ==========================================================================

// ============================================================================
// MODULO: ETIQUETAS (v16.37)
// Le a lista do MES aberta no Comparador e permite imprimir uma etiqueta
// 50x25mm (Elgin L42) com o CODIGO DA LISTA em codigo de barras.
// O codigo e completado com espacos ate 18 caracteres (13 -> +5, 15 -> +3).
// Sugere imprimir quando o estoque so tem um codigo PARECIDO (mesmo tamanho,
// ate 2 caracteres diferentes) e nao o codigo exato pedido pelo MES.
// ============================================================================
const Etiquetas = {
    TAM: 18,
    _rows: [],

    pad(code) { return String(code || '').trim().toUpperCase().padEnd(Etiquetas.TAM, ' '); },

    _dif(a, b) { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; },

    montar() {
        const out = [];
        const data = State.rawFeederData, cfg = State.feederConfig || {};
        if (!data || cfg.cCode === undefined) { Etiquetas._rows = out; return out; }

        const estoque = new Set((State.inventory || []).filter(i => i.code).map(i => i.code.trim().toUpperCase()));
        const lista = [...estoque];
        const vistos = new Set();

        for (let i = cfg.startRow + 1; i < data.length; i++) {
            const r = data[i]; if (!r) continue;
            const code = String(r[cfg.cCode] || '').trim().toUpperCase();
            if (!code) continue;
            if (Feeder._skipByTrk(r) || Feeder._skipByTray(r)) continue;

            let status = 'FALTA', parecido = '';
            if (estoque.has(code)) status = 'OK';
            else {
                const sim = lista.find(c => c.length === code.length && Etiquetas._dif(c, code) <= 2);
                if (sim) { status = 'SUGERIDA'; parecido = sim; }
            }
            out.push({
                code, parecido, status,
                mach: String(r[cfg.cMach] || '').trim(),
                pos:  String(r[cfg.cPos]  || '').trim(),
                dup:  vistos.has(code),
            });
            vistos.add(code);
        }
        Etiquetas._rows = out;
        return out;
    },

    avisar() {
        const n = Etiquetas.montar().filter(r => r.status === 'SUGERIDA').length;
        if (n) Toast.warn(`${n} material(is) da lista tem codigo parecido no estoque. Veja a aba ETIQUETAS para imprimir o codigo do MES.`, 9000);
    },

    render() {
        const el = document.getElementById('etqContent'); if (!el) return;
        const S = Security.sanitize;
        const rows = Etiquetas.montar();
        const cfg = State.feederConfig || {};

        if (!rows.length) {
            el.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:40px;font-style:italic;">Nenhuma lista aberta. Carregue a feeder list do MES na aba <b>Comparador</b>.</div>';
            return;
        }
        const sug = rows.filter(r => r.status === 'SUGERIDA');
        const ordem = { SUGERIDA: 0, FALTA: 1, OK: 2 };
        const arr = rows.map((r, i) => ({ ...r, i })).sort((a, b) => ordem[a.status] - ordem[b.status]);

        const tag = st => st === 'SUGERIDA'
            ? '<span class="badge" style="background:#f59e0b;border-color:#b45309;width:auto;padding:4px 10px;">IMPRIMIR</span>'
            : st === 'OK' ? '<span class="badge bg-ok" style="width:auto;padding:4px 10px;">IGUAL</span>'
            : '<span class="badge bg-err" style="width:auto;padding:4px 10px;">SEM ESTOQUE</span>';

        el.innerHTML = `
        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:14px 18px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
            <div style="font-size:0.88rem;color:#0369a1;line-height:1.5;">
                <b>OP ${S(cfg.wo || '--')}</b> · Linha ${S(cfg.line || '--')}${cfg.machine ? ' · Maq ' + S(cfg.machine) : ''} · ${rows.length} material(is)<br>
                <b style="color:#b45309;">${sug.length}</b> com codigo parecido no estoque — imprima a etiqueta com o codigo do MES.
                Etiqueta 50x25mm · codigo completado ate ${Etiquetas.TAM} caracteres.
            </div>
            <label style="font-size:0.8rem;color:#0369a1;font-weight:700;display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" ${Etiquetas._girar() ? 'checked' : ''} onchange="Etiquetas.setGirar(this.checked)"> Girar 90° (se sair de lado)</label>
            <button class="btn-3d btn-yellow" ${sug.length ? '' : 'disabled'} onclick="Etiquetas.imprimirSugeridas()"><i class="fas fa-print"></i> IMPRIMIR TODAS AS SUGERIDAS (${sug.length})</button>
        </div>
        <div style="max-height:560px;overflow:auto;border:1px solid #e2e8f0;border-radius:6px;">
        <table style="margin-top:0;">
            <thead><tr><th>${S(Feeder._heads().c1)}</th><th>${S(Feeder._heads().c2)}</th><th>Codigo (lista MES)</th><th>No estoque</th><th style="text-align:center;">Situacao</th><th style="text-align:center;">Etiqueta</th></tr></thead>
            <tbody>${arr.map(r => `
                <tr style="${r.status === 'SUGERIDA' ? 'background:#fffbeb;' : ''}">
                    <td>${S(r.mach)}</td><td><b>${S(r.pos)}</b></td>
                    <td style="font-weight:900;color:var(--tpv-dark-blue);">${S(r.code)} <span style="font-size:0.7rem;color:#94a3b8;">(${r.code.length})</span></td>
                    <td>${r.status === 'SUGERIDA' ? '<span style="color:#b45309;font-weight:800;">' + S(r.parecido) + '</span>' : r.status === 'OK' ? S(r.code) : '-'}</td>
                    <td style="text-align:center;">${tag(r.status)}</td>
                    <td style="text-align:center;"><button class="btn-3d btn-blue" style="padding:6px 12px;font-size:0.8rem;" onclick="Etiquetas.imprimir([${r.i}])"><i class="fas fa-print"></i> IMPRIMIR</button></td>
                </tr>`).join('')}</tbody>
        </table></div>`;
    },

    imprimirSugeridas() {
        const idx = Etiquetas._rows.map((r, i) => r.status === 'SUGERIDA' ? i : -1).filter(i => i >= 0);
        if (idx.length) Etiquetas.imprimir(idx);
    },

    // v16.38: etiqueta desenhada como UMA imagem (203 dpi = 8 pontos/mm), assim nao divide em 2.
    _girar() { try { return localStorage.getItem('etq_girar') === '1'; } catch (e) { return false; } },
    setGirar(v) { try { localStorage.setItem('etq_girar', v ? '1' : '0'); } catch (e) {} },

    _imagem(r) {
        const W = 400, H = 200;               // 50mm x 25mm
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);

        const bc = document.createElement('canvas');
        JsBarcode(bc, Etiquetas.pad(r.code), { format: 'CODE128', displayValue: false, margin: 0, width: 2, height: 90 });
        const bw = Math.min(W - 24, bc.width);
        g.imageSmoothingEnabled = false;
        g.drawImage(bc, Math.round((W - bw) / 2), 12, bw, 90);

        g.fillStyle = '#000'; g.textAlign = 'center';
        let fs = 30; g.font = `bold ${fs}px "Courier New", monospace`;
        while (g.measureText(r.code).width > W - 16 && fs > 16) { fs--; g.font = `bold ${fs}px "Courier New", monospace`; }
        g.fillText(r.code, W / 2, 140);

        const pos = `${r.mach}${r.mach && r.pos ? ' · ' : ''}POS ${r.pos}`;
        fs = 22; g.font = `bold ${fs}px Arial`;
        while (g.measureText(pos).width > W - 16 && fs > 12) { fs--; g.font = `bold ${fs}px Arial`; }
        g.fillText(pos, W / 2, 180);

        if (!Etiquetas._girar()) return c.toDataURL('image/png');
        const rc = document.createElement('canvas'); rc.width = H; rc.height = W;
        const rg = rc.getContext('2d'); rg.translate(H, 0); rg.rotate(Math.PI / 2); rg.drawImage(c, 0, 0);
        return rc.toDataURL('image/png');
    },

    imprimir(indices) {
        if (typeof JsBarcode === 'undefined') { Toast.error('Biblioteca de codigo de barras nao carregou. Verifique a internet e recarregue.'); return; }
        const rows = indices.map(i => Etiquetas._rows[i]).filter(Boolean);
        if (!rows.length) return;
        const gir = Etiquetas._girar();
        const pw = gir ? 25 : 50, ph = gir ? 50 : 25;
        const imgs = rows.map(r => `<img src="${Etiquetas._imagem(r)}">`).join('');

        const html = `<!doctype html><html><head><meta charset="utf-8"><style>
            @page { size: ${pw}mm ${ph}mm; margin: 0; }
            html, body { margin:0; padding:0; }
            img { display:block; width:${pw}mm; height:${ph}mm; page-break-after:always; break-inside:avoid; }
            img:last-child { page-break-after:auto; }
        </style></head><body>${imgs}</body></html>`;

        const fr = document.createElement('iframe');
        fr.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0;';
        document.body.appendChild(fr);
        fr.contentDocument.open(); fr.contentDocument.write(html); fr.contentDocument.close();
        setTimeout(() => {
            fr.contentWindow.focus(); fr.contentWindow.print();
            setTimeout(() => fr.remove(), 2000);
        }, 400);
        Logs.log('PRINT_LABEL', `Imprimiu ${indices.length} etiqueta(s) da OP ${(State.feederConfig || {}).wo || '--'}`);
    },
};
window.Etiquetas = Etiquetas;
