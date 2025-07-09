import { AppConfig, EnvironmentVariables, SipProvider } from './types';

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

function validateSipProvider(provider: string): SipProvider {
  if (provider !== 'freeswitch' && provider !== 'kyivstar' && provider !== 'direct') {
    throw new ConfigurationError(`Invalid SIP_PROVIDER: ${provider}. Must be 'freeswitch', 'kyivstar', or 'direct'`);
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
    const provider = validateSipProvider(getOptionalEnv('SIP_PROVIDER', 'freeswitch'));
    
    // Provider-specific defaults
    const sipDefaults = provider === 'freeswitch' 
      ? { domain: 'localhost', port: 5060, username: 'firefly', password: 'password' }
      : { domain: 'sbc-sei2.kyivstar.ua', port: 5060, username: '', password: '' };

    const sipConfig = {
      provider,
      domain: getOptionalEnv('SIP_DOMAIN', sipDefaults.domain),
      username: provider === 'kyivstar' ? getRequiredEnv('SIP_USERNAME') : getOptionalEnv('SIP_USERNAME', sipDefaults.username),
      password: provider === 'kyivstar' ? getRequiredEnv('SIP_PASSWORD') : getOptionalEnv('SIP_PASSWORD', sipDefaults.password),
      port: validatePort(getOptionalEnv('SIP_PORT', sipDefaults.port.toString()), 'SIP_PORT'),
      proxyAddress: process.env.SIP_PROXY
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

    // OpenAI config now depends on having an API key, not a separate enabled flag
    const openaiApiKey = process.env.OPENAI_API_KEY || '';
    const openaiConfig = {
      enabled: openaiApiKey.length > 0,
      apiKey: openaiApiKey
    };

    // Recording config (enabled by default)
    const recordingConfig = {
      enabled: validateBooleanEnv(getOptionalEnv('CALL_RECORDING_ENABLED', 'true')),
      recordingsPath: getOptionalEnv('CALL_RECORDINGS_PATH', './recordings')
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

    const config: AppConfig = {
      sip: sipConfig,
      drachtio: drachtioConfig,
      rtp: rtpConfig,
      openai: openaiConfig,
      recording: recordingConfig,
      transcription: transcriptionConfig,
      testAudio: testAudioConfig,
      aiAudio: aiAudioConfig,
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