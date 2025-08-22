import Srf from 'drachtio-srf';
import { Command } from 'commander';
import { initializeConfig } from './config';
import type { AppConfig } from './config';
import { SipRegistrar } from './sip/SipRegistrar';
import { SipInboundRegistrar } from './sip/SipInboundRegistrar';
import { SipHandler } from './sip/SipHandler';
import { initializeLogger } from './utils/logger';

// Parse CLI arguments
const program = new Command();
program
  .name('firefly')
  .description('SIP service with OpenAI Realtime API integration')
  .version('1.0.0')
  .option('-c, --config <paths...>', 'Configuration file paths (can be used multiple times)')
  .option('--environment <env>', 'Application environment', 'development')
  .option('--log-level <level>', 'Logging level (trace, debug, info, warn, error)')
  .option('--sip-provider <provider>', 'SIP outbound provider (kyivstar, disabled)')
  .option('--sip-inbound-enabled', 'Enable SIP inbound registration')
  .option('--sip-inbound-port <port>', 'SIP inbound port', parseInt)
  .option('--default-route <route>', 'Default call route (echo, chat, welcome)')
  .option('--ring-delay <ms>', 'Ring delay in milliseconds', parseInt)
  .option('--openai-enabled', 'Enable OpenAI integration')
  .option('--recording-enabled', 'Enable call recording')
  .option('--transcription-enabled', 'Enable transcription')
  .option('--drachtio-host <host>', 'Drachtio server host')
  .option('--drachtio-port <port>', 'Drachtio server port', parseInt)
  .option('--media-server-host <host>', 'FreeSWITCH media server host')
  .option('--media-server-port <port>', 'FreeSWITCH media server port', parseInt)
  .addHelpText('after', `
Examples:
  $ firefly --help
  $ firefly --log-level debug --ring-delay 2000
  $ firefly --config ./custom-config.yaml --openai-enabled
  $ firefly --sip-provider kyivstar --default-route chat`)
  .parse();

// Load configuration and initialize logger based on CLI arguments
const options = program.opts();
const logger = initializeLogger(options.logLevel || 'info');
const config: AppConfig = initializeConfig(options.config);

// Create main components
const srf = new Srf();
let sipRegistrar: SipRegistrar | undefined;
let sipInboundRegistrar: SipInboundRegistrar | undefined;
let sipHandler: SipHandler | undefined;

async function startApplication(): Promise<void> {
  logger.info('Starting Firefly with configurable media server', {
    environment: config.environment,
    sipOutboundProvider: config.sipOutbound.provider,
    sipInboundEnabled: config.sipInbound.enabled,
    defaultRoute: config.routing.defaultRoute
  });

  // Connect to drachtio server
  await connectToDrachtio();

  // Initialize SIP handler
  sipHandler = new SipHandler(srf, config);
  await sipHandler.initialize();

  // Start inbound registrar if enabled (accepts registrations from SIP clients)
  if (config.sipInbound.enabled) {
    sipInboundRegistrar = new SipInboundRegistrar(srf);
    
    // Handle inbound registration events
    sipInboundRegistrar.on('user-registered', (username: string, contactUri: string) => {
      logger.info('SIP client registered', { username, contactUri });
    });

    sipInboundRegistrar.on('user-unregistered', (username: string) => {
      logger.info('SIP client unregistered', { username });
    });

    await sipInboundRegistrar.start();
  }

  // Start outbound SIP registration if provider is configured
  if (config.sipOutbound.provider !== 'disabled') {
    sipRegistrar = new SipRegistrar(srf, config.sipOutbound, config.drachtio);
    
    // Handle registration events
    sipRegistrar.on('registered', () => {
      // Registration success is already logged by SipRegistrar
    });

    sipRegistrar.on('registration-failed', (error) => {
      logger.warn('Registration failed, will retry', { error });
    });

    sipRegistrar.on('registration-fatal', (error) => {
      logger.error('Fatal registration error, exiting', error);
      shutdown(1);
    });

    // Start SIP registration
    await sipRegistrar.start();
  }

  const sipEndpoint = config.sipOutbound.provider === 'disabled' 
    ? 'inbound-only' 
    : `${config.sipOutbound.username}@${config.sipOutbound.domain}`;
    
  const sipMode = [];
  if (config.sipInbound.enabled) sipMode.push('accepting-registrations');
  if (config.sipOutbound.provider !== 'disabled') sipMode.push('outbound-registration');
  
  logger.info('Firefly started successfully', {
    sipEndpoint,
    mode: sipMode.join(' + ') || 'no-sip-registration'
  });
}

async function connectToDrachtio(): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.debug('Connecting to drachtio server', {
      host: config.drachtio.host,
      port: config.drachtio.port
    });

    srf.connect({
      host: config.drachtio.host,
      port: config.drachtio.port,
      secret: config.drachtio.secret
    });

    srf.on('connect', (err: Error | null, hostport: string) => {
      if (err) {
        logger.error('Failed to connect to drachtio', err);
        reject(err);
        return;
      }
      logger.info('Connected to drachtio server', { hostport });
      resolve();
    });

    srf.on('error', (err: Error) => {
      logger.error('Drachtio connection error', err);
      reject(err);
    });
  });
}

async function shutdown(exitCode: number = 0): Promise<void> {
  logger.info('Shutting down Firefly...');

  try {
    // Stop SIP registration services
    if (sipRegistrar) {
      sipRegistrar.stop();
    }
    
    if (sipInboundRegistrar) {
      sipInboundRegistrar.stop();
    }

    // Shutdown SIP handler
    if (sipHandler) {
      await sipHandler.shutdown();
    }


    // Disconnect from drachtio
    srf.disconnect();

    logger.info('Firefly shutdown complete');
  } catch (error) {
    logger.error('Error during shutdown', error);
  }

  process.exit(exitCode);
}

// Handle process signals
process.on('SIGINT', () => {
  logger.info('Received SIGINT signal');
  shutdown(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM signal');
  shutdown(0);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  shutdown(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', reason, { promise });
  shutdown(1);
});

// Start the application
startApplication().catch((error) => {
  logger.error('Failed to start Firefly', error);
  process.exit(1);
});