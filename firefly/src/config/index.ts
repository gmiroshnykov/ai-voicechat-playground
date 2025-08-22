import { loadConfiguration } from './convict';
import { AppConfig } from './types';

// Re-export types
export * from './types';

// Export the configuration loader function
export { loadConfiguration };

// Export a variable that will hold the loaded configuration
export let config: AppConfig;

// Function to initialize the global config
export function initializeConfig(configPaths?: string[]): AppConfig {
  config = loadConfiguration(configPaths);
  return config;
}

// For backward compatibility, also export the old ConfigurationError
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}