import { useEffect } from 'react';

function isElement(value: unknown): value is Element {
  return value instanceof Element;
}

function syncTabBarIndicator(bar: Element) {
  const tabsBar = bar as HTMLElement;
  const activeTab = tabsBar.querySelector<HTMLElement>('.ui-tab.ui-tab-active');
  const indicator = tabsBar.querySelector<HTMLElement>('.ui-tabsbar-indicator');
  if (!indicator) return;

  if (!activeTab) {
    indicator.style.opacity = '0';
    indicator.style.width = '0px';
    return;
  }

  indicator.style.opacity = '1';
  indicator.style.width = `${activeTab.offsetWidth}px`;
  indicator.style.transform = `translateX(${activeTab.offsetLeft}px)`;
}

function ensureIndicators() {
  document.querySelectorAll('.ui-tabsbar').forEach((bar) => {
    const tabsBar = bar as HTMLElement;
    if (!tabsBar.querySelector('.ui-tabsbar-indicator')) {
      const indicator = document.createElement('span');
      indicator.className = 'ui-tabsbar-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      tabsBar.appendChild(indicator);
    }
    syncTabBarIndicator(tabsBar);
  });
}

export function GlobalTabIndicator() {
  useEffect(() => {
    let rafId = 0;
    const scheduleSync = () => {
      if (rafId !== 0) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        ensureIndicators();
      });
    };

    ensureIndicators();

    const mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          if (isElement(mutation.target) && mutation.target.classList.contains('ui-tab')) {
            scheduleSync();
            return;
          }
          continue;
        }

        for (const node of mutation.addedNodes) {
          if (!isElement(node)) continue;
          if (node.classList.contains('ui-tabsbar') || node.querySelector('.ui-tabsbar, .ui-tab')) {
            scheduleSync();
            return;
          }
        }
      }
    });

    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    const onResize = () => scheduleSync();
    const onClick = () => scheduleSync();
    const onKeyUp = () => scheduleSync();
    window.addEventListener('resize', onResize);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keyup', onKeyUp, true);

    return () => {
      mutationObserver.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keyup', onKeyUp, true);
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  return null;
}
