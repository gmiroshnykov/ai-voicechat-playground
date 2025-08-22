import { SrfRequest, SrfResponse } from 'drachtio-srf';
import { CallContext } from './types';
import { AppConfig, SessionType } from '../config/types';
import { CallHandler, CallRouterService as ICallRouterService } from './interfaces';
import { RouteResolver } from './routing';
import { createLogger, Logger } from '../utils/logger';
import { setTimeout as delay } from 'timers/promises';

export class CallRouterService implements ICallRouterService {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly routeResolver: RouteResolver;
  private readonly handlers: Map<SessionType, CallHandler>;

  constructor(config: AppConfig, handlers: Map<SessionType, CallHandler>) {
    this.config = config;
    this.logger = createLogger({ component: 'CallRouterService' });
    this.routeResolver = new RouteResolver(config.routing.defaultRoute);
    this.handlers = handlers;
  }

  public async routeCall(req: SrfRequest, res: SrfResponse, callContext: CallContext): Promise<void> {
    const callLogger = this.logger.child({ callId: callContext.callId });

    try {
      // Resolve route based on called party (To header)
      const route = this.routeResolver.extractRoute(callContext.to);
      const sessionType = this.routeResolver.resolveSessionType(route);
      const routeDescription = this.routeResolver.getRouteDescription(route);

      callLogger.info('Route resolved', {
        route,
        sessionType,
        description: routeDescription
      });

      // Validate route requirements
      if (!this.validateRouteRequirements(route, sessionType, callLogger)) {
        res.send(503, 'Service Unavailable');
        return;
      }

      // Get the appropriate handler
      const handler = this.handlers.get(sessionType);
      if (!handler) {
        callLogger.error('No handler available for session type', { sessionType });
        res.send(503, 'Service Unavailable');
        return;
      }

      // Send ringing response for all routes
      callLogger.info('Sending 180 Ringing response');
      res.send(180, 'Ringing');

      // Apply ring delay for natural interaction
      if (this.config.routing.ringDelayMs > 0) {
        callLogger.info('Letting phone ring before answering', { 
          delayMs: this.config.routing.ringDelayMs 
        });
        await delay(this.config.routing.ringDelayMs);
      }

      // Delegate to appropriate handler
      await handler.handleCall(req, res, callContext);

    } catch (error) {
      callLogger.error('Error in call routing', error);
      if (!res.send) {
        // Response already sent
        return;
      }
      res.send(500, 'Internal Server Error');
    }
  }

  public validateRoute(route: string): boolean {
    const sessionType = this.routeResolver.resolveSessionType(route);
    return this.handlers.has(sessionType);
  }

  public getAvailableRoutes(): string[] {
    return Object.keys(this.routeResolver.getAvailableRoutes());
  }

  private validateRouteRequirements(_route: string, sessionType: SessionType, logger: Logger): boolean {
    // Check OpenAI requirement for chat routes
    if (sessionType === 'chat') {
      if (!this.config.openai.enabled) {
        logger.error('Chat route requires OpenAI but it is not enabled');
        return false;
      }
    }

    // Add other route-specific validations here as needed
    return true;
  }
}