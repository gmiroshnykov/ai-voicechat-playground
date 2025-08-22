import { Schema } from 'convict';
import { SessionType, SipOutboundProvider } from './types';

// Custom format validators
const sessionTypeFormat = {
  name: 'session-type',
  validate: (val: any) => {
    const validTypes: SessionType[] = ['echo', 'chat', 'welcome'];
    if (!validTypes.includes(val)) {
      throw new Error(`must be one of: ${validTypes.join(', ')}`);
    }
  },
  coerce: (val: any) => val as SessionType
};

const sipProviderFormat = {
  name: 'sip-provider',
  validate: (val: any) => {
    const validProviders: SipOutboundProvider[] = ['kyivstar', 'disabled'];
    if (!validProviders.includes(val)) {
      throw new Error(`must be one of: ${validProviders.join(', ')}`);
    }
  },
  coerce: (val: any) => val as SipOutboundProvider
};

const recordingFormatValidator = {
  name: 'recording-format',
  validate: (val: any) => {
    const validFormats = ['wav', 'raw'];
    if (!validFormats.includes(val)) {
      throw new Error(`must be one of: ${validFormats.join(', ')}`);
    }
  },
  coerce: (val: any) => val as 'wav' | 'raw'
};

const recordingChannelModeValidator = {
  name: 'recording-channel-mode',
  validate: (val: any) => {
    const validModes = ['mono', 'stereo', 'both'];
    if (!validModes.includes(val)) {
      throw new Error(`must be one of: ${validModes.join(', ')}`);
    }
  },
  coerce: (val: any) => val as 'mono' | 'stereo' | 'both'
};


const tempoFormat = {
  name: 'tempo',
  validate: (val: any) => {
    const num = Number(val);
    if (isNaN(num) || num <= 0 || num > 5.0) {
      throw new Error('must be a number between 0.1 and 5.0');
    }
  },
  coerce: (val: any) => Number(val)
};

const ringDelayFormat = {
  name: 'ring-delay',
  validate: (val: any) => {
    const num = Number(val);
    if (isNaN(num) || num < 0 || num > 30000) {
      throw new Error('must be a number between 0 and 30000 (30 seconds)');
    }
  },
  coerce: (val: any) => Number(val)
};

export const configSchema: Schema<any> = {
  environment: {
    doc: 'Application environment',
    format: ['production', 'development', 'test'],
    default: 'development',
    arg: 'environment'
  },
  
  sip: {
    inbound: {
      enabled: {
        doc: 'Enable SIP inbound registration service',
        format: Boolean,
        default: true,
        arg: 'sip-inbound-enabled'
      },
      port: {
        doc: 'SIP inbound service port',
        format: 'port',
        default: 5062,
        arg: 'sip-inbound-port'
      }
    },
    outbound: {
      provider: {
        doc: 'SIP outbound provider configuration',
        format: 'sip-provider',
        default: 'disabled',
        arg: 'sip-provider'
      },
      domain: {
        doc: 'SIP outbound domain',
        format: String,
        default: '',
        arg: 'sip-domain'
      },
      username: {
        doc: 'SIP outbound username',
        format: String,
        default: '',
        arg: 'sip-username'
      },
      password: {
        doc: 'SIP outbound password',
        format: String,
        default: '',
        sensitive: true
      },
      port: {
        doc: 'SIP outbound port',
        format: 'port',
        default: 5060,
        arg: 'sip-port'
      },
      proxyAddress: {
        doc: 'SIP outbound proxy address',
        format: String,
        default: '',
        arg: 'sip-proxy'
      }
    }
  },

  routing: {
    defaultRoute: {
      doc: 'Default route for incoming calls',
      format: 'session-type',
      default: 'welcome',
      arg: 'default-route'
    },
    ringDelayMs: {
      doc: 'Ring delay in milliseconds for natural interaction',
      format: 'ring-delay',
      default: 3000,
      arg: 'ring-delay'
    }
  },

  audio: {
    testTempo: {
      doc: 'Test audio tempo adjustment (1.0 = normal speed)',
      format: 'tempo',
      default: 1.0,
      arg: 'test-audio-tempo'
    },
    aiTempo: {
      doc: 'AI audio tempo adjustment (1.0 = normal speed)',
      format: 'tempo',
      default: 1.0,
      arg: 'ai-audio-tempo'
    }
  },

  recording: {
    enabled: {
      doc: 'Enable call recording',
      format: Boolean,
      default: true,
      arg: 'recording-enabled'
    },
    format: {
      doc: 'Recording file format',
      format: 'recording-format',
      default: 'wav',
      arg: 'recording-format'
    },
    directory: {
      doc: 'Recording directory path',
      format: String,
      default: './recordings',
      arg: 'recording-dir'
    },
    channelMode: {
      doc: 'Recording channel mode',
      format: 'recording-channel-mode',
      default: 'both',
      arg: 'recording-channels'
    },
    includeMetadata: {
      doc: 'Include metadata with recordings',
      format: Boolean,
      default: true,
      arg: 'recording-metadata'
    },
    filenamePrefix: {
      doc: 'Recording filename prefix',
      format: String,
      default: 'call',
      arg: 'recording-prefix'
    }
  },

  transcription: {
    enabled: {
      doc: 'Enable transcription',
      format: Boolean,
      default: true,
      arg: 'transcription-enabled'
    },
    model: {
      doc: 'Transcription model',
      format: String,
      default: 'gpt-4o-transcribe',
      arg: 'transcription-model'
    },
    displayToConsole: {
      doc: 'Display transcription to console',
      format: Boolean,
      default: true,
      arg: 'transcription-console'
    }
  },

  openai: {
    enabled: {
      doc: 'Enable OpenAI integration',
      format: Boolean,
      default: false,
      arg: 'openai-enabled'
    },
    apiKey: {
      doc: 'OpenAI API key',
      format: String,
      default: '',
      sensitive: true
    }
  },

  drachtio: {
    host: {
      doc: 'Drachtio server host',
      format: String,
      default: '127.0.0.1',
      arg: 'drachtio-host'
    },
    port: {
      doc: 'Drachtio server port',
      format: 'port',
      default: 9022,
      arg: 'drachtio-port'
    },
    secret: {
      doc: 'Drachtio server secret',
      format: String,
      default: '',
      sensitive: true
    },
    sipPort: {
      doc: 'Drachtio SIP port',
      format: 'port',
      default: 5060,
      arg: 'drachtio-sip-port'
    }
  },

  mediaServer: {
    address: {
      doc: 'FreeSWITCH media server address',
      format: String,
      default: '127.0.0.1',
      arg: 'media-server-host'
    },
    port: {
      doc: 'FreeSWITCH media server port',
      format: 'port',
      default: 8021,
      arg: 'media-server-port'
    },
    secret: {
      doc: 'FreeSWITCH media server secret',
      format: String,
      default: '',
      sensitive: true
    },
    enabled: {
      doc: 'Enable media server integration',
      format: Boolean,
      default: true,
      arg: 'media-server-enabled'
    }
  }
};

// Export custom formats for registration
export const customFormats = [
  sessionTypeFormat,
  sipProviderFormat,
  recordingFormatValidator,
  recordingChannelModeValidator,
  tempoFormat,
  ringDelayFormat
];