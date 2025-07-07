import { EventEmitter } from 'events';
import { createLogger, Logger } from '../utils/logger';

// Extended SRF interface for registration handling
interface ExtendedSrf {
  connect(options: any): void;
  on(event: string, handler: (...args: any[]) => void): void;
  use(method: string, middleware: any): void;
  register(handler: (req: any, res: any) => void): void;
  disconnect(): void;
}

interface RegistrationInfo {
  type: 'register';
  expires: number;
  contact: Array<{
    uri: string;
    params: Record<string, string>;
  }>;
}

interface AuthenticatedRequest {
  registration: RegistrationInfo;
  authorization: {
    scheme: string;
    username: string;
    realm: string;
    nonce: string;
    uri: string;
    algorithm: string;
    response: string;
    qop?: string;
    nc?: string;
    cnonce?: string;
  };
  get(header: string): string;
  uri: string;
}

interface SipResponse {
  send(status: number, options?: { headers?: Record<string, string> }): void;
}

/**
 * SIP Inbound Registrar - accepts registrations from SIP clients (like Linphone)
 * This allows SIP clients to register with Firefly directly for calls
 */
export class SipInboundRegistrar extends EventEmitter {
  private readonly srf: ExtendedSrf;
  private readonly logger: Logger;
  private readonly registeredUsers = new Map<string, { contact: string; expires: Date }>();

  // Simple user database - in production, this would be in a real database
  private readonly users = new Map([
    ['linphone', { password: 'test123', realm: 'localhost' }],
    ['test', { password: 'test123', realm: 'localhost' }],
    ['firefly', { password: 'password', realm: 'localhost' }]
  ]);

  constructor(srf: ExtendedSrf) {
    super();
    this.srf = srf;
    this.logger = createLogger({ 
      component: 'SipInboundRegistrar'
    });
  }

  public async start(): Promise<void> {
    this.logger.info('Starting SIP inbound registrar');
    this.setupRegistrationHandling();
  }

  public stop(): void {
    this.logger.info('Stopping SIP inbound registrar');
    this.registeredUsers.clear();
  }

  private setupRegistrationHandling(): void {
    try {
      // Import middleware dynamically since they don't have TypeScript definitions
      const digestAuth = require('drachtio-mw-digest-auth');
      const regParser = require('drachtio-mw-registration-parser');

      // Set up digest authentication challenge
      const challenge = digestAuth({
        realm: 'localhost',
        passwordLookup: (username: string, realm: string, callback: (err: Error | null, password: string | null) => void) => {
          this.logger.debug('Password lookup requested', { username, realm });
          
          const user = this.users.get(username);
          if (!user || user.realm !== realm) {
            this.logger.warn('Authentication failed - invalid user', { username, realm });
            return callback(null, null); // Return null to trigger 403 Forbidden
          }

          this.logger.debug('Authentication successful', { username, realm });
          return callback(null, user.password);
        }
      });

      // Apply middleware
      this.srf.use('register', challenge);
      this.srf.use('register', regParser);

      // Handle authenticated REGISTER requests
      this.srf.register((req: AuthenticatedRequest, res: SipResponse) => {
        this.handleRegisterRequest(req, res);
      });

      this.logger.info('SIP registration handler configured');
      
    } catch (error) {
      this.logger.error('Failed to setup registration handling', error);
      throw error;
    }
  }

  private handleRegisterRequest(req: AuthenticatedRequest, res: SipResponse): void {
    const callId = req.get('Call-Id') || 'unknown';
    const username = req.authorization.username;
    const expires = req.registration.expires;
    const contactUri = req.registration.contact[0]?.uri;

    this.logger.info('Processing REGISTER request', {
      callId,
      username,
      expires,
      contactUri
    });

    try {
      if (!contactUri) {
        this.logger.error('No contact URI in registration request');
        res.send(400);
        return;
      }

      if (expires === 0) {
        // Unregistration
        this.registeredUsers.delete(username);
        this.logger.info('User unregistered', { username });
        this.emit('user-unregistered', username);
      } else {
        // Registration
        const expiresDate = new Date(Date.now() + expires * 1000);
        this.registeredUsers.set(username, {
          contact: contactUri,
          expires: expiresDate
        });
        this.logger.info('User registered', { username, contactUri, expires });
        this.emit('user-registered', username, contactUri);
      }

      // Send successful response
      res.send(200, {
        headers: {
          'Contact': `<${contactUri}>;expires=${expires}`,
          'Date': new Date().toUTCString()
        }
      });

    } catch (error) {
      this.logger.error('Failed to process registration', error);
      res.send(500);
    }
  }

  /**
   * Get all currently registered users
   */
  public getRegisteredUsers(): Map<string, { contact: string; expires: Date }> {
    // Clean up expired registrations
    const now = new Date();
    for (const [username, registration] of this.registeredUsers) {
      if (registration.expires < now) {
        this.registeredUsers.delete(username);
        this.logger.info('Registration expired', { username });
        this.emit('user-unregistered', username);
      }
    }
    
    return new Map(this.registeredUsers);
  }

  /**
   * Check if a user is currently registered
   */
  public isUserRegistered(username: string): boolean {
    const registration = this.registeredUsers.get(username);
    if (!registration) return false;
    
    if (registration.expires < new Date()) {
      this.registeredUsers.delete(username);
      this.emit('user-unregistered', username);
      return false;
    }
    
    return true;
  }

  /**
   * Get contact URI for a registered user
   */
  public getUserContact(username: string): string | null {
    const registration = this.registeredUsers.get(username);
    if (!registration || registration.expires < new Date()) {
      return null;
    }
    return registration.contact;
  }

  /**
   * Add a user to the authentication database
   */
  public addUser(username: string, password: string, realm: string = 'localhost'): void {
    this.users.set(username, { password, realm });
    this.logger.info('User added to authentication database', { username, realm });
  }

  /**
   * Remove a user from the authentication database
   */
  public removeUser(username: string): void {
    this.users.delete(username);
    this.registeredUsers.delete(username);
    this.logger.info('User removed from authentication database', { username });
    this.emit('user-unregistered', username);
  }
}