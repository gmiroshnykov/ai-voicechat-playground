export abstract class FireflyError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ConfigurationError extends FireflyError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', context);
  }
}

export class SipError extends FireflyError {
  public readonly statusCode?: number;

  constructor(message: string, code: string, statusCode?: number, context?: Record<string, unknown>) {
    super(message, code, context);
    this.statusCode = statusCode;
  }
}

export class SipRegistrationError extends SipError {
  constructor(message: string, statusCode?: number, context?: Record<string, unknown>) {
    super(message, 'SIP_REGISTRATION_ERROR', statusCode, context);
  }
}

export class SipCallError extends SipError {
  constructor(message: string, statusCode?: number, context?: Record<string, unknown>) {
    super(message, 'SIP_CALL_ERROR', statusCode, context);
  }
}

export class RtpError extends FireflyError {
  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message, code, context);
  }
}

export class RtpPortAllocationError extends RtpError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'RTP_PORT_ALLOCATION_ERROR', context);
  }
}

export class RtpSessionError extends RtpError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'RTP_SESSION_ERROR', context);
  }
}

export class CodecError extends FireflyError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CODEC_ERROR', context);
  }
}

export function isFireflyError(error: unknown): error is FireflyError {
  return error instanceof FireflyError;
}

export function formatError(error: unknown): string {
  if (isFireflyError(error)) {
    let message = `[${error.code}] ${error.message}`;
    if (error.context) {
      message += ` Context: ${JSON.stringify(error.context)}`;
    }
    return message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}