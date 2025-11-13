// Lógica do painel administrativo extraída para arquivo externo (compatível com CSP)
(function(){
  const apiBase = (window.API_BASE || (window.location.port === '3002' ? 'https://127.0.0.1:3001' : window.location.origin)).replace(/\/$/, '');

  function fmtDate(ts) {
    if (!ts) return '-';
    const d = new Date(Number(ts));
    return d.toLocaleString('pt-BR');
  }
  function daysLeft(ts) {
    if (!ts) return '-';
    const diff = Number(ts) - Date.now();
    if (diff <= 0) return 'expirado';
    return Math.ceil(diff / (24*60*60*1000)) + 'd';
  }
  function getAdminToken() {
    // Migração para cookies HttpOnly: não usamos mais token Bearer.
    // Retorna um valor truthy se a sessão atual é admin, para preservar checks existentes.
    const role = localStorage.getItem('authRole') || '';
    return role === 'admin' ? 'cookie' : '';
  }
  function setAdminStatus(text) { const el = document.getElementById('admin-login-status'); if (el) el.textContent = text || ''; }
  function setListStatus(text) { const el = document.getElementById('list-status'); if (el) el.textContent = text || ''; }
  function setCreateStatus(text) { const el = document.getElementById('create-status'); if (el) el.textContent = text || ''; }

  async function adminLogin() {
    const username = document.getElementById('admin-user').value.trim();
    const password = document.getElementById('admin-pass').value.trim();
    setAdminStatus('Entrando...');
    try {
      const res = await authFetch(apiBase + '/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { username, password }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha no login');
      // Define sessão local baseada em papel; cookies já foram setados pelo backend
      try { localStorage.removeItem('adminToken'); } catch(_){}
      localStorage.setItem('authRole', 'admin');
      localStorage.setItem('authUser', data.user?.username || username);
      setAdminStatus('Conectado como ' + (data.user?.username || username));
      // Opcional: carregar usuários automaticamente após login
      try { loadUsers(); } catch(_){}
    } catch (e) {
      setAdminStatus('Erro: ' + e.message);
    }
  }
  function adminLogout() {
    // Limpa cookie de autenticação no backend e estado local
    try { authFetch(apiBase + '/logout', { method: 'POST' }); } catch(_){}
    try {
      localStorage.removeItem('adminToken');
      localStorage.removeItem('authToken');
      localStorage.removeItem('authRole');
      localStorage.removeItem('authUser');
      localStorage.removeItem('authCredits');
    } catch(_){}
    setAdminStatus('Desconectado');
  }

  async function createUser() {
    const isAdmin = !!getAdminToken();
    if (!isAdmin) { setCreateStatus('Faça login como admin.'); return; }
    const username = document.getElementById('new-username').value.trim();
    const password = document.getElementById('new-password').value.trim();
    const role = String(document.getElementById('new-role')?.value || 'user');
    const days = Number(document.getElementById('new-days').value || 30);
    const credits = Math.max(0, Number(document.getElementById('new-credits')?.value || 0));
    const chat_id = String(document.getElementById('new-chat-id')?.value || '').trim();
    setCreateStatus('Criando...');
    try {
      const res = await authFetch(apiBase + '/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { username, password, role, days, credits, chat_id }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao criar usuário');
      setCreateStatus('Usuário criado (id ' + data.id + ')');
      loadUsers();
    } catch (e) { setCreateStatus('Erro: ' + e.message); }
  }

  // Ajusta validade quando papel for admin (admins não possuem validade)
  function setupRoleDaysToggle(){
    try {
      const roleSel = document.getElementById('new-role');
      const daysInput = document.getElementById('new-days');
      const update = () => {
        const isAdmin = String(roleSel.value || 'user') === 'admin';
        if (daysInput) {
          daysInput.disabled = isAdmin;
          daysInput.title = isAdmin ? 'Administradores não possuem validade' : '';
        }
      };
      if (roleSel) {
        roleSel.addEventListener('change', update);
        update();
      }
    } catch (_) {}
  }

  async function loadUsers() {
    const isAdmin = !!getAdminToken();
    if (!isAdmin) { setListStatus('Faça login como admin.'); return; }
    setListStatus('Carregando...');
    try {
      const res = await authFetch(apiBase + '/admin/users');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao listar usuários');
      renderUsers(data.users || []);
      setListStatus('');
    } catch (e) { setListStatus('Erro: ' + e.message); }
  }

  function renderUsers(users) {
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = '';
    const adminCount = Array.isArray(users) ? users.filter(x => String(x.role) === 'admin').length : 0;
    users.forEach(u => {
      const tr = document.createElement('tr');
      tr.className = 'user-row';
      tr.setAttribute('data-user-id', u.id);
      tr.innerHTML = `
        <td>${u.id}</td>
        <td>${u.username} <span class="tag ${u.role === 'admin' ? 'blue' : ''}">${u.role === 'admin' ? 'admin' : 'usuário'}</span></td>
        <td>${u.active ? '<span class="tag green">ativo</span>' : '<span class="tag red">inativo</span>'}</td>
        <td>${fmtDate(u.expires_at)} <span class="muted">(${daysLeft(u.expires_at)})</span></td>
        <td>${typeof u.credits === 'number' ? u.credits : 0}</td>
        <td>${u.message_count}</td>
        <td>${u.chat_id ? String(u.chat_id) : '-'}</td>
        <td class="expand-indicator"><span class="expand-arrow">▼</span></td>
      `;
      const expandRow = document.createElement('tr');
      expandRow.className = 'user-actions-row';
      expandRow.style.display = 'none';
      expandRow.innerHTML = `
        <td colspan="8">
          <div class="user-actions-container">
            <div class="user-actions-grid" id="actions-${u.id}"></div>
          </div>
        </td>
      `;
      tr.addEventListener('click', () => toggleUserActions(u.id));
      tr.style.cursor = 'pointer';
      const actionsContainer = expandRow.querySelector(`#actions-${u.id}`);
      if (String(u.role) === 'admin') {
        actionsContainer.classList.add('admin-actions');
      }
      if (String(u.role) !== 'admin') {
        actionsContainer.appendChild(actionBtn('Ativar', () => updateUser(u.id, { active: 1 })));
        actionsContainer.appendChild(actionBtn('Inativar', () => updateUser(u.id, { active: 0 })));
      }
      actionsContainer.appendChild(actionBtn('Alterar senha', () => openPasswordModal(u.id)));
      if (String(u.role) === 'admin') {
        actionsContainer.appendChild(actionBtn('Definir créditos', () => openCreditsModal(u.id, Number(u.credits || 0))));
        actionsContainer.appendChild(actionBtn('Alterar nome', () => openUsernameModal(u.id, String(u.username || ''))));
        actionsContainer.appendChild(actionBtn('Alterar chat ID', () => openChatIdModal(u.id, String(u.chat_id || ''))));
      } else {
        actionsContainer.appendChild(actionBtn('Definir créditos', () => openTransferModal(u.id, Number(u.credits || 0))));
        actionsContainer.appendChild(actionBtn('Adicionar dias', () => openAddDaysModal(u.id, Number(u.expires_at || 0))));
        actionsContainer.appendChild(actionBtn('Alterar chat ID', () => openChatIdModal(u.id, String(u.chat_id || ''))));
      }
      if (String(u.role) !== 'admin') {
        actionsContainer.appendChild(actionBtn('Zerar créditos', () => updateUser(u.id, { credits: 0 })));
        actionsContainer.appendChild(actionBtn('Remover usuário', () => deleteUser(u.id), 'btn-danger'));
      } else {
        if (adminCount >= 2) {
          actionsContainer.appendChild(actionBtn('Remover usuário', () => deleteUser(u.id), 'btn-danger'));
        }
      }
      tbody.appendChild(tr);
      tbody.appendChild(expandRow);
    });
  }

  function actionBtn(text, handler, cls='btn') {
    const b = document.createElement('button');
    b.className = cls; b.textContent = text; b.onclick = handler; return b;
  }

  function toggleUserActions(userId) {
    const userRow = document.querySelector(`tr[data-user-id="${userId}"]`);
    const actionsRow = userRow.nextElementSibling;
    const arrow = userRow.querySelector('.expand-arrow');
    if (actionsRow.style.display === 'none') {
      document.querySelectorAll('.user-actions-row').forEach(row => { row.style.display = 'none'; });
      document.querySelectorAll('.expand-arrow').forEach(arr => { arr.textContent = '▼'; arr.parentElement.parentElement.classList.remove('expanded'); });
      actionsRow.style.display = 'table-row';
      arrow.textContent = '▲';
      userRow.classList.add('expanded');
    } else {
      actionsRow.style.display = 'none';
      arrow.textContent = '▼';
      userRow.classList.remove('expanded');
    }
  }

  async function updateUser(id, payload) {
    const isAdmin = !!getAdminToken();
    if (!isAdmin) { alert('Faça login como admin'); return; }
    try {
      const res = await authFetch(apiBase + '/admin/users/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha na atualização');
      loadUsers();
    } catch (e) { alert('Erro: ' + e.message); }
  }

  // Transferir créditos
  let transferModalUserId = null;
  let transferModalUserCredits = 0;
  function openTransferModal(userId, currentCredits) {
    transferModalUserId = userId;
    transferModalUserCredits = Number(currentCredits || 0);
    const input = document.getElementById('transfer-modal-input');
    const status = document.getElementById('transfer-modal-status');
    const info = document.getElementById('transfer-modal-info');
    status.textContent = '';
    input.value = '1';
    info.textContent = 'Créditos atuais do usuário: ' + transferModalUserCredits + '. Isso debita do admin.';
    document.getElementById('transfer-modal').style.display = 'flex';
    setTimeout(() => { try { input.focus(); } catch(_){} }, 0);
  }
  function closeTransferModal() {
    transferModalUserId = null;
    transferModalUserCredits = 0;
    document.getElementById('transfer-modal').style.display = 'none';
  }
  async function submitTransferModal() {
    const input = document.getElementById('transfer-modal-input');
    const status = document.getElementById('transfer-modal-status');
    const amount = Math.max(0, Number(input.value || 0));
    if (!amount) { status.textContent = 'Informe um valor maior que 0'; return; }
    status.textContent = 'Transferindo...';
    try { await transferCredits(transferModalUserId, amount); closeTransferModal(); }
    catch (e) { status.textContent = 'Erro: ' + (e?.message || e); }
  }
  async function transferCredits(id, amount) {
    const isAdmin = !!getAdminToken();
    if (!isAdmin) { alert('Faça login como admin'); return; }
    try {
      const res = await authFetch(apiBase + '/admin/users/' + id + '/transfer-credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { amount }
      });
      const data = await res.json();
      if (!res.ok) { alert(data?.error || 'Falha na transferência'); return; }
      loadUsers();
    } catch (e) { alert('Erro: ' + e.message); }
  }

  // Adicionar dias
  let addDaysModalUserId = null;
  let addDaysModalCurrentExp = 0;
  function openAddDaysModal(userId, currentExpTs) {
    addDaysModalUserId = userId;
    addDaysModalCurrentExp = Number(currentExpTs || 0);
    const input = document.getElementById('add-days-modal-input');
    const status = document.getElementById('add-days-modal-status');
    const info = document.getElementById('add-days-modal-info');
    status.textContent = '';
    input.value = '1';
    const now = Date.now();
    const base = addDaysModalCurrentExp && addDaysModalCurrentExp > now ? addDaysModalCurrentExp : now;
    info.textContent = 'Validade atual: ' + (addDaysModalCurrentExp ? new Date(addDaysModalCurrentExp).toLocaleString('pt-BR') : 'não definida/expirada') + '. Isto soma dias ao prazo.';
    document.getElementById('add-days-modal').style.display = 'flex';
    setTimeout(() => { try { input.focus(); } catch(_){} }, 0);
  }
  function closeAddDaysModal() {
    addDaysModalUserId = null;
    addDaysModalCurrentExp = 0;
    document.getElementById('add-days-modal').style.display = 'none';
  }
  async function submitAddDaysModal() {
    const input = document.getElementById('add-days-modal-input');
    const status = document.getElementById('add-days-modal-status');
    const days = Math.max(1, Math.min(30, Number(input.value || 0)));
    if (!days) { status.textContent = 'Informe de 1 a 30 dias'; return; }
    status.textContent = 'Atualizando...';
    try { await addDays(addDaysModalUserId, days); closeAddDaysModal(); }
    catch (e) { status.textContent = 'Erro: ' + (e?.message || e); }
  }
  async function addDays(id, days) {
    const isAdmin = !!getAdminToken();
    if (!isAdmin) { alert('Faça login como admin'); return; }
    try {
      const res = await authFetch(apiBase + '/admin/users/' + id + '/add-days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { days }
      });
      const data = await res.json();
      if (!res.ok) { alert(data?.error || 'Falha ao adicionar dias'); return; }
      loadUsers();
    } catch (e) { alert('Erro: ' + e.message); }
  }

  // Alterar senha
  let passwordModalUserId = null;
  function openPasswordModal(userId) {
    passwordModalUserId = userId;
    const input = document.getElementById('password-modal-input');
    const status = document.getElementById('password-modal-status');
    status.textContent = '';
    input.value = '';
    document.getElementById('password-modal').style.display = 'flex';
    setTimeout(() => { try { input.focus(); } catch(_){} }, 0);
  }
  function closePasswordModal() {
    passwordModalUserId = null;
    document.getElementById('password-modal').style.display = 'none';
  }
  async function submitPasswordModal() {
    const input = document.getElementById('password-modal-input');
    const status = document.getElementById('password-modal-status');
    const p = (input.value || '').trim();
    if (!p) { status.textContent = 'Informe uma senha.'; return; }
    status.textContent = 'Atualizando...';
    try { await updateUser(passwordModalUserId, { password: p }); closePasswordModal(); }
    catch (e) { status.textContent = 'Erro: ' + (e?.message || e); }
  }

  // Definir créditos (admin)
  let creditsModalUserId = null;
  let creditsModalCurrent = 0;
  function openCreditsModal(userId, currentCredits) {
    creditsModalUserId = userId;
    creditsModalCurrent = Number(currentCredits || 0);
    const input = document.getElementById('credits-modal-input');
    const status = document.getElementById('credits-modal-status');
    const info = document.getElementById('credits-modal-info');
    status.textContent = '';
    input.value = '0';
    info.textContent = 'Créditos atuais: ' + creditsModalCurrent + ' | Informe quanto deseja adicionar.';
    document.getElementById('credits-modal').style.display = 'flex';
    setTimeout(() => { try { input.focus(); } catch(_){} }, 0);
  }
  function closeCreditsModal() {
    creditsModalUserId = null;
    creditsModalCurrent = 0;
    document.getElementById('credits-modal').style.display = 'none';
  }
  async function submitCreditsModal() {
    const input = document.getElementById('credits-modal-input');
    const status = document.getElementById('credits-modal-status');
    const add = Math.max(0, Number(input.value || 0));
    status.textContent = 'Atualizando...';
    const next = Math.max(0, creditsModalCurrent + add);
    try { await updateUser(creditsModalUserId, { credits: next }); closeCreditsModal(); }
    catch (e) { status.textContent = 'Erro: ' + (e?.message || e); }
  }

  // Alterar nome de usuário (admin)
  let usernameModalUserId = null;
  let usernameModalCurrent = '';
  function openUsernameModal(userId, currentUsername) {
    usernameModalUserId = userId;
    usernameModalCurrent = String(currentUsername || '');
    const input = document.getElementById('username-modal-input');
    const status = document.getElementById('username-modal-status');
    const info = document.getElementById('username-modal-info');
    status.textContent = '';
    input.value = usernameModalCurrent;
    info.textContent = 'Nome atual: ' + usernameModalCurrent;
    document.getElementById('username-modal').style.display = 'flex';
    setTimeout(() => { try { input.focus(); } catch(_){} }, 0);
  }
  function closeUsernameModal() {
    usernameModalUserId = null;
    usernameModalCurrent = '';
    document.getElementById('username-modal').style.display = 'none';
  }
  async function submitUsernameModal() {
    const input = document.getElementById('username-modal-input');
    const status = document.getElementById('username-modal-status');
    const name = String((input.value || '').trim());
    if (!name || name.length < 3) { status.textContent = 'Informe ao menos 3 caracteres'; return; }
    status.textContent = 'Atualizando...';
    try {
      await updateUser(usernameModalUserId, { username: name });
      closeUsernameModal();
      try { const authRole = localStorage.getItem('authRole') || ''; if (authRole === 'admin') localStorage.setItem('authUser', name); } catch (_) {}
    } catch (e) {
      status.textContent = 'Erro: ' + (e?.message || e);
    }
  }

  async function deleteUser(id) {
    const isAdmin = !!getAdminToken();
    if (!isAdmin) { alert('Faça login como admin'); return; }
    if (!confirm('Remover usuário #' + id + '?')) return;
    try {
      const res = await authFetch(apiBase + '/admin/users/' + id, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao remover');
      loadUsers();
    } catch (e) { alert('Erro: ' + e.message); }
  }

  let chatIdModalUserId = null;
  let chatIdModalCurrent = '';
  function openChatIdModal(userId, currentChatId) {
    chatIdModalUserId = userId;
    chatIdModalCurrent = String(currentChatId || '');
    const input = document.getElementById('chatid-modal-input');
    const status = document.getElementById('chatid-modal-status');
    const info = document.getElementById('chatid-modal-info');
    status.textContent = '';
    input.value = chatIdModalCurrent || '';
    info.textContent = 'Chat ID atual: ' + (chatIdModalCurrent || '-');
    document.getElementById('chatid-modal').style.display = 'flex';
    setTimeout(() => { try { input.focus(); } catch(_){} }, 0);
  }
  function closeChatIdModal() {
    chatIdModalUserId = null;
    chatIdModalCurrent = '';
    document.getElementById('chatid-modal').style.display = 'none';
  }
  async function submitChatIdModal() {
    const input = document.getElementById('chatid-modal-input');
    const status = document.getElementById('chatid-modal-status');
    const val = String((input.value || '').trim());
    if (!val) { status.textContent = 'Informe um chat ID'; return; }
    status.textContent = 'Atualizando...';
    try { await updateUser(chatIdModalUserId, { chat_id: val }); closeChatIdModal(); }
    catch (e) { status.textContent = 'Erro: ' + (e?.message || e); }
  }

  function setupAdminSessionUI() {
    const loginCard = document.getElementById('admin-login-card');
    const username = localStorage.getItem('authUser') || '';
    const role = localStorage.getItem('authRole') || '';
    if (role === 'admin') {
      if (loginCard) loginCard.style.display = 'none';
      setAdminStatus('Conectado como ' + (username || 'admin'));
      try { loadUsers(); } catch (_) {}
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    // Botões principais
    const backBtn = document.getElementById('back-btn');
if (backBtn) backBtn.addEventListener('click', () => { window.location.href = '/dashboard'; });
    const loginBtn = document.getElementById('admin-login-btn');
    if (loginBtn) loginBtn.addEventListener('click', adminLogin);
    const logoutBtn = document.getElementById('admin-logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', adminLogout);
    const createBtn = document.getElementById('create-user-btn');
    if (createBtn) createBtn.addEventListener('click', createUser);
    const refreshBtn = document.getElementById('refresh-users-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', loadUsers);

    // Modais: senhas
    const pwCancel = document.getElementById('password-cancel-btn');
    if (pwCancel) pwCancel.addEventListener('click', closePasswordModal);
    const pwSave = document.getElementById('password-save-btn');
    if (pwSave) pwSave.addEventListener('click', submitPasswordModal);

    // Modais: créditos
    const crCancel = document.getElementById('credits-cancel-btn');
    if (crCancel) crCancel.addEventListener('click', closeCreditsModal);
    const crSave = document.getElementById('credits-save-btn');
    if (crSave) crSave.addEventListener('click', submitCreditsModal);

    // Modais: transferência
    const trCancel = document.getElementById('transfer-cancel-btn');
    if (trCancel) trCancel.addEventListener('click', closeTransferModal);
    const trSave = document.getElementById('transfer-save-btn');
    if (trSave) trSave.addEventListener('click', submitTransferModal);

    // Modais: adicionar dias
    const adCancel = document.getElementById('add-days-cancel-btn');
    if (adCancel) adCancel.addEventListener('click', closeAddDaysModal);
    const adSave = document.getElementById('add-days-save-btn');
    if (adSave) adSave.addEventListener('click', submitAddDaysModal);

    // Modais: alterar nome
    const unCancel = document.getElementById('username-cancel-btn');
    if (unCancel) unCancel.addEventListener('click', closeUsernameModal);
    const unSave = document.getElementById('username-save-btn');
    if (unSave) unSave.addEventListener('click', submitUsernameModal);

    const cidCancel = document.getElementById('chatid-cancel-btn');
    if (cidCancel) cidCancel.addEventListener('click', closeChatIdModal);
    const cidSave = document.getElementById('chatid-save-btn');
    if (cidSave) cidSave.addEventListener('click', submitChatIdModal);

    // Auto-preencher usuário admin padrão
    try { const adminUserInput = document.getElementById('admin-user'); if (adminUserInput) adminUserInput.value = 'admin'; } catch(_){}

    // Configurar toggle de dias por papel
    setupRoleDaysToggle();

    // Configurar UI conforme sessão
    setupAdminSessionUI();
  });
})();