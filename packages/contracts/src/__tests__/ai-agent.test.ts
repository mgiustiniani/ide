import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PI_AGENT_SETTINGS,
  PI_AGENT_FALLBACK_INTEGRATIONS,
  PI_AGENT_PREFERRED_INTEGRATION,
  PI_AGENT_PROVIDER,
  type AiAgentCommand,
  type AiAgentProvider,
  type PiAgentInstallResult,
  type PiAgentSettings,
  type PiAgentSettingsUpdate,
  type PiAgentStatus,
} from '../ai-agent';

describe('Pi agent contracts', () => {
  it('defines Pi as an optional provider with RPC-only defaults', () => {
    expect(PI_AGENT_PROVIDER).toBe('pi');
    expect(PI_AGENT_PREFERRED_INTEGRATION).toBe('rpc');
    expect(PI_AGENT_FALLBACK_INTEGRATIONS).toEqual([]);
    expect(DEFAULT_PI_AGENT_SETTINGS).toEqual({
      enabled: false,
      provider: 'pi',
      preferredIntegration: 'rpc',
      fallbackIntegrations: [],
    });
  });

  it('supports normalized settings, status, install result, and partial settings updates', () => {
    const provider: AiAgentProvider = 'pi';
    const settings: PiAgentSettings = {
      ...DEFAULT_PI_AGENT_SETTINGS,
      enabled: true,
      provider,
      model: 'local-profile',
    };
    const update: PiAgentSettingsUpdate = {
      enabled: true,
      preferredIntegration: 'rpc',
    };
    const status: PiAgentStatus = {
      provider,
      enabled: settings.enabled,
      available: true,
      availability: 'available',
      preferredIntegration: settings.preferredIntegration,
      activeIntegration: 'rpc',
    };
    const installResult: PiAgentInstallResult = {
      provider,
      success: true,
      outcome: 'already-installed',
      integration: 'rpc',
    };

    expect(update.preferredIntegration).toBe('rpc');
    expect(status.activeIntegration).toBe('rpc');
    expect(installResult.outcome).toBe('already-installed');
  });

  it('models discoverable Pi Agent commands and skills', () => {
    const commands: AiAgentCommand[] = [
      {
        name: 'multi-agent',
        description: 'Coordinate delegated agent workflows',
        source: 'skill',
        location: 'user skills',
        path: '/home/user/.pi/agent/skills/multi-agent/SKILL.md',
      },
      {
        name: 'explain-selection',
        source: 'prompt',
      },
      {
        name: 'theme-tools',
        source: 'extension',
      },
    ];

    expect(commands.map((command) => command.source)).toEqual(['skill', 'prompt', 'extension']);
    expect(commands[0]?.name).toBe('multi-agent');
  });
});
