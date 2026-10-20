// ==========================================================================
// SPARE PARTS - 99-boot.js (extraido do v16.32)
// ==========================================================================

// ============================================================
// INICIALIZACAO E EVENTOS GLOBAIS
// ============================================================

// Salvamento automatico com debounce (substituindo o event listener global raw)
let _globalSaveTimer = null;
function scheduleSave() {
    if (State.dbFileHandle && State.currentUser) {
        clearTimeout(_globalSaveTimer);
        _globalSaveTimer = setTimeout(() => DB.save(true), 400);
    }
}
document.addEventListener('click',  scheduleSave);
document.addEventListener('change', scheduleSave);

// Enter no login
document.getElementById('userPass').addEventListener('keydown', e => { if (e.key === 'Enter') Auth.attemptUserLogin(); });
// admPassInput removido — login de admin agora usa o fluxo normal de matricula+senha

// Drag & Drop global
document.addEventListener('dragover',  e => { e.preventDefault(); document.getElementById('dragOverlay').style.display = 'flex'; });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.getElementById('dragOverlay').style.display = 'none'; });
document.addEventListener('drop', e => {
    e.preventDefault();
    document.getElementById('dragOverlay').style.display = 'none';
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv'))) {
        Feeder.processFile(file);
        UI.navUser('feeder');
    } else {
        Toast.warn('Apenas arquivos .xlsx, .xls ou .csv sao aceitos.');
    }
});

// Ctrl+Z global: voltna etapa na aba de devolucao
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        const devTab = document.getElementById('tab-devolucao');
        if (devTab && devTab.classList.contains('active') && State.currentUser && !State.currentUser.isAdmin) {
            e.preventDefault();
            Devolucao.goBack();
        }
    }
});

// Inicializa modulo de voz asiatica
VoiceFeedback.init();

// Expoe funcoes criticas globalmente para uso nos atributos onclick do HTML (compatibilidade)
window.UI         = UI;
window.DB         = DB;
window.reconnectDB = DB.reconnect;  // alias para o botao do overlay
window.Auth       = Auth;
window.Feeder     = Feeder;
window.Kitting    = Kitting;
window.Devolucao  = Devolucao;
window.AuditModule = AuditModule;
window.HistoryModule = HistoryModule;
window.StockAdmin = StockAdmin;
window.UserAdmin  = UserAdmin;
// Funcoes de gerenciamento de BD expostas para uso eventual
window.exportCleanDB = UserAdmin.exportCleanDB;
window.createBlankDB = UserAdmin.createBlankDB;




window.Commitment = Commitment;
window.Modal         = Modal;
window.Toast         = Toast;
window.VoiceFeedback = VoiceFeedback;

// Inicializa dots de tentativa de login
UI.updateAttemptDots(0, Security.MAX_LOGIN_ATTEMPTS);

// Tenta reconectar automaticamente ao ultimo JSON usado (memoria do navegador)
DB.tryAutoReconnect();

// Popula data padrao no dashboard removido (agora semanal)
