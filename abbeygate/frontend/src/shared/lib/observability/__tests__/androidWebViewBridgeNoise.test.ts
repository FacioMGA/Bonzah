import { describe, expect, it } from 'vitest';

import {
  isAndroidWebViewBridgeJavaObjectGoneMessage,
  shouldSuppressAndroidWebViewBridgeSentryReport,
} from '../androidWebViewBridgeNoise';

describe('isAndroidWebViewBridgeJavaObjectGoneMessage', () => {
  it('matches the ABY-491 postMessage variant', () => {
    expect(isAndroidWebViewBridgeJavaObjectGoneMessage('Error invoking postMessage: Java object is gone')).toBe(true);
  });

  it('matches related Facebook WebView bridge variants', () => {
    expect(
      isAndroidWebViewBridgeJavaObjectGoneMessage(
        'Error invoking enableDidUserTypeOnKeyboardLogging: Java object is gone',
      ),
    ).toBe(true);
    expect(isAndroidWebViewBridgeJavaObjectGoneMessage('Error invoking postEvent: Java object is gone')).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isAndroidWebViewBridgeJavaObjectGoneMessage('network down')).toBe(false);
    expect(isAndroidWebViewBridgeJavaObjectGoneMessage('Java object is gone')).toBe(false);
  });
});

describe('shouldSuppressAndroidWebViewBridgeSentryReport (ABY-491)', () => {
  it('suppresses postMessage noise from navigation_performance_logger_android', () => {
    const error = new Error('Error invoking postMessage: Java object is gone');
    error.stack = [
      'Error: Error invoking postMessage: Java object is gone',
      '    at sendDataToNative (app://navigation_performance_logger_android:1:5098)',
    ].join('\n');

    expect(shouldSuppressAndroidWebViewBridgeSentryReport(error)).toBe(true);
  });

  it('suppresses frameless WebView bridge captures with the canonical message', () => {
    const event = {
      exception: {
        values: [
          {
            value: 'Error invoking postMessage: Java object is gone',
            stacktrace: { frames: [{ filename: '?' }, { filename: 'undefined' }] },
          },
        ],
      },
    };

    expect(shouldSuppressAndroidWebViewBridgeSentryReport(undefined, event)).toBe(true);
  });

  it('suppresses when the Sentry event stack points at the injected script', () => {
    const event = {
      exception: {
        values: [
          {
            value: 'Error invoking postMessage: Java object is gone',
            stacktrace: {
              frames: [{ filename: 'app://navigation_performance_logger_android' }],
            },
          },
        ],
      },
    };

    expect(shouldSuppressAndroidWebViewBridgeSentryReport(undefined, event)).toBe(true);
  });

  it('suppresses the injected bridge error when Sentry adds its first-party capture frame', () => {
    const event = {
      exception: {
        values: [
          {
            value: 'Error invoking postMessage: Java object is gone',
            stacktrace: {
              frames: [
                { filename: 'iabjs://navigation_performance_logger_android:1:10198' },
                { filename: '/assets/react-vendor-D266U0Dg.js' },
              ],
            },
          },
        ],
      },
    };

    expect(shouldSuppressAndroidWebViewBridgeSentryReport(undefined, event)).toBe(true);
  });

  it('does not suppress first-party postMessage failures', () => {
    const error = new Error('Error invoking postMessage: Java object is gone');
    error.stack = [
      'Error: Error invoking postMessage: Java object is gone',
      '    at notifyParent (https://cy.abbeygate.com/assets/QuotePage-abc123.js:42:11)',
    ].join('\n');

    expect(shouldSuppressAndroidWebViewBridgeSentryReport(error)).toBe(false);
  });

  it('does not suppress unrelated errors', () => {
    expect(shouldSuppressAndroidWebViewBridgeSentryReport(new Error('network down'))).toBe(false);
  });
});
