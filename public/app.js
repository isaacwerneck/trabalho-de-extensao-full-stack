const state = {
  token: sessionStorage.getItem('patasToken'),
  user: null,
  species: '',
  animals: [],
  needs: [],
  admin: { animals: [], adoptions: [], needs: [], donations: [] }
};

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const labels = {
  cao: 'Cão', gato: 'Gato', outro: 'Outro', macho: 'Macho', femea: 'Fêmea', nao_informado: 'Não informado',
  pequeno: 'Pequeno', medio: 'Médio', grande: 'Grande', disponivel: 'Disponível', em_processo: 'Em processo', adotado: 'Adotado',
  recebida: 'Recebida', em_analise: 'Em análise', aprovada: 'Aprovada', recusada: 'Recusada',
  registrada: 'Registrada', confirmada: 'Confirmada', cancelada: 'Cancelada', financeira: 'Financeira', item: 'Item'
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function formatCurrency(value) {
  return Number(value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(`${value.replace(' ', 'T')}Z`));
}

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({ error: 'Resposta inválida do servidor.' }));
  if (!response.ok) {
    if (response.status === 401 && state.token && !path.endsWith('/login')) clearSession();
    throw new Error(payload.error ?? 'Não foi possível concluir a operação.');
  }
  return payload;
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 3500);
}

function feedback(form, message = '', success = false) {
  const element = $('.form-feedback', form);
  element.textContent = message;
  element.classList.toggle('success', success);
}

function setBusy(form, busy) {
  const button = $('button[type="submit"]', form);
  if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? 'Enviando…' : button.dataset.originalText ?? button.textContent;
}

async function loadPublic() {
  try {
    const [stats, animals, needs] = await Promise.all([
      api('/api/stats'), api(`/api/animals?status=disponivel${state.species ? `&species=${state.species}` : ''}`), api('/api/needs')
    ]);
    state.animals = animals;
    state.needs = needs;
    $('#stat-animals').textContent = stats.availableAnimals;
    $('#stat-adoptions').textContent = stats.completedAdoptions;
    $('#stat-needs').textContent = stats.activeNeeds;
    $('#stat-donations').textContent = formatCurrency(stats.confirmedDonations);
    renderAnimals();
    renderNeeds();
  } catch (error) {
    $('#animals-grid').innerHTML = `<div class="empty-state">${escapeHtml(error.message)} <button class="button button-ghost button-small" data-retry>Recarregar</button></div>`;
    $('#needs-grid').innerHTML = '<div class="empty-state">Não foi possível carregar as necessidades.</div>';
  }
}

function renderAnimals() {
  const grid = $('#animals-grid');
  if (!state.animals.length) {
    grid.innerHTML = '<div class="empty-state">Nenhum animal encontrado neste filtro.</div>';
    return;
  }
  grid.innerHTML = state.animals.map(animal => {
    const icon = animal.species === 'gato' ? '🐈' : animal.species === 'cao' ? '🐕' : '🐾';
    const media = animal.photoUrl
      ? `<img src="${escapeHtml(animal.photoUrl)}" alt="${escapeHtml(animal.name)}, disponível para adoção" loading="lazy">`
      : `<span class="animal-placeholder" role="img" aria-label="Representação de ${escapeHtml(animal.name)}">${icon}</span>`;
    return `<article class="animal-card">
      <div class="animal-media">${media}<span class="status-badge">Para adoção</span></div>
      <div class="animal-content"><div class="animal-title-row"><h3>${escapeHtml(animal.name)}</h3><span>${escapeHtml(labels[animal.species])}</span></div>
      <div class="animal-tags"><span>${escapeHtml(labels[animal.sex])}</span><span>${animal.ageYears} ${animal.ageYears === 1 ? 'ano' : 'anos'}</span><span>Porte ${escapeHtml(labels[animal.size]).toLowerCase()}</span></div>
      <p>${escapeHtml(animal.description)}</p><button class="button button-primary" data-adopt="${animal.id}">Quero conhecer ${escapeHtml(animal.name)}</button></div>
    </article>`;
  }).join('');
}

function renderNeeds() {
  const grid = $('#needs-grid');
  if (!state.needs.length) {
    grid.innerHTML = '<div class="empty-state">As necessidades estão atendidas neste momento. Obrigado!</div>';
    return;
  }
  grid.innerHTML = state.needs.map(need => {
    const percent = Math.min(100, Math.round((need.currentQuantity / need.targetQuantity) * 100));
    return `<article class="need-card"><div class="need-top"><h3>${escapeHtml(need.title)}</h3><span class="priority priority-${need.priority}">${escapeHtml(need.priority)}</span></div>
      <p>${escapeHtml(need.description)}</p><div class="progress-track" aria-label="${percent}% da meta"><i style="width:${percent}%"></i></div>
      <div class="need-progress"><span>${need.currentQuantity} ${escapeHtml(need.unit)}</span><span>Meta: ${need.targetQuantity} ${escapeHtml(need.unit)}</span></div></article>`;
  }).join('');
}

function openDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog && !dialog.open) dialog.showModal();
}

function closeMenu() {
  $('#main-nav').classList.remove('open');
  $('#menu-toggle').setAttribute('aria-expanded', 'false');
  $('.sr-only', $('#menu-toggle')).textContent = 'Abrir menu';
}

function clearSession() {
  state.token = null;
  state.user = null;
  sessionStorage.removeItem('patasToken');
  $('#admin-panel').hidden = true;
}

async function restoreSession() {
  if (!state.token) return;
  try {
    const { user } = await api('/api/auth/me');
    state.user = user;
    showAdmin();
  } catch {
    clearSession();
  }
}

async function showAdmin() {
  $('#admin-panel').hidden = false;
  $('#admin-greeting').textContent = `Olá, ${state.user.name}.`;
  await loadAdmin();
  $('#admin-panel').scrollIntoView({ behavior: 'smooth' });
}

async function loadAdmin() {
  try {
    const [animals, adoptions, needs, donations] = await Promise.all([
      api('/api/animals'), api('/api/adoptions'), api('/api/admin/needs'), api('/api/donations')
    ]);
    state.admin = { animals, adoptions, needs, donations };
    renderAdminAnimals(); renderAdminAdoptions(); renderAdminNeeds(); renderAdminDonations();
  } catch (error) {
    toast(error.message);
  }
}

function renderAdminAnimals() {
  $('#admin-animals').innerHTML = state.admin.animals.length ? state.admin.animals.map(a => `<article class="data-row"><div><strong>${escapeHtml(a.name)}</strong><small>${escapeHtml(labels[a.species])} • ${a.ageYears} anos</small></div><span class="priority priority-${a.status === 'disponivel' ? 'baixa' : a.status === 'em_processo' ? 'media' : 'alta'}">${escapeHtml(labels[a.status])}</span><small>${escapeHtml(a.description.slice(0, 90))}${a.description.length > 90 ? '…' : ''}</small><div class="row-actions"><button class="button button-ghost button-small" data-edit-animal="${a.id}">Editar</button><button class="button button-danger button-small" data-delete-animal="${a.id}">Excluir</button></div></article>`).join('') : '<div class="empty-state">Nenhum animal cadastrado.</div>';
}

function renderAdminAdoptions() {
  $('#admin-adoptions').innerHTML = state.admin.adoptions.length ? state.admin.adoptions.map(a => `<article class="data-row"><div><strong>${escapeHtml(a.applicantName)}</strong><small>${escapeHtml(a.email)} • ${escapeHtml(a.phone)}</small></div><div><strong>${escapeHtml(a.animalName)}</strong><small>${formatDate(a.createdAt)}</small></div><small>${escapeHtml(a.reason.slice(0, 100))}${a.reason.length > 100 ? '…' : ''}</small><div class="row-actions"><label class="sr-only" for="adoption-status-${a.id}">Status da solicitação</label><select id="adoption-status-${a.id}" class="inline-select" data-adoption-status="${a.id}">${['recebida','em_analise','aprovada','recusada'].map(s => `<option value="${s}" ${a.status === s ? 'selected' : ''}>${labels[s]}</option>`).join('')}</select></div></article>`).join('') : '<div class="empty-state">Nenhuma solicitação recebida.</div>';
}

function renderAdminNeeds() {
  $('#admin-needs').innerHTML = state.admin.needs.length ? state.admin.needs.map(n => `<article class="data-row"><div><strong>${escapeHtml(n.title)}</strong><small>${escapeHtml(n.description)}</small></div><span class="priority priority-${n.priority}">${escapeHtml(n.priority)}</span><small>${n.currentQuantity} de ${n.targetQuantity} ${escapeHtml(n.unit)} • ${n.active ? 'Ativa' : 'Inativa'}</small><div class="row-actions"><button class="button button-ghost button-small" data-edit-need="${n.id}">Editar</button><button class="button button-danger button-small" data-delete-need="${n.id}">Excluir</button></div></article>`).join('') : '<div class="empty-state">Nenhuma necessidade cadastrada.</div>';
}

function renderAdminDonations() {
  $('#admin-donations').innerHTML = state.admin.donations.length ? state.admin.donations.map(d => `<article class="data-row"><div><strong>${escapeHtml(d.donorName)}</strong><small>${escapeHtml(d.email)}</small></div><div><strong>${escapeHtml(labels[d.type])}</strong><small>${d.type === 'financeira' ? formatCurrency(d.amount) : escapeHtml(d.itemDescription)}</small></div><small>${formatDate(d.createdAt)}</small><div class="row-actions"><label class="sr-only" for="donation-status-${d.id}">Status da doação</label><select id="donation-status-${d.id}" class="inline-select" data-donation-status="${d.id}">${['registrada','confirmada','cancelada'].map(s => `<option value="${s}" ${d.status === s ? 'selected' : ''}>${labels[s]}</option>`).join('')}</select></div></article>`).join('') : '<div class="empty-state">Nenhuma doação registrada.</div>';
}

function fillForm(form, values) {
  Object.entries(values).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (!field) return;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = value ?? '';
  });
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

document.addEventListener('click', async event => {
  const openButton = event.target.closest('[data-open]');
  if (openButton) {
    openDialog(openButton.dataset.open);
    if (openButton.closest('#main-nav')) closeMenu();
  }
  if (event.target.closest('[data-retry]')) loadPublic();

  const adoptButton = event.target.closest('[data-adopt]');
  if (adoptButton) {
    const animal = state.animals.find(item => item.id === Number(adoptButton.dataset.adopt));
    $('#adoption-form').reset();
    $('#adoption-form').elements.animalId.value = animal.id;
    $('#adoption-animal-label').textContent = `Você está demonstrando interesse em adotar ${animal.name}.`;
    feedback($('#adoption-form'));
    openDialog('adoption-dialog');
  }

  const editAnimal = event.target.closest('[data-edit-animal]');
  if (editAnimal) {
    const animal = state.admin.animals.find(item => item.id === Number(editAnimal.dataset.editAnimal));
    $('#animal-form').reset(); fillForm($('#animal-form'), animal); $('#animal-dialog-title').textContent = `Editar ${animal.name}`; feedback($('#animal-form')); openDialog('animal-dialog');
  }
  const deleteAnimal = event.target.closest('[data-delete-animal]');
  if (deleteAnimal && confirm('Excluir este animal? Esta ação não pode ser desfeita.')) {
    try { await api(`/api/animals/${deleteAnimal.dataset.deleteAnimal}`, { method: 'DELETE' }); toast('Animal excluído.'); await Promise.all([loadAdmin(), loadPublic()]); } catch (error) { toast(error.message); }
  }
  const editNeed = event.target.closest('[data-edit-need]');
  if (editNeed) {
    const need = state.admin.needs.find(item => item.id === Number(editNeed.dataset.editNeed));
    $('#need-form').reset(); fillForm($('#need-form'), need); $('#need-dialog-title').textContent = `Editar ${need.title}`; feedback($('#need-form')); openDialog('need-dialog');
  }
  const deleteNeed = event.target.closest('[data-delete-need]');
  if (deleteNeed && confirm('Excluir esta necessidade?')) {
    try { await api(`/api/needs/${deleteNeed.dataset.deleteNeed}`, { method: 'DELETE' }); toast('Necessidade excluída.'); await Promise.all([loadAdmin(), loadPublic()]); } catch (error) { toast(error.message); }
  }
});

document.addEventListener('change', async event => {
  if (event.target.matches('[data-adoption-status]')) {
    try { await api(`/api/adoptions/${event.target.dataset.adoptionStatus}/status`, { method: 'PATCH', body: JSON.stringify({ status: event.target.value }) }); toast('Status da adoção atualizado.'); await Promise.all([loadAdmin(), loadPublic()]); } catch (error) { toast(error.message); await loadAdmin(); }
  }
  if (event.target.matches('[data-donation-status]')) {
    try { await api(`/api/donations/${event.target.dataset.donationStatus}/status`, { method: 'PATCH', body: JSON.stringify({ status: event.target.value }) }); toast('Status da doação atualizado.'); await Promise.all([loadAdmin(), loadPublic()]); } catch (error) { toast(error.message); await loadAdmin(); }
  }
});

$('#menu-toggle').addEventListener('click', event => {
  const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
  event.currentTarget.setAttribute('aria-expanded', String(!expanded));
  $('#main-nav').classList.toggle('open', !expanded);
  $('.sr-only', event.currentTarget).textContent = expanded ? 'Abrir menu' : 'Fechar menu';
});
$$('#main-nav a').forEach(link => link.addEventListener('click', closeMenu));
$$('.dialog-close').forEach(button => button.addEventListener('click', event => { event.preventDefault(); button.closest('dialog').close(); }));
$$('.filter').forEach(button => button.addEventListener('click', async () => { $$('.filter').forEach(item => item.classList.remove('is-active')); button.classList.add('is-active'); state.species = button.dataset.species; $('#animals-grid').innerHTML = '<div class="loading-card">Atualizando lista…</div>'; await loadPublic(); }));

$('#donation-form').elements.type.addEventListener('change', event => {
  const financial = event.target.value === 'financeira';
  $('[data-donation-field="amount"]').hidden = !financial;
  $('[data-donation-field="item"]').hidden = financial;
  $('#donation-form').elements.amount.required = financial;
  $('#donation-form').elements.itemDescription.required = !financial;
});

$('#adoption-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; feedback(form); setBusy(form, true);
  const data = formData(form); data.hasOtherPets = form.elements.hasOtherPets.checked;
  try { const result = await api('/api/adoptions', { method: 'POST', body: JSON.stringify(data) }); feedback(form, result.message, true); form.reset(); setTimeout(() => form.closest('dialog').close(), 1800); toast('Solicitação enviada com sucesso.'); }
  catch (error) { feedback(form, error.message); } finally { setBusy(form, false); }
});

$('#donation-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; feedback(form); setBusy(form, true);
  const data = formData(form); if (data.type === 'item') delete data.amount; else delete data.itemDescription;
  try { const result = await api('/api/donations', { method: 'POST', body: JSON.stringify(data) }); feedback(form, result.message, true); form.reset(); setTimeout(() => form.closest('dialog').close(), 1800); toast('Doação registrada. Obrigado!'); }
  catch (error) { feedback(form, error.message); } finally { setBusy(form, false); }
});

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; feedback(form); setBusy(form, true);
  try { const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(formData(form)) }); state.token = result.token; state.user = result.user; sessionStorage.setItem('patasToken', state.token); form.closest('dialog').close(); form.reset(); toast('Acesso liberado.'); await showAdmin(); }
  catch (error) { feedback(form, error.message); } finally { setBusy(form, false); }
});

$('#animal-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; feedback(form); setBusy(form, true); const data = formData(form); const id = data.id; delete data.id;
  try { await api(id ? `/api/animals/${id}` : '/api/animals', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) }); form.closest('dialog').close(); toast(id ? 'Animal atualizado.' : 'Animal cadastrado.'); await Promise.all([loadAdmin(), loadPublic()]); }
  catch (error) { feedback(form, error.message); } finally { setBusy(form, false); }
});

$('#need-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; feedback(form); setBusy(form, true); const data = formData(form); const id = data.id; delete data.id; data.active = form.elements.active.checked;
  try { await api(id ? `/api/needs/${id}` : '/api/needs', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) }); form.closest('dialog').close(); toast(id ? 'Necessidade atualizada.' : 'Necessidade cadastrada.'); await Promise.all([loadAdmin(), loadPublic()]); }
  catch (error) { feedback(form, error.message); } finally { setBusy(form, false); }
});

$('#new-animal').addEventListener('click', () => { $('#animal-form').reset(); $('#animal-form').elements.id.value = ''; $('#animal-dialog-title').textContent = 'Novo animal'; feedback($('#animal-form')); openDialog('animal-dialog'); });
$('#new-need').addEventListener('click', () => { $('#need-form').reset(); $('#need-form').elements.id.value = ''; $('#need-dialog-title').textContent = 'Nova necessidade'; feedback($('#need-form')); openDialog('need-dialog'); });
$('#logout-button').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST' }); } catch {} clearSession(); toast('Sessão encerrada.'); window.scrollTo({ top: 0, behavior: 'smooth' }); });

$$('[data-admin-tab]').forEach(tab => tab.addEventListener('click', () => {
  $$('[data-admin-tab]').forEach(item => item.setAttribute('aria-selected', String(item === tab)));
  $$('[data-admin-view]').forEach(view => { view.hidden = view.dataset.adminView !== tab.dataset.adminTab; });
}));

document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
$('#year').textContent = new Date().getFullYear();
await loadPublic();
await restoreSession();
