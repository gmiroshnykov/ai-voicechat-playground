import { SrfRequest, SrfResponse } from 'drachtio-srf';
import { CallContext } from './types';
import { SessionType } from '../config/types';

/**
 * Common interface for all call handlers
 */
export interface CallHandler {
  initialize(): Promise<void>;
  handleCall(req: SrfRequest, res: SrfResponse, callContext: CallContext): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * Service responsible for routing calls to appropriate handlers
 */
export interface CallRouterService {
  routeCall(req: SrfRequest, res: SrfResponse, callContext: CallContext): Promise<void>;
  validateRoute(route: string): boolean;
  getAvailableRoutes(): string[];
}

/**
 * Factory for creating call handlers
 */
export interface CallHandlerFactory {
  createHandler(sessionType: SessionType): CallHandler;
}