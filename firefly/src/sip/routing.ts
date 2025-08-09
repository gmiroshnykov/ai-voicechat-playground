import { SessionType } from '../config/types';

/**
 * Route configuration for named SIP endpoints
 */
export interface RouteConfig {
  sessionType: SessionType;
  requiresOpenAI: boolean;
  description: string;
}

/**
 * Named routes available in the system
 * These correspond to SIP URIs like: sip:welcome@domain, sip:chat@domain, etc.
 */
export const ROUTES: Record<string, RouteConfig> = {
  welcome: {
    sessionType: 'welcome',
    requiresOpenAI: false,
    description: 'Welcome message with test audio'
  },
  echo: {
    sessionType: 'echo',
    requiresOpenAI: false,
    description: 'Audio echo/loopback service'
  },
  chat: {
    sessionType: 'chat',
    requiresOpenAI: true,
    description: 'OpenAI-powered conversation'
  }
};

/**
 * Route resolver - determines session type from SIP URI
 */
export class RouteResolver {
  constructor(private defaultRoute: SessionType) {}

  /**
   * Extract route name from SIP URI
   * Examples:
   *   sip:welcome@domain -> 'welcome'
   *   sip:chat@domain -> 'chat'
   *   sip:+380123456789@domain -> 'default' (external call)
   */
  public extractRoute(sipUri: string): string {
    const match = sipUri.match(/sip:([^@]+)@/);
    const userPart = match?.[1] ?? 'unknown';
    
    // Check if it's a named route
    if (ROUTES[userPart]) {
      return userPart;
    }
    
    // External calls (phone numbers, unknown users) go to default route
    return 'default';
  }

  /**
   * Resolve route to session type
   */
  public resolveSessionType(route: string): SessionType {
    if (route === 'default') {
      return this.defaultRoute;
    }
    
    const routeConfig = ROUTES[route];
    if (!routeConfig) {
      // Fallback to default for unknown routes
      return this.defaultRoute;
    }
    
    return routeConfig.sessionType;
  }

  /**
   * Check if route requires OpenAI configuration
   */
  public requiresOpenAI(route: string): boolean {
    if (route === 'default') {
      const defaultRouteConfig = ROUTES[this.defaultRoute];
      return defaultRouteConfig?.requiresOpenAI ?? false;
    }
    
    const routeConfig = ROUTES[route];
    return routeConfig?.requiresOpenAI ?? false;
  }

  /**
   * Get route description for logging
   */
  public getRouteDescription(route: string): string {
    if (route === 'default') {
      const defaultRouteConfig = ROUTES[this.defaultRoute];
      return `default (${defaultRouteConfig?.description ?? 'unknown'})`;
    }
    
    const routeConfig = ROUTES[route];
    return routeConfig?.description ?? 'unknown route';
  }

  /**
   * Get all available routes for documentation
   */
  public getAvailableRoutes(): Record<string, RouteConfig> {
    return { ...ROUTES };
  }
}