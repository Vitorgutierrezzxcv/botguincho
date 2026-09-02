(() => {
  'use strict';

  function loadUiLayer() {
    if (!document.querySelector('link[data-tratto-ui]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/tratto-ui.css?v=1';
      link.dataset.trattoUi = '1';
      document.head.appendChild(link);
    }
    document.body.classList.add('tratto-ui');
  }

  function changeButtonText(button, text) {
    if (!button) return;
    [...button.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).forEach((node) => { node.textContent = text; });
  }

  function normalizeNavigation() {
    const dashboard = document.querySelector('.sidebar [data-page="dashboard"]');
    const calls = document.querySelector('.sidebar [data-page="calls"]');
    const fleet = document.querySelector('.sidebar [data-page="fleet"]');
    const pricing = document.querySelector('.sidebar [data-page="pricing"]');
    const config = document.querySelector('.sidebar [data-page="automations"]');
    changeButtonText(dashboard, 'Início');
    changeButtonText(calls, 'Corridas');
    changeButtonText(fleet, 'Motoristas e frota');
    changeButtonText(pricing, 'Valores por cliente');
    changeButtonText(config, 'Configurações');

    const advanced = document.querySelector('.advanced-menu');
    const advancedNav = advanced?.querySelector('.nav');
    const summary = advanced?.querySelector('summary');
    if (summary) summary.textContent = 'Configurações avançadas';
    if (advancedNav) {
      [fleet, pricing].forEach((button) => { if (button && button.parentElement !== advancedNav) advancedNav.prepend(button); });
    }

    document.querySelectorAll('[data-page="tests"]').forEach((node) => node.remove());
    document.querySelectorAll('.nav button').forEach((button) => {
      if ((button.textContent || '').toLowerCase().includes('central de testes')) button.remove();
    });
  }

  function settingsCard(icon, title, description, action) {
    return `<button type="button" class="tratto-settings-card" data-settings-action="${action}"><span class="tratto-settings-icon">${icon}</span><span><b>${title}</b><small>${description}</small></span></button>`;
  }

  function openSettingsTarget(action) {
    const map = {
      driver: 'fleet', vehicle: 'fleet', pricing: 'pricing', groups: 'groups', whatsapp: 'whatsapp', tracker: 'tracker', ai: 'ai', clients: 'clients'
    };
    if (map[action] && typeof showPage === 'function') {
      showPage(map[action]);
      return;
    }
    if (action === 'install') {
      document.getElementById('installBtn')?.click();
      return;
    }
    if (action === 'areas' || action === 'hours') {
      if (typeof showPage === 'function') showPage('automations');
      requestAnimationFrame(() => {
        const target = action === 'hours'
          ? document.getElementById('operatingHoursConfig')
          : document.getElementById('excludedAreaList')?.closest('.card');
        target?.scrollIntoView({ behavior:'smooth', block:'start' });
      });
    }
  }

  function ensureSettingsHub() {
    const page = document.getElementById('automations');
    if (!page) return;
    const head = page.querySelector(':scope > .head');
    const h2 = head?.querySelector('h2');
    const p = head?.querySelector('p');
    if (h2) h2.textContent = 'Configurações';
    if (p) p.textContent = 'Tudo o que muda o funcionamento da operação, separado por assunto.';

    let hub = document.getElementById('trattoSettingsHub');
    if (!hub) {
      hub = document.createElement('div');
      hub.id = 'trattoSettingsHub';
      hub.className = 'tratto-settings-hub';
      hub.innerHTML = `
        <h3>O que você quer configurar?</h3>
        <p>Escolha uma área. As regras continuam ligadas ao Financeiro e ao WhatsApp automaticamente.</p>
        <div class="tratto-settings-grid">
          ${settingsCard('👤','Motorista e pagamentos','Fechamento, repasse e dados do motorista.','driver')}
          ${settingsCard('▰','Veículo e custos','Placa, guincho e dados usados na operação.','vehicle')}
          ${settingsCard('R$','Valores por cliente','Tabelas por grupo, transportadora e tipo de reboque.','pricing')}
          ${settingsCard('⌖','Cidades e bairros','Locais que o motorista não atende.','areas')}
          ${settingsCard('◷','Horários','Dias, horários e resposta fora do expediente.','hours')}
          ${settingsCard('◎','Grupos do WhatsApp','Onde o sistema pode responder.','groups')}
          ${settingsCard('◍','WhatsApp','Conexão e QR Code da sessão.','whatsapp')}
          ${settingsCard('⌖','Rastreador','Localização do caminhão usada nas previsões.','tracker')}
          ${settingsCard('✦','Automação','Comportamento das respostas automáticas.','ai')}
          ${settingsCard('↗','Instalar aplicativo','Adicionar o BotGuincho à tela inicial.','install')}
        </div>`;
      head?.insertAdjacentElement('afterend', hub);
      hub.addEventListener('click', (event) => {
        const button = event.target.closest('[data-settings-action]');
        if (button) openSettingsTarget(button.dataset.settingsAction);
      });
    }

    const directChildren = [...page.children].filter((node) => node !== head && node !== hub);
    directChildren.forEach((node) => node.classList.add('settings-content-block'));
    const automationList = document.getElementById('automationList');
    const automationBlock = automationList?.closest('.grid2');
    if (automationBlock && !automationBlock.previousElementSibling?.classList?.contains('tratto-section-title')) {
      automationBlock.insertAdjacentHTML('beforebegin','<div class="tratto-section-title">Regras automáticas</div>');
    }
    const areasCard = document.getElementById('excludedAreaList')?.closest('.card');
    if (areasCard && !areasCard.previousElementSibling?.classList?.contains('tratto-section-title')) {
      areasCard.insertAdjacentHTML('beforebegin','<div class="tratto-section-title">Regiões atendidas</div>');
    }
    const hoursCard = document.getElementById('operatingHoursConfig');
    if (hoursCard && !hoursCard.previousElementSibling?.classList?.contains('tratto-section-title')) {
      hoursCard.insertAdjacentHTML('beforebegin','<div class="tratto-section-title">Horário de funcionamento</div>');
    }
  }

  function simplifyAvailability() {
    const operations = document.getElementById('operations');
    if (!operations) return;
    const cards = [...operations.querySelectorAll('.card')];
    const card = cards.find((item) => /disponibilidade do guincho/i.test(item.textContent || ''));
    if (!card || card.classList.contains('availability-compact')) return;
    card.classList.add('availability-compact');
    const h3 = card.querySelector('h3');
    const intro = h3?.parentElement?.querySelector('p');
    if (h3) h3.textContent = 'Disponibilidade';
    if (intro) intro.textContent = 'Defina rapidamente se o guincho pode receber novos atendimentos.';

    const secondaryLabels = ['nome do motorista','whatsapp do motorista','placa'];
    card.querySelectorAll('.field').forEach((field) => {
      const label = (field.querySelector('label')?.textContent || '').trim().toLowerCase();
      if (secondaryLabels.includes(label)) field.classList.add('availability-secondary');
    });

    const details = document.createElement('button');
    details.type = 'button';
    details.className = 'btn secondary small availability-details-toggle';
    details.textContent = 'Ver dados do motorista e veículo';
    details.addEventListener('click', () => {
      const opened = card.classList.toggle('show-details');
      details.textContent = opened ? 'Ocultar detalhes' : 'Ver dados do motorista e veículo';
    });
    const actions = card.querySelector('.actions') || card.lastElementChild;
    actions?.insertAdjacentElement('afterend', details);
  }

  function simplifyCopies() {
    const callsPage = document.getElementById('calls');
    const callHead = callsPage?.querySelector(':scope > .head');
    if (callHead?.querySelector('h2')) callHead.querySelector('h2').textContent = 'Corridas';
    if (callHead?.querySelector('p')) callHead.querySelector('p').textContent = 'Cotações, autorizações e corridas em um só lugar.';

    const finance = document.getElementById('finance');
    const financeHead = finance?.querySelector(':scope > .head');
    if (financeHead?.querySelector('p')) financeHead.querySelector('p').textContent = 'Entradas, valores a receber e pagamentos da operação.';

    const fleet = document.getElementById('fleet');
    const fleetHead = fleet?.querySelector(':scope > .head');
    if (fleetHead?.querySelector('h2')) fleetHead.querySelector('h2').textContent = 'Motorista e frota';
    if (fleetHead?.querySelector('p')) fleetHead.querySelector('p').textContent = 'Pagamento do motorista e dados do caminhão.';
  }

  function removeTestPresentation() {
    ['testModeDashboard','testModeCallsPanel','testModeFinancePanel'].forEach((id) => document.getElementById(id)?.remove());
    document.querySelectorAll('.test-mode-card').forEach((node) => node.remove());
  }

  function refreshPresentation() {
    normalizeNavigation();
    simplifyCopies();
    ensureSettingsHub();
    simplifyAvailability();
    removeTestPresentation();
  }

  loadUiLayer();
  const previousRenderManagement = typeof renderManagement === 'function' ? renderManagement : null;
  if (previousRenderManagement) {
    renderManagement = function trattoRenderManagement() {
      previousRenderManagement();
      refreshPresentation();
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshPresentation);
  else refreshPresentation();
  window.addEventListener('load', () => setTimeout(refreshPresentation, 50));
})();
