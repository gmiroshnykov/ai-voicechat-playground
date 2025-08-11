import { EventEmitter } from 'events';
import Srf from 'drachtio-srf';
import { SipRegistrationState } from './types';
import { SipOutboundConfig, DrachtioConfig } from '../config/types';
import { createLogger, Logger } from '../utils/logger';
import { SipRegistrationError } from '../utils/errors';

interface RegistrationOptions {
  uri: string;
  method: 'REGISTER';
  headers: Record<string, string | string[]>;
  auth?: {
    username: string;
    password: string;
  };
}

interface RequestOptions {
  uri: string;
  method: string;
  headers: Record<string, string | string[]>;
  auth?: {
    username: string;
    password: string;
  };
}

export class SipRegistrar extends EventEmitter {
  private readonly srf: Srf;
  private readonly sipConfig: SipOutboundConfig;
  private readonly drachtioConfig: DrachtioConfig;
  private readonly logger: Logger;
  private registrationState: SipRegistrationState;
  private registrationTimer?: NodeJS.Timeout;
  private keepAliveTimer?: NodeJS.Timeout;
  private readonly maxRetries = 5;
  private readonly retryDelay = 5000; // 5 seconds
  private readonly keepAliveInterval = 30000; // 30 seconds

  constructor(srf: Srf, sipConfig: SipOutboundConfig, drachtioConfig: DrachtioConfig) {
    super();
    this.srf = srf;
    this.sipConfig = sipConfig;
    this.drachtioConfig = drachtioConfig;
    this.logger = createLogger({ 
      component: 'SipRegistrar',
      sipUser: sipConfig.username,
      sipDomain: sipConfig.domain
    });
    
    this.registrationState = {
      isRegistered: false,
      failureCount: 0
    };
  }

  public async start(): Promise<void> {
    this.logger.debug('Starting SIP registration');
    await this.register();
  }

  public stop(): void {
    this.logger.debug('Stopping SIP registration');
    
    if (this.registrationTimer) {
      clearTimeout(this.registrationTimer);
      this.registrationTimer = undefined;
    }
    
    this.stopKeepAlive();
    
    // TODO: Send unregister request
    this.registrationState.isRegistered = false;
    this.emit('unregistered');
  }

  private async register(): Promise<void> {
    const uri = `sip:${this.sipConfig.username}@${this.sipConfig.domain}:${this.sipConfig.port}`;
    const contact = `sip:${this.sipConfig.username}@${process.env.LOCAL_IP}:${this.drachtioConfig.sipPort}`;

    this.logger.debug('Sending REGISTER request', { uri, contact });

    const options: RegistrationOptions = {
      uri,
      method: 'REGISTER',
      headers: {
        'To': `sip:${this.sipConfig.username}@${this.sipConfig.domain}`,
        'From': `sip:${this.sipConfig.username}@${this.sipConfig.domain}`,
        'Contact': contact,
        'Expires': '3600',
        'User-Agent': 'firefly/1.0'
      },
      auth: {
        username: this.sipConfig.username,
        password: this.sipConfig.password
      }
    };

    // Add proxy address if configured
    if (this.sipConfig.proxyAddress) {
      options.headers['Route'] = `<sip:${this.sipConfig.proxyAddress}>`;
    }

    try {
      const request = await this.srf.request(uri, options);
      
      request.on('response', (res: any) => {
        this.handleRegistrationResponse(res);
      });
    } catch (error) {
      this.logger.error('Failed to send REGISTER request', error);
      this.handleRegistrationFailure(error);
    }
  }

  private handleRegistrationResponse(response: { status: number; reason: string }): void {
    this.logger.debug('Received REGISTER response', { 
      status: response.status, 
      reason: response.reason 
    });

    if (response.status === 200) {
      // Success
      this.registrationState.isRegistered = true;
      this.registrationState.lastRegistrationTime = new Date();
      this.registrationState.failureCount = 0;
      
      // Schedule re-registration (5 minutes before expiry)
      const reregisterIn = (3600 - 300) * 1000; // 55 minutes
      this.registrationState.nextRegistrationTime = new Date(Date.now() + reregisterIn);
      
      this.logger.info('Successfully registered with SIP server');
      
      this.emit('registered');
      
      // Start keep-alive messages
      this.startKeepAlive();
      
      // Schedule re-registration
      this.registrationTimer = setTimeout(() => {
        this.register().catch(error => {
          this.logger.error('Re-registration failed', error);
        });
      }, reregisterIn);
      
    } else if (response.status === 401 || response.status === 407) {
      // Authentication challenge - drachtio-srf should handle this automatically
      this.logger.debug('Authentication challenge received');
      
    } else if (response.status === 403) {
      // Forbidden - authentication failed
      const error = new SipRegistrationError(
        'Authentication failed - check username/password',
        response.status
      );
      this.handleRegistrationFailure(error);
      
    } else if (response.status >= 400) {
      // Other client/server errors
      const error = new SipRegistrationError(
        `Registration failed: ${response.reason}`,
        response.status
      );
      this.handleRegistrationFailure(error);
    }
  }

  private handleRegistrationFailure(error: unknown): void {
    this.registrationState.isRegistered = false;
    this.registrationState.failureCount++;
    
    // Stop keep-alive since we're no longer registered
    this.stopKeepAlive();
    
    this.logger.error('Registration failed', error, {
      failureCount: this.registrationState.failureCount,
      maxRetries: this.maxRetries
    });
    
    this.emit('registration-failed', error);
    
    if (this.registrationState.failureCount >= this.maxRetries) {
      this.logger.error('Max registration retries exceeded, giving up');
      this.emit('registration-fatal', error);
      return;
    }
    
    // Retry with exponential backoff
    const delay = this.retryDelay * Math.pow(2, this.registrationState.failureCount - 1);
    this.logger.info(`Retrying registration in ${delay}ms`);
    
    this.registrationTimer = setTimeout(() => {
      this.register().catch(err => {
        this.logger.error('Registration retry failed', err);
      });
    }, delay);
  }

  public getState(): Readonly<SipRegistrationState> {
    return { ...this.registrationState };
  }

  public isRegistered(): boolean {
    return this.registrationState.isRegistered;
  }

  private startKeepAlive(): void {
    this.stopKeepAlive(); // Clear any existing timer
    
    this.logger.debug('Starting SIP keep-alive', {
      interval: this.keepAliveInterval
    });
    
    // Start keep-alive after full interval (REGISTER already established NAT hole)
    const randomOffset = (Math.random() - 0.5) * 0.4; // -20% to +20%
    const initialInterval = this.keepAliveInterval * (1 + randomOffset);
    
    this.keepAliveTimer = setTimeout(() => {
      this.sendKeepAlive();
    }, initialInterval);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearTimeout(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
      this.logger.debug('Stopped SIP keep-alive');
    }
  }

  private async sendKeepAlive(): Promise<void> {
    if (!this.registrationState.isRegistered) {
      this.logger.debug('Skipping keep-alive - not registered');
      return;
    }

    const uri = `sip:${this.sipConfig.domain}:${this.sipConfig.port}`;
    
    try {
      const options: RequestOptions = {
        uri,
        method: 'OPTIONS',
        headers: {
          'To': `sip:${this.sipConfig.domain}`,
          'From': `sip:${this.sipConfig.username}@${this.sipConfig.domain}`,
          'User-Agent': 'firefly/1.0'
        }
      };

      this.logger.debug('Sending SIP keep-alive OPTIONS', { uri });
      
      const request = await this.srf.request(uri, options);
      
      request.on('response', (res: any) => {
        this.logger.debug('Keep-alive response received', {
          status: res.status,
          reason: res.reason
        });
      });
      
    } catch (error) {
      this.logger.warn('Keep-alive failed', { error });
    }
    
    // Schedule next keep-alive with randomization (±20%)
    const randomOffset = (Math.random() - 0.5) * 0.4; // -20% to +20%
    const nextInterval = this.keepAliveInterval * (1 + randomOffset);
    
    this.keepAliveTimer = setTimeout(() => {
      this.sendKeepAlive();
    }, nextInterval);
  }
}