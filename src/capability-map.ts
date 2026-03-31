import {
  TELEGRAM_ADMIN_COMMANDS,
  TELEGRAM_COMMON_COMMANDS,
} from './telegram-command-spec.js';
import { SUBAGENT_TYPE_REGISTRY } from './subagent-types.js';
import type { SkillCatalogEntry } from './system-prompt.js';

export type CapabilityKind =
  | 'direct'
  | 'skill'
  | 'command'
  | 'subagent'
  | 'coder';

export type CapabilityCost = 'cheap' | 'medium' | 'expensive';
export type CapabilityRisk = 'safe' | 'review' | 'live-impact';
export type CapabilityTriggerability = 'auto' | 'explicit' | 'approval';

export interface CapabilityEntry {
  id: string;
  label: string;
  description: string;
  kind: CapabilityKind;
  cost: CapabilityCost;
  risk: CapabilityRisk;
  triggerability: CapabilityTriggerability;
}

export function buildCapabilityMap(params: {
  isMain: boolean;
  assistantName: string;
  skillCatalog: SkillCatalogEntry[];
}): CapabilityEntry[] {
  const entries: CapabilityEntry[] = [
    {
      id: 'direct:chat',
      label: 'Direct chat help',
      description: 'Answer questions, explain options, and coordinate next steps without building anything new.',
      kind: 'direct',
      cost: 'cheap',
      risk: 'safe',
      triggerability: 'auto',
    },
  ];

  for (const skill of params.skillCatalog) {
    entries.push({
      id: `skill:${skill.name}`,
      label: skill.name,
      description: skill.description || skill.whenToUse,
      kind: 'skill',
      cost: 'cheap',
      risk: 'safe',
      triggerability: 'auto',
    });
  }

  for (const command of TELEGRAM_COMMON_COMMANDS) {
    entries.push({
      id: `command:/${command.command}`,
      label: `/${command.command}`,
      description: command.description,
      kind: 'command',
      cost: 'cheap',
      risk: 'safe',
      triggerability: 'explicit',
    });
  }

  if (params.isMain) {
    for (const command of TELEGRAM_ADMIN_COMMANDS) {
      entries.push({
        id: `command:/${command.command}`,
        label: `/${command.command}`,
        description: command.description,
        kind: 'command',
        cost:
          command.command === 'coder' ||
          command.command === 'coding' ||
          command.command === 'coder_plan'
            ? 'expensive'
            : 'medium',
        risk:
          command.command === 'restart' || command.command === 'gateway'
            ? 'live-impact'
            : 'review',
        triggerability:
          command.command === 'restart' || command.command === 'gateway'
            ? 'approval'
            : 'explicit',
      });
    }
  }

  for (const [name, type] of SUBAGENT_TYPE_REGISTRY.entries()) {
    entries.push({
      id: `subagent:${name}`,
      label: type.label,
      description: type.description,
      kind: 'subagent',
      cost: type.blocking ? 'medium' : 'cheap',
      risk: name === 'data-sync' ? 'review' : 'safe',
      triggerability: type.agentCanSpawn ? 'auto' : 'explicit',
    });
  }

  entries.push({
    id: 'coder:execute',
    label: 'Coder execute',
    description:
      'Build or modify scripts, automations, and software when no existing capability fits.',
    kind: 'coder',
    cost: 'expensive',
    risk: params.isMain ? 'review' : 'review',
    triggerability: params.isMain ? 'auto' : 'explicit',
  });
  entries.push({
    id: 'coder:plan',
    label: 'Coder plan',
    description:
      'Produce an implementation plan first when a request is large, ambiguous, or potentially risky.',
    kind: 'coder',
    cost: 'medium',
    risk: 'safe',
    triggerability: 'explicit',
  });

  return entries;
}

function takeCapabilities(
  capabilities: CapabilityEntry[],
  predicate: (entry: CapabilityEntry) => boolean,
  limit: number,
): CapabilityEntry[] {
  return capabilities.filter(predicate).slice(0, limit);
}

export function formatCapabilitiesText(params: {
  isMain: boolean;
  assistantName: string;
  capabilities: CapabilityEntry[];
}): string {
  const readyNow = takeCapabilities(
    params.capabilities,
    (entry) => entry.kind === 'skill' || entry.kind === 'direct',
    8,
  );
  const adminTools = takeCapabilities(
    params.capabilities,
    (entry) => entry.kind === 'command' && entry.label !== '/capabilities',
    params.isMain ? 8 : 4,
  );
  const buildOnDemand = takeCapabilities(
    params.capabilities,
    (entry) => entry.kind === 'coder' || entry.kind === 'subagent',
    8,
  );

  const lines = [
    `${params.assistantName} capability inventory`,
    '',
    'Already available now:',
    ...readyNow.map((entry) => `- ${entry.label}: ${entry.description}`),
    '',
    params.isMain ? 'Main/admin tools:' : 'Chat commands:',
    ...adminTools.map((entry) => `- ${entry.label}: ${entry.description}`),
    '',
    'Can build for you:',
    ...buildOnDemand.map((entry) => `- ${entry.label}: ${entry.description}`),
    '',
    'Path of least resistance: use what already exists before building something new.',
    'Run /capabilities any time to inspect this inventory again.',
  ];

  return lines.join('\n');
}

export function renderCapabilityRoutingText(params: {
  isMain: boolean;
  assistantName: string;
  capabilities: CapabilityEntry[];
}): string {
  const lines = [
    '## Capability Routing',
    'Path of least resistance: use an existing capability before building anything new.',
    'Order of operations:',
    '1. direct answer if no tool is needed',
    '2. existing skill or built-in capability',
    '3. explicit command or subagent when it already fits',
    '4. coder fallback only when no existing capability fits',
    'Ask for explicit approval before actions that may affect live operations.',
    '',
    'Known capability signals:',
  ];

  for (const entry of params.capabilities.slice(0, 12)) {
    lines.push(`- ${entry.label} [${entry.kind}/${entry.triggerability}/${entry.risk}]`);
  }

  return lines.join('\n');
}
