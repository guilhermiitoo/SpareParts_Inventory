// ==========================================================================
// SPARE PARTS - 00-state.js (extraido do v16.32)
// ==========================================================================

'use strict';

// ============================================================
// MODULO: ESTADO GLOBAL (Namespace unico, sem vars soltas)
// ============================================================
const State = {
    dbFileHandle: null,      // handle de dados/indice.json (sentinela de "conectado")
    dbDirHandle:  null,      // v17: handle da PASTA — e ele que carrega a permissao
    isConnected: false,
    sdSnapshot:   null,          // PNG base64 do dashboard (foto semanal)         // true apenas quando arquivo esta importado e sync ativo
    lastKnownFileContent: '',
    lastModifiedTime: 0,

    inventory: [],
    validLocations: [],
    users: [],
    logs: [],
    checkoutHistory: [],
    adminConfig: { passwordHash: '', attempts: 0 },
    componentCatalog: [],  // { code, description } — catalogo de componentes da fabrica
    carMaterialType: {},   // { [car]: 'NXT' | 'XP' | 'PTH' } — tipo de material por carro

    // v17.03 — familias de codificacao de part number. Eixo de todos os
    // graficos do Dashboard de Estoque MMT. Banco antigo abre sem elas:
    // as sementes sao criadas na primeira abertura.
    materialFamilies: [],
    // Limites das faixas criticas (configuraveis, nao fixos no codigo)
    stockLimits: null,
    // v17.05 — configuracao do "Nao classificado". Ele nao e uma familia
    // cadastrada (e o resto, o que nao bate com nenhum padrao), entao nao
    // cabe na lista acima; mas o nome, a cor e a presenca nos graficos sao
    // escolha do usuario. Formato: { nome, cor, oculta }.
    unclassified: null,

    // v16.28: consolidado semanal do Ranking (SOMENTE NUMEROS — 45 dias).
    // Formato: { "2026-08-17": { s: <ts segunda>, e: <ts segunda seguinte>,
    //            u: { "<matricula>": { n:'Nome', d:devolucoes, b:buscas,
    //                                  l:listas, m:materiais, p:pontos } } } }
    // Nao guarda material, locacao, W/O nem qualquer lista — so contadores.
    weeklyStats: {},

    // v16.29: sessoes de LEITURA DE CAIXAS (scanner).
    // Guarda a lista aberta com marcacao do que ja foi achado na caixa,
    // para o operador poder sair do sistema e voltar de onde parou.
    boxSessions: [],

    currentUser: null,
    rawFeederData: null,
    feederMode: 'SMT',           // v16.17: 'SMT' ou 'IA' (armarios) — definido pela OP/W-O
    rawMasterData: null,
    feederConfig: { startRow: 0, cMach: 0, cPos: 1, cCode: 2 },
    sessionStartTime: null,

    selectedMapCar: null,
    currentMatchedIds: [],
    isKittingRevealed: false,

    // Devolucao - Estado da maquina de 3 etapas
    devState: 'LOC',           // LOC -> CODE -> QTY -> (commit)
    pendingDevCar: '',
    pendingDevLocName: '',
    pendingDevCode: '',
    pendingDevQty: 0,
    devSessionLog: [],         // historico rapido da sessao atual

    commitmentCallback: null,

    // Reimpressao: flag que bloqueia triggerRefresh de sobrescrever o HTML injetado
    _reprintMode: false,
    _reprintData: null,   // { tableHTML, thead, printLine, printWO, printUser, printDate, type }

    // Controles internos
    _syncTimer: null,
    _syncInterval: 1500,   // 1500ms: estável em rede SMB. Máximo 2s (com backoff). Era 1000ms.
    _lastSyncAttempt: 0,   // para calcular latencia no indicador
    // v17.05: quando houve a ultima alteracao real (minha ou de outro PC).
    // O sync consulta o servidor com mais frequencia logo apos movimento e
    // desacelera quando a pasta esta parada, para nao entupir a rede.
    _ultimaAtividade: 0,
    _syncErrorCount: 0,    // contagem de erros consecutivos para backoff
    _saveTimer: null,
    // v16.22: cache do JSON do componentCatalog. O catalogo tem ~7.900 itens
    // (~600KB) e quase nunca muda, mas era re-serializado a cada gravacao,
    // custando ~50ms de UI travada por save. Agora serializa 1x e reusa.
    _catalogJSONCache: null,
    _syncRefreshTimer: null,          // debounce do redesenho disparado pelo sync
    _writeQueue:  Promise.resolve(),  // fila serializada de saves (nunca descarta)
    _queueDepth:  0,                  // quantos saves estao aguardando na fila
    // v16.32 — TRAVA DE MUTACAO. Enquanto > 0, existe uma operacao critica
    // (ex.: devolucao) que ja alterou State em memoria mas ainda NAO gravou.
    // O sync NAO pode aplicar dados do disco nesse intervalo, senao apaga a
    // alteracao antes dela ser salva (bug "devolucao nao contou").
    _mutating:    0,
    _activityChart: null,
};

// ============================================================
// v16.32 — REDE DE SEGURANCA GLOBAL DE GRAVACAO
// Agora que DB.saveNow() propaga o erro de verdade, qualquer tela que
// grave sem try/catch geraria uma falha silenciosa no console. Este
// listener garante que NENHUMA falha de gravacao passe despercebida:
// o usuario sempre ve um aviso na tela.
// ============================================================
window.addEventListener('unhandledrejection', function (ev) {
    const msg = (ev.reason && (ev.reason.message || ev.reason)) || '';
    console.error('[gravacao] falha nao tratada:', ev.reason);
    try {
        Toast.error('ATENCAO: a ultima acao NAO foi salva no banco de dados. '
                  + 'Verifique a rede e refaca a operacao. (' + String(msg).slice(0, 60) + ')', 10000);
        UI.showSaveIndicator('<i class="fas fa-exclamation-triangle"></i> Nao salvou! Refaca a operacao.', true);
    } catch (_) {}
    ev.preventDefault(); // evita poluir o console do navegador
});
