export const CARDCORP_WIDGET_SCOPE_CLASS = 'cardcorp-widget';

// Scoped COPYandPAY widget stylesheet.
// We keep !important where needed because provider styles are injected late and aggressively.
export const CARDCORP_WIDGET_CSS = `
  .cardcorp-widget .wpwl-label-brand,
  .cardcorp-widget .wpwl-wrapper-brand { display: none !important; }

  .cardcorp-widget .wpwl-form,
  .cardcorp-widget .wpwl-form * {
    font-family: Arial, Helvetica, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  .cardcorp-widget .wpwl-group-mobilePhoneCountryCode,
  .cardcorp-widget .wpwl-group-mobilePhoneNumber,
  .cardcorp-widget .wpwl-group-birthDate,
  .cardcorp-widget .wpwl-group-clickToPayConfirmation,
  .cardcorp-widget .wpwl-group-visaInstallmentConfirmation { display: none !important; }

  .cardcorp-widget .wpwl-form {
    background:
      radial-gradient(120% 90% at 20% 10%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.35) 45%, rgba(255,255,255,0.10) 100%),
      linear-gradient(135deg, #f8fafc 0%, #eef2f7 30%, #e5e7eb 55%, #f8fafc 100%) !important;
    border: 1px solid rgba(15, 23, 42, 0.08) !important;
    border-radius: 24px !important;
    padding: 48px 28px 28px !important;
    box-shadow: 0 8px 30px rgba(0,0,0,0.04) !important;
    width: 100% !important;
    max-width: 560px !important;
    margin: 0 auto !important;
    position: relative !important;
    overflow: hidden !important;
    display: flex !important;
    flex-wrap: wrap !important;
    align-items: flex-start !important;
    gap: 14px 18px !important;
  }
  .cardcorp-widget .wpwl-form:before {
    content: "" !important;
    position: absolute !important;
    inset: 0 !important;
    background: linear-gradient(115deg, rgba(255,255,255,0.0) 0%, rgba(255,255,255,0.55) 28%, rgba(255,255,255,0.0) 56%) !important;
    opacity: 0.55 !important;
    pointer-events: none !important;
  }
  .cardcorp-widget .wpwl-form:after {
    content: "" !important;
    position: absolute !important;
    inset: 0 !important;
    background: radial-gradient(100% 80% at 80% 0%, rgba(0,74,138,0.06) 0%, rgba(0,0,0,0.0) 60%) !important;
    pointer-events: none !important;
  }

  .cardcorp-widget .wpwl-control {
    border-radius: 12px !important;
    border: 1px solid rgba(15, 23, 42, 0.10) !important;
    background-color: rgba(255, 255, 255, 0.70) !important;
    height: 48px !important;
    padding: 0 14px !important;
    font-size: 14px !important;
    font-weight: 500 !important;
    color: #0f172a !important;
    transition: all 0.2s ease;
    letter-spacing: 0.01em;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.8);
    width: 100% !important;
  }
  .cardcorp-widget .wpwl-control:focus {
    background-color: #ffffff !important;
    border-color: #004a8a !important;
    box-shadow: 0 0 0 2px rgba(0, 74, 138, 0.1) !important;
    outline: none !important;
  }
  .cardcorp-widget .wpwl-control::placeholder,
  .cardcorp-widget .wpwl-control::-webkit-input-placeholder,
  .cardcorp-widget .wpwl-control::-moz-placeholder,
  .cardcorp-widget .wpwl-control:-ms-input-placeholder {
    color: transparent !important;
    -webkit-text-fill-color: transparent !important;
    opacity: 0 !important;
    text-transform: none !important;
  }

  /* Native fields (cardHolder/expiry) need a slightly darker placeholder
     to visually match provider iframe rendering (card number/cvv). */
  .cardcorp-widget .wpwl-group-cardHolder .wpwl-control::placeholder,
  .cardcorp-widget .wpwl-group-cardHolder .wpwl-control::-webkit-input-placeholder,
  .cardcorp-widget .wpwl-group-cardHolder .wpwl-control::-moz-placeholder,
  .cardcorp-widget .wpwl-group-cardHolder .wpwl-control:-ms-input-placeholder,
  .cardcorp-widget .wpwl-group-expiry .wpwl-control::placeholder,
  .cardcorp-widget .wpwl-group-expiry .wpwl-control::-webkit-input-placeholder,
  .cardcorp-widget .wpwl-group-expiry .wpwl-control::-moz-placeholder,
  .cardcorp-widget .wpwl-group-expiry .wpwl-control:-ms-input-placeholder {
    color: transparent !important;
    -webkit-text-fill-color: transparent !important;
    opacity: 0 !important;
    text-transform: none !important;
  }

  .cardcorp-widget .wpwl-label {
    font-size: 11px !important;
    font-weight: 700 !important;
    text-transform: uppercase !important;
    letter-spacing: 0.08em !important;
    color: rgba(71, 85, 105, 0.95) !important;
    margin: 0 0 8px 0 !important;
    width: 100% !important;
  }

  .cardcorp-widget .wpwl-group {
    margin: 0 !important;
    width: auto !important;
    min-width: 0 !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: stretch !important;
    gap: 0 !important;
  }
  .cardcorp-widget .wpwl-label,
  .cardcorp-widget .wpwl-wrapper {
    float: none !important;
    clear: both !important;
  }
  .cardcorp-widget .wpwl-wrapper { width: 100% !important; }

  .cardcorp-widget .wpwl-group:not(.wpwl-group-cardNumber):not(.wpwl-group-cardHolder):not(.wpwl-group-expiry):not(.wpwl-group-cvv):not(.wpwl-group-brand):not(.wpwl-group-submit) {
    display: none !important;
  }

  .cardcorp-widget .wpwl-group-brand {
    position: absolute !important;
    top: 0 !important;
    right: 0 !important;
    width: 0 !important;
    height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
  }

  .cardcorp-widget .wpwl-group-cardNumber {
    flex: 0 0 calc((100% - 18px) * 0.66) !important;
    max-width: calc((100% - 18px) * 0.66) !important;
    order: 1 !important;
  }
  .cardcorp-widget .wpwl-group-expiry {
    flex: 0 0 calc((100% - 18px) * 0.34) !important;
    max-width: calc((100% - 18px) * 0.34) !important;
    min-width: 0 !important;
    order: 2 !important;
  }
  .cardcorp-widget .wpwl-group-cardHolder {
    flex: 0 0 calc((100% - 18px) * 0.66) !important;
    max-width: calc((100% - 18px) * 0.66) !important;
    order: 3 !important;
  }
  .cardcorp-widget .wpwl-group-cvv {
    flex: 0 0 calc((100% - 18px) * 0.34) !important;
    max-width: calc((100% - 18px) * 0.34) !important;
    min-width: 0 !important;
    order: 4 !important;
  }

  .cardcorp-widget .wpwl-control-iframe {
    width: 100% !important;
    height: 48px !important;
    border-radius: 12px !important;
    border: 1px solid rgba(15, 23, 42, 0.10) !important;
    background-color: rgba(255, 255, 255, 0.70) !important;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.8) !important;
    transition: all 0.2s ease !important;
  }
  .cardcorp-widget .wpwl-group:focus-within .wpwl-control,
  .cardcorp-widget .wpwl-group:focus-within .wpwl-control-iframe,
  .cardcorp-widget .wpwl-group.brand-iframe-focused .wpwl-control-iframe {
    background-color: #ffffff !important;
    border-color: #004a8a !important;
    box-shadow: 0 0 0 2px rgba(0, 74, 138, 0.1) !important;
    outline: none !important;
  }

  .cardcorp-widget .wpwl-group-submit {
    flex: 0 0 100% !important;
    order: 5 !important;
    display: flex !important;
    justify-content: flex-end !important;
  }
  .cardcorp-widget .wpwl-button-pay {
    background-color: #004a8a !important;
    border-radius: 14px !important;
    color: white !important;
    border: none !important;
    height: 50px !important;
    font-weight: 700 !important;
    font-size: 14px !important;
    width: 210px !important;
    text-transform: none !important;
    box-shadow: 0 4px 6px -1px rgba(0, 74, 138, 0.2), 0 2px 4px -1px rgba(0, 74, 138, 0.1) !important;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
    cursor: pointer !important;
    margin-top: 16px !important;
  }
  .cardcorp-widget .wpwl-button-pay:hover {
    background-color: #00386b !important;
    transform: translateY(-1px);
    box-shadow: 0 10px 15px -3px rgba(0, 74, 138, 0.25) !important;
  }
  .cardcorp-widget .wpwl-button-pay:active { transform: translateY(0); }

  .cardcorp-widget .wpwl-brand-card {
    position: absolute !important;
    top: 18px !important;
    right: 18px !important;
    left: auto !important;
    opacity: 0 !important;
    transition: opacity 200ms ease, transform 200ms ease;
    transform: translateY(-2px);
    pointer-events: none;
  }
  .cardcorp-widget .wpwl-brand-card[data-brand-card-visible="1"] {
    opacity: 0.9 !important;
    transform: translateY(0);
  }

  @media (max-width: 420px) {
    .cardcorp-widget .wpwl-form {
      padding: 22px !important;
      gap: 12px 14px !important;
    }
    .cardcorp-widget .wpwl-group-cardNumber,
    .cardcorp-widget .wpwl-group-expiry,
    .cardcorp-widget .wpwl-group-cardHolder,
    .cardcorp-widget .wpwl-group-cvv {
      flex: 0 0 100% !important;
      max-width: 100% !important;
    }
    .cardcorp-widget .wpwl-group-expiry,
    .cardcorp-widget .wpwl-group-cvv { min-width: 0 !important; }
    .cardcorp-widget .wpwl-control {
      height: 46px !important;
      font-size: 14px !important;
    }
    .cardcorp-widget .wpwl-group-submit { justify-content: stretch !important; }
    .cardcorp-widget .wpwl-button-pay { width: 100% !important; height: 52px !important; }
  }
`;
