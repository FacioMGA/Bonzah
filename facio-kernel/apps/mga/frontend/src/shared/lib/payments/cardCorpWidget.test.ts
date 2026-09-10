/* @vitest-environment happy-dom */

/**
 * ABY-409 / ABBEYGATE-REACT-2 — CardCorp `wpwl` options must disable
 * Enter-to-submit before the CVV iframe finishes registering
 * (`iframeCommunications['cvv_'+t].validateInput`).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCardCorpWidgetScript, removeCardCorpWidgetScript } from './cardCorpWidget';

type CardCorpWindow = Window & {
  wpwlOptions?: {
    disableSubmitOnEnter?: boolean;
  };
};

function cardCorpWindow(): CardCorpWindow {
  return window as CardCorpWindow;
}

describe('loadCardCorpWidgetScript — ABY-409 Enter-submit gate', () => {
  afterEach(() => {
    removeCardCorpWidgetScript();
    delete cardCorpWindow().wpwlOptions;
    vi.restoreAllMocks();
  });

  it('sets OPPWA disableSubmitOnEnter before appending the widget script', () => {
    // happy-dom refuses external script loads; we only need the append side-effect.
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);

    loadCardCorpWidgetScript({
      widgetScriptUrl: 'https://cardcorp.example/v1/paymentWidgets.js?checkoutId=CK-1',
    });

    const options = cardCorpWindow().wpwlOptions;
    expect(options).toBeTruthy();
    expect(options?.disableSubmitOnEnter).toBe(true);
    expect(document.body.appendChild).toHaveBeenCalled();
    const appended = vi.mocked(document.body.appendChild).mock.calls[0]?.[0] as HTMLScriptElement;
    expect(appended?.id).toBe('cardcorp-payment-widgets');
  });
});
