import { AppConfig, EnvironmentVariables, SipOutboundProvider } from './types';

export * from './types';

class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

function getRequiredEnv(key: keyof EnvironmentVariables): string {
  const value = process.env[key];
  if (!value) {
    throw new ConfigurationError(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getOptionalEnv(key: keyof EnvironmentVariables, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function validateSipOutboundProvider(provider: string): SipOutboundProvider {
  if (provider !== 'kyivstar' && provider !== 'disabled') {
    throw new ConfigurationError(`Invalid SIP_OUTBOUND_PROVIDER: ${provider}. Must be 'kyivstar' or 'disabled'`);
  }
  return provider;
}

function validatePort(value: string, name: string): number {
  const port = parseInt(value, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new ConfigurationError(`Invalid ${name}: ${value}. Must be a number between 1 and 65535`);
  }
  return port;
}

function validateIpAddress(ip: string): string {
  const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  if (!ipRegex.test(ip)) {
    throw new ConfigurationError(`Invalid IP address: ${ip}`);
  }
  return ip;
}

function validateLogLevel(level: string): "trace" | "debug" | "info" | "warn" | "error" {
  const validLevels = ["trace", "debug", "info", "warn", "error"];
  if (!validLevels.includes(level)) {
    throw new ConfigurationError(`Invalid LOG_LEVEL: ${level}. Must be one of: ${validLevels.join(', ')}`);
  }
  return level as "trace" | "debug" | "info" | "warn" | "error";
}

function validateBooleanEnv(value: string): boolean {
  const lowerValue = value.toLowerCase();
  if (lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes') {
    return true;
  }
  if (lowerValue === 'false' || lowerValue === '0' || lowerValue === 'no' || lowerValue === '') {
    return false;
  }
  throw new ConfigurationError(`Invalid boolean value: ${value}. Must be true, false, 1, 0, yes, no, or empty`);
}

export function loadConfig(): AppConfig {
  try {
    const outboundProvider = validateSipOutboundProvider(getOptionalEnv('SIP_OUTBOUND_PROVIDER', 'disabled'));
    
    // Provider-specific defaults for outbound registration
    const sipOutboundDefaults = outboundProvider === 'kyivstar'
      ? { domain: 'voip.kyivstar.ua', port: 5060, username: '', password: '' }
      : { domain: '', port: 5060, username: '', password: '' };

    const sipOutboundConfig = {
      provider: outboundProvider,
      domain: getOptionalEnv('SIP_OUTBOUND_DOMAIN', sipOutboundDefaults.domain),
      username: outboundProvider === 'kyivstar' ? getRequiredEnv('SIP_OUTBOUND_USERNAME') : getOptionalEnv('SIP_OUTBOUND_USERNAME', sipOutboundDefaults.username),
      password: outboundProvider === 'kyivstar' ? getRequiredEnv('SIP_OUTBOUND_PASSWORD') : getOptionalEnv('SIP_OUTBOUND_PASSWORD', sipOutboundDefaults.password),
      port: validatePort(getOptionalEnv('SIP_OUTBOUND_PORT', sipOutboundDefaults.port.toString()), 'SIP_OUTBOUND_PORT'),
      proxyAddress: process.env.SIP_OUTBOUND_PROXY
    };

    const sipInboundConfig = {
      enabled: validateBooleanEnv(getOptionalEnv('SIP_INBOUND_ENABLED', 'true')),
      port: validatePort(getOptionalEnv('SIP_INBOUND_PORT', '5062'), 'SIP_INBOUND_PORT')
    };

    const drachtioConfig = {
      host: getOptionalEnv('DRACHTIO_HOST', '127.0.0.1'),
      port: validatePort(getOptionalEnv('DRACHTIO_PORT', '9022'), 'DRACHTIO_PORT'),
      secret: getOptionalEnv('DRACHTIO_SECRET', 'cymru'),
      sipPort: validatePort(getOptionalEnv('DRACHTIO_SIP_PORT', '5060'), 'DRACHTIO_SIP_PORT')
    };

    const rtpConfig = {
      localIp: validateIpAddress(getRequiredEnv('LOCAL_IP')),
      portMin: validatePort(getOptionalEnv('RTP_PORT_MIN', '10000'), 'RTP_PORT_MIN'),
      portMax: validatePort(getOptionalEnv('RTP_PORT_MAX', '20000'), 'RTP_PORT_MAX'),
      jitterBufferMs: validatePort(getOptionalEnv('JITTER_BUFFER_MS', '40'), 'JITTER_BUFFER_MS')
    };

    // Validate RTP port range
    if (rtpConfig.portMin >= rtpConfig.portMax) {
      throw new ConfigurationError('RTP_PORT_MIN must be less than RTP_PORT_MAX');
    }
    
    // Validate jitter buffer range (10ms to 200ms for conversational quality)
    if (rtpConfig.jitterBufferMs < 10 || rtpConfig.jitterBufferMs > 200) {
      throw new ConfigurationError('JITTER_BUFFER_MS must be between 10 and 200 milliseconds');
    }

    // OpenAI config requires explicit enabling even when key is present
    const openaiApiKey = process.env.OPENAI_API_KEY || '';
    const openaiConfig = {
      enabled: validateBooleanEnv(getOptionalEnv('OPENAI_ENABLED', 'false')),
      apiKey: openaiApiKey
    };


    // Transcription config (enabled by default)
    const transcriptionConfig = {
      enabled: validateBooleanEnv(getOptionalEnv('TRANSCRIPTION_ENABLED', 'true')),
      model: getOptionalEnv('TRANSCRIPTION_MODEL', 'gpt-4o-mini-transcribe'),
      displayToConsole: validateBooleanEnv(getOptionalEnv('TRANSCRIPTION_DISPLAY_TO_CONSOLE', 'true'))
    };

    // Test audio config
    const testAudioTempo = parseFloat(getOptionalEnv('TEST_AUDIO_TEMPO', '1.0'));
    if (isNaN(testAudioTempo) || testAudioTempo <= 0 || testAudioTempo > 5.0) {
      throw new ConfigurationError('TEST_AUDIO_TEMPO must be a number between 0.1 and 5.0');
    }
    
    const testAudioConfig = {
      tempoAdjustment: testAudioTempo !== 1.0 ? { tempo: testAudioTempo } : undefined
    };
    
    // AI audio config
    const aiAudioTempo = parseFloat(getOptionalEnv('AI_AUDIO_TEMPO', '1.0'));
    if (isNaN(aiAudioTempo) || aiAudioTempo <= 0 || aiAudioTempo > 5.0) {
      throw new ConfigurationError('AI_AUDIO_TEMPO must be a number between 0.1 and 5.0');
    }
    
    const aiAudioConfig = {
      tempoAdjustment: aiAudioTempo !== 1.0 ? { tempo: aiAudioTempo } : undefined
    };

    // Recording config
    const recordingEnabled = validateBooleanEnv(getOptionalEnv('RECORDING_ENABLED', 'true'));
    const recordingChannelMode = getOptionalEnv('RECORDING_CHANNEL_MODE', 'both');
    
    if (!['mono', 'stereo', 'both'].includes(recordingChannelMode)) {
      throw new ConfigurationError(`Invalid RECORDING_CHANNEL_MODE: ${recordingChannelMode}. Must be 'mono', 'stereo', or 'both'`);
    }
    
    const recordingFormat = getOptionalEnv('RECORDING_FORMAT', 'wav');
    if (!['wav', 'raw'].includes(recordingFormat)) {
      throw new ConfigurationError(`Invalid RECORDING_FORMAT: ${recordingFormat}. Must be 'wav' or 'raw'`);
    }
    
    const recordingConfig = {
      enabled: recordingEnabled,
      format: recordingFormat as 'wav' | 'raw',
      directory: getOptionalEnv('RECORDING_DIRECTORY', './recordings'),
      channelMode: recordingChannelMode as 'mono' | 'stereo' | 'both',
      includeMetadata: validateBooleanEnv(getOptionalEnv('RECORDING_INCLUDE_METADATA', 'true')),
      filenamePrefix: getOptionalEnv('RECORDING_FILENAME_PREFIX', 'call')
    };

    const config: AppConfig = {
      sipOutbound: sipOutboundConfig,
      sipInbound: sipInboundConfig,
      drachtio: drachtioConfig,
      rtp: rtpConfig,
      openai: openaiConfig,
      transcription: transcriptionConfig,
      testAudio: testAudioConfig,
      aiAudio: aiAudioConfig,
      recording: recordingConfig,
      environment: getOptionalEnv('NODE_ENV', 'development'),
      logLevel: validateLogLevel(getOptionalEnv('LOG_LEVEL', 'info'))
    };

    return config;
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error(`Configuration error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

// Export a singleton instance
export const config = loadConfig();