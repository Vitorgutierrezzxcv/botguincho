(() => {
  'use strict';

  const killLegacyMobileNav = () => {
    document.querySelectorAll('.mobile-tabs,.mobile-bottom-nav,.bottom-nav').forEach((el) => {
      try { el.remove(); } catch { el.style.setProperty('display','none','important'); }
    });
  };

  const enforceFabRight = () => {
    const fab = document.getElementById('axMenuFab') || document.querySelector('.ax-menu-fab');
    const drawer = document.getElementById('axMenuDrawer') || document.querySelector('.ax-menu-drawer');
    if (fab) {
      fab.style.setProperty('left','auto','important');
      fab.style.setProperty('right','18px','important');
    }
    if (drawer) {
      drawer.style.setProperty('left','auto','important');
      drawer.style.setProperty('right','12px','important');
    }
  };

  const fix = () => {
    killLegacyMobileNav();
    enforceFabRight();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(fix, 50), { once:true });
  } else {
    setTimeout(fix, 50);
  }

  // Scripts antigos podem inserir/alterar a navegação alguns ms depois do carregamento.
  // Observamos apenas adições ao body e não alteramos conteúdo existente repetidamente.
  const observer = new MutationObserver((mutations) => {
    let needsFix = false;
    for (const mutation of mutations) {
      if (!mutation.addedNodes?.length) continue;
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.('.mobile-tabs,.mobile-bottom-nav,.bottom-nav,.ax-menu-fab,.ax-menu-drawer') ||
            node.querySelector?.('.mobile-tabs,.mobile-bottom-nav,.bottom-nav,.ax-menu-fab,.ax-menu-drawer')) {
          needsFix = true;
          break;
        }
      }
      if (needsFix) break;
    }
    if (needsFix) requestAnimationFrame(fix);
  });

  const startObserver = () => {
    if (document.body) observer.observe(document.body,{childList:true,subtree:true});
  };
  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver, {once:true});

  // Reforço curto para PWA/cache sem loop permanente.
  [250, 800, 1800, 3500].forEach((ms) => setTimeout(fix, ms));
})();
