export type CardCorpWidgetLoadArgs = {
  widgetScriptUrl: string;
  integrity?: string;
  onReady?: () => void;
  onError?: (err: unknown) => void;
};

const SCRIPT_ID = 'cardcorp-payment-widgets';

function safeUrlOrNull(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    return u;
  } catch {
    return null;
  }
}

function applyBrandBadgeRevealBestEffort() {
  // Brand badge:
  // - the widget injects an initial VISA class even before any BIN is known.
  // - we hide it until the widget assigns a detected brand class after input.
  try {
    const brand = document.querySelector('.wpwl-brand-card') as HTMLElement | null;
    if (!brand) return;

    // Start hidden.
    brand.removeAttribute('data-brand-card-visible');

    // Remove any preselected brand class to avoid showing “VISA” before recognition.
    for (const cls of Array.from(brand.classList)) {
      if (cls.startsWith('wpwl-brand-') && cls !== 'wpwl-brand' && cls !== 'wpwl-brand-card') {
        brand.classList.remove(cls);
      }
    }

    const isRecognized = () =>
      Array.from(brand.classList).some(
        (c) => c.startsWith('wpwl-brand-') && c !== 'wpwl-brand' && c !== 'wpwl-brand-card',
      );

    const reveal = () => {
      if (brand.getAttribute('data-brand-card-visible') === '1') return;
      brand.setAttribute('data-brand-card-visible', '1');
    };

    // Observe class changes (widget will update the brand div as BIN is detected).
    const obs = new MutationObserver(() => {
      if (isRecognized()) {
        reveal();
        obs.disconnect();
      }
    });
    obs.observe(brand, { attributes: true, attributeFilter: ['class'] });

    // Fallback: if the widget updates brand silently, poll briefly.
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (isRecognized()) {
        window.clearInterval(timer);
        reveal();
        return;
      }
      if (Date.now() - startedAt > 8000) {
        window.clearInterval(timer);
      }
    }, 250);
  } catch {
    // ignore
  }
}

function wireIframeFocusBestEffort() {
  // NOTE: card number + CVV are rendered inside cross-origin iframes.
  // CSS :focus-within does not cross iframe boundaries, so we mirror focus/blur from the iframe element
  // onto the group wrapper to apply the same active border styles.
  try {
    const wire = (groupSelector: string) => {
      const group = document.querySelector(groupSelector) as HTMLElement | null;
      if (!group) return;
      const iframe = group.querySelector('iframe') as HTMLIFrameElement | null;
      if (!iframe) return;
      const set = (on: boolean) => group.classList.toggle('brand-iframe-focused', on);
      iframe.addEventListener('focus', () => set(true), true);
      iframe.addEventListener('blur', () => set(false), true);
    };
    wire('.wpwl-group-cardNumber');
    wire('.wpwl-group-cvv');
  } catch {
    // ignore
  }
}

function normalizeNativePlaceholdersBestEffort() {
  // Card holder + expiry are native controls (not iframe fields).
  // We run labels-only mode, so keep placeholders empty.
  try {
    const cardHolderInput = document.querySelector('.wpwl-group-cardHolder input.wpwl-control') as HTMLInputElement | null;
    if (cardHolderInput) cardHolderInput.setAttribute('placeholder', '');
    const expiryInput = document.querySelector('.wpwl-group-expiry input.wpwl-control') as HTMLInputElement | null;
    if (expiryInput) expiryInput.setAttribute('placeholder', '');
  } catch {
    // ignore
  }
}

export function removeCardCorpWidgetScript() {
  try {
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) existing.remove();
  } catch {
    // ignore
  }
}

export function loadCardCorpWidgetScript(args: CardCorpWidgetLoadArgs) {
  const url = safeUrlOrNull(args.widgetScriptUrl);
  if (!url) {
    throw new Error('Invalid widget script URL.');
  }

  // Configure widget options BEFORE script load.
  const cardcorpWindow = window as Window & {
    wpwlOptions?: Record<string, unknown>;
  };
  cardcorpWindow.wpwlOptions = {
    // Use COPYandPAY "plain" as the base style.
    // We intentionally do NOT use "none" (not a documented style option); our skin is applied via scoped .cardcorp-widget CSS overrides.
    // https://cardcorp.docs.oppwa.com/integrations/widget/customization
    style: 'plain',
    // ABY-409 / ABBEYGATE-REACT-2 — the widget's submit handler can bind
    // before the CVV iframe finishes registering
    // (`iframeCommunications['cvv_'+t].validateInput`). Enter-to-submit
    // is the documented race; OPPWA exposes `disableSubmitOnEnter` for
    // exactly that. Pair with PaymentStep's mount `inert` /
    // pointer-events gate until `onReady`.
    disableSubmitOnEnter: true,
    // Widget Customization docs (CardCorp / OPPWA):
    // - iframe placeholders (card number + cvv) must be styled via iframeStyles.
    // https://cardcorp.docs.oppwa.com/integrations/widget/customization
    // NOTE: Docs mention `iframeStyle` (singular). Some implementations also accept `iframeStyles`.
    // We set BOTH for maximum compatibility.
    iframeStyle: {
      'card-number-placeholder': {
        color: 'rgba(0, 0, 0, 0)',
        'font-size': '14px',
        'font-family': 'Arial, Helvetica, sans-serif',
        'font-weight': '500',
        'letter-spacing': '0.14px',
        'text-transform': 'uppercase',
      },
      'cvv-placeholder': {
        color: 'rgba(0, 0, 0, 0)',
        'font-size': '14px',
        'font-family': 'Arial, Helvetica, sans-serif',
        'font-weight': '500',
        'letter-spacing': '0.14px',
        'text-transform': 'uppercase',
      },
    },
    iframeStyles: {
      'card-number-placeholder': {
        color: 'rgba(0, 0, 0, 0)',
        'font-size': '14px',
        'font-family': 'Arial, Helvetica, sans-serif',
        'font-weight': '500',
        'letter-spacing': '0.14px',
        'text-transform': 'uppercase',
      },
      'cvv-placeholder': {
        color: 'rgba(0, 0, 0, 0)',
        'font-size': '14px',
        'font-family': 'Arial, Helvetica, sans-serif',
        'font-weight': '500',
        'letter-spacing': '0.14px',
        'text-transform': 'uppercase',
      },
    },
    onReady: () => {
      applyBrandBadgeRevealBestEffort();
      wireIframeFocusBestEffort();
      normalizeNativePlaceholdersBestEffort();
      try { args.onReady?.(); } catch { }
    },
    onError: (err: unknown) => {
      try { args.onError?.(err); } catch { }
    },
  };

  // Remove previous widget script if any
  removeCardCorpWidgetScript();

  const s = document.createElement('script');
  s.id = SCRIPT_ID;
  s.src = url.toString();
  if (args.integrity) s.integrity = args.integrity;
  s.crossOrigin = 'anonymous';
  document.body.appendChild(s);
}

export function mountPaymentWidgetsForm(args: {
  mount: HTMLElement;
  action: string;
  brands: string;
}) {
  const { mount, action, brands } = args;
  // Clear any previous widget DOM and create a fresh form for the new checkout.
  while (mount.firstChild) {
    mount.removeChild(mount.firstChild);
  }
  const form = document.createElement('form');
  form.action = action;
  form.className = 'paymentWidgets';
  form.setAttribute('data-brands', brands);
  mount.appendChild(form);
  return form;
}
