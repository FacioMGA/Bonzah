import type { NextFunction, Request, Response } from 'express';

type ControllerModule = typeof import('../../../products/motor/quotes/controller.js');
type HandlerName =
  | 'createSessionHandler'
  | 'forkHandler'
  | 'generateQuotePackHandler'
  | 'getIssueReadinessHandler'
  | 'getRecommendationsHandler'
  | 'getSessionHandler'
  | 'issuedPackHandler'
  | 'patchSessionHandler'
  | 'rateHandler'
  | 'recoEventHandler'
  | 'requestCallbackHandler'
  | 'sendQuoteEmailHandler'
  | 'unlockHandler';

type PublicAutoQuoteHandler = (req: Request, res: Response, next?: NextFunction) => unknown;

const controllerModulePromise: Promise<ControllerModule> = import('../../../products/motor/quotes/controller.js');

function bindHandler(name: HandlerName): PublicAutoQuoteHandler {
  return async (req: Request, res: Response, next?: NextFunction) => {
    try {
      const mod = await controllerModulePromise;
      const handler = mod[name] as PublicAutoQuoteHandler;
      return await handler(req, res, next);
    } catch (error) {
      if (next) return next(error);
      throw error;
    }
  };
}

export const createSessionHandler = bindHandler('createSessionHandler');
export const forkHandler = bindHandler('forkHandler');
export const generateQuotePackHandler = bindHandler('generateQuotePackHandler');
export const getIssueReadinessHandler = bindHandler('getIssueReadinessHandler');
export const getRecommendationsHandler = bindHandler('getRecommendationsHandler');
export const getSessionHandler = bindHandler('getSessionHandler');
export const issuedPackHandler = bindHandler('issuedPackHandler');
export const patchSessionHandler = bindHandler('patchSessionHandler');
export const rateHandler = bindHandler('rateHandler');
export const recoEventHandler = bindHandler('recoEventHandler');
export const requestCallbackHandler = bindHandler('requestCallbackHandler');
export const sendQuoteEmailHandler = bindHandler('sendQuoteEmailHandler');
export const unlockHandler = bindHandler('unlockHandler');
