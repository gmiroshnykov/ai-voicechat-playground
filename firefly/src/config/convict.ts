import convict from 'convict';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { configSchema, customFormats } from './schema';
import { AppConfig } from './types';

function setupConvict() {
  // Add YAML parser
  convict.addParser({ extension: ['yml', 'yaml'], parse: yaml.load });

  // Add custom format validators before creating config
  customFormats.forEach(format => convict.addFormat(format));

  // Initialize configuration with schema
  return convict(configSchema);
}

export function loadConfiguration(configPaths?: string[]): AppConfig {
  const config = setupConvict();
  
  // Determine config file paths
  let filesToLoad: string[] = [];
  
  if (configPaths && configPaths.length > 0) {
    // Use provided paths (from CLI or elsewhere)
    filesToLoad = configPaths;
  } else {
    // Fallback to environment variable or default
    const defaultPath = process.env.CONFIG_FILE || path.join(__dirname, '../../config/config.yaml');
    filesToLoad = [defaultPath];
  }
  
  // Load configuration files in order (later files override earlier ones)
  for (const configPath of filesToLoad) {
    if (fs.existsSync(configPath)) {
      try {
        config.loadFile(configPath);
        console.log(`Loaded configuration from: ${configPath}`);
      } catch (error) {
        console.error(`Failed to load configuration file ${configPath}:`, error);
        throw error;
      }
    } else {
      console.log(`Configuration file not found at ${configPath}, skipping`);
    }
  }

  // Validate configuration
  try {
    config.validate({ allowed: 'strict' });
  } catch (error) {
    console.error('Configuration validation failed:', error);
    throw error;
  }

  // Transform Convict config to AppConfig format
  const convictConfig = config.getProperties();
  
  const appConfig: AppConfig = {
    sipOutbound: {
      provider: convictConfig.sip.outbound.provider,
      domain: convictConfig.sip.outbound.domain,
      username: convictConfig.sip.outbound.username,
      password: convictConfig.sip.outbound.password,
      port: convictConfig.sip.outbound.port,
      proxyAddress: convictConfig.sip.outbound.proxyAddress || undefined
    },
    sipInbound: {
      enabled: convictConfig.sip.inbound.enabled,
      port: convictConfig.sip.inbound.port
    },
    drachtio: {
      host: convictConfig.drachtio.host,
      port: convictConfig.drachtio.port,
      secret: convictConfig.drachtio.secret,
      sipPort: convictConfig.drachtio.sipPort
    },
    openai: {
      enabled: convictConfig.openai.enabled,
      apiKey: convictConfig.openai.apiKey
    },
    transcription: {
      enabled: convictConfig.transcription.enabled,
      model: convictConfig.transcription.model,
      displayToConsole: convictConfig.transcription.displayToConsole
    },
    testAudio: {
      tempoAdjustment: convictConfig.audio.testTempo !== 1.0 ? 
        { tempo: convictConfig.audio.testTempo } : undefined
    },
    aiAudio: {
      tempoAdjustment: convictConfig.audio.aiTempo !== 1.0 ? 
        { tempo: convictConfig.audio.aiTempo } : undefined
    },
    recording: {
      enabled: convictConfig.recording.enabled,
      format: convictConfig.recording.format,
      directory: convictConfig.recording.directory,
      channelMode: convictConfig.recording.channelMode,
      includeMetadata: convictConfig.recording.includeMetadata,
      filenamePrefix: convictConfig.recording.filenamePrefix
    },
    routing: {
      defaultRoute: convictConfig.routing.defaultRoute,
      ringDelayMs: convictConfig.routing.ringDelayMs
    },
    mediaServer: {
      address: convictConfig.mediaServer.address,
      port: convictConfig.mediaServer.port,
      secret: convictConfig.mediaServer.secret,
      enabled: convictConfig.mediaServer.enabled
    },
    environment: convictConfig.environment
  };

  return appConfig;
}

// Export function to get raw convict config for advanced usage
export function getRawConfig() {
  return setupConvict();
}