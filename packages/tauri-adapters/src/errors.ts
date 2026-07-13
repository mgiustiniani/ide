// ---------------------------------------------------------------------------
// @ide/tauri-adapters – Error helpers
// ---------------------------------------------------------------------------
// Normalises errors thrown by @tauri-apps/api/core.invoke so callers see
// consistent Error instances with command context instead of raw strings.
// ---------------------------------------------------------------------------

import { invoke } from '@tauri-apps/api/core';

export class TauriAdapterError extends Error {
  constructor(
    public readonly command: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[tauri:${command}] ${message}`);
    this.name = 'TauriAdapterError';
  }
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const message = record.message ?? record.error ?? record.reason;
    if (typeof message === 'string') {
      return message;
    }
  }

  return 'Tauri command failed';
}

export function toTauriAdapterError(
  command: string,
  error: unknown,
): TauriAdapterError {
  if (error instanceof TauriAdapterError) {
    return error;
  }

  return new TauriAdapterError(command, extractMessage(error), error);
}

export async function invokeTauri<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toTauriAdapterError(command, error);
  }
}
