import Srf from 'drachtio-srf';
import { Command } from 'commander';
import { config } from './config';
import { RtpManager } from './rtp/RtpManager';
import { SipRegistrar } from './sip/SipRegistrar';
import { SipInboundRegistrar } from './sip/SipInboundRegistrar';
import { SipHandler } from './sip/SipHandler';
import { logger } from './utils/logger';

// Parse CLI arguments
const program = new Command();
program
  .name('firefly')
  .description('SIP/RTP bridge with OpenAI Realtime API integration')
  .version('1.0.0')
  .option('-m, --mode <mode>', 'operational mode: echo or chat', 'echo')
  .parse();

const options = program.opts();
const mode = options.mode === 'chat' ? 'chat' : 'echo';

// Create main components
const srf = new Srf();
const rtpManager = new RtpManager(config.rtp);
let sipRegistrar: SipRegistrar | undefined;
let sipInboundRegistrar: SipInboundRegistrar | undefined;
let sipHandler: SipHandler | undefined;

async function startApplication(): Promise<void> {
  logger.info('Starting Firefly', {
    environment: config.environment,
    sipOutboundProvider: config.sipOutbound.provider,
    sipInboundEnabled: config.sipInbound.enabled,
    logLevel: config.logLevel,
    mode: mode
  });

  // Connect to drachtio server
  await connectToDrachtio();

  // Initialize SIP handler
  sipHandler = new SipHandler(srf, rtpManager, config, mode);

  // Start inbound registrar if enabled (accepts registrations from SIP clients)
  if (config.sipInbound.enabled) {
    sipInboundRegistrar = new SipInboundRegistrar(srf as any);
    
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
    rtpPorts: `${config.rtp.portMin}-${config.rtp.portMax}`,
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

    // Shutdown RTP manager
    await rtpManager.shutdown();

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