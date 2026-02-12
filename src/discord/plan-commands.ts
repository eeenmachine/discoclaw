import fs from 'node:fs/promises';
import path from 'node:path';
import { bdCreate, bdClose, bdUpdate, bdAddLabel } from '../beads/bd-cli.js';
import type { BeadData } from '../beads/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlanCommand = {
  action: 'help' | 'create' | 'list' | 'show' | 'approve' | 'close';
  args: string;
};

export type PlanFileHeader = {
  planId: string;
  beadId: string;
  status: string;
  title: string;
  project: string;
  created: string;
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const RESERVED_SUBCOMMANDS = new Set(['list', 'show', 'approve', 'close', 'help']);

export function parsePlanCommand(content: string): PlanCommand | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('!plan')) return null;

  const rest = trimmed.slice('!plan'.length).trim();

  // No args → help
  if (!rest) return { action: 'help', args: '' };

  // Check reserved subcommands
  const firstWord = rest.split(/\s+/)[0]!.toLowerCase();
  if (RESERVED_SUBCOMMANDS.has(firstWord)) {
    const subArgs = rest.slice(firstWord.length).trim();
    return { action: firstWord as PlanCommand['action'], args: subArgs };
  }

  // Everything else is a create description
  return { action: 'create', args: rest };
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

export function toSlug(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
}

// ---------------------------------------------------------------------------
// Plan file header parsing
// ---------------------------------------------------------------------------

export function parsePlanFileHeader(content: string): PlanFileHeader | null {
  const titleMatch = content.match(/^# Plan:\s*(.+)$/m);
  const idMatch = content.match(/^\*\*ID:\*\*\s*(.+)$/m);
  const beadMatch = content.match(/^\*\*Bead:\*\*\s*(.+)$/m);
  const statusMatch = content.match(/^\*\*Status:\*\*\s*(.+)$/m);
  const projectMatch = content.match(/^\*\*Project:\*\*\s*(.+)$/m);
  const createdMatch = content.match(/^\*\*Created:\*\*\s*(.+)$/m);

  if (!idMatch) return null;

  return {
    planId: idMatch[1]!.trim(),
    beadId: beadMatch?.[1]?.trim() ?? '',
    status: statusMatch?.[1]?.trim() ?? '',
    title: titleMatch?.[1]?.trim() ?? '',
    project: projectMatch?.[1]?.trim() ?? '',
    created: createdMatch?.[1]?.trim() ?? '',
  };
}

// ---------------------------------------------------------------------------
// Plan file utilities
// ---------------------------------------------------------------------------

async function ensurePlansDir(plansDir: string): Promise<void> {
  await fs.mkdir(plansDir, { recursive: true });
}

async function getNextPlanNumber(plansDir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(plansDir);
  } catch {
    return 1;
  }

  let max = 0;
  for (const entry of entries) {
    const match = entry.match(/^plan-(\d+)/);
    if (match) {
      const num = parseInt(match[1]!, 10);
      if (num > max) max = num;
    }
  }
  return max + 1;
}

async function findPlanFile(plansDir: string, id: string): Promise<{ filePath: string; header: PlanFileHeader } | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(plansDir);
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.md') || entry.startsWith('.')) continue;
    const filePath = path.join(plansDir, entry);
    const content = await fs.readFile(filePath, 'utf-8');
    const header = parsePlanFileHeader(content);
    if (!header) continue;
    if (header.planId === id || header.beadId === id) {
      return { filePath, header };
    }
  }
  return null;
}

async function updatePlanStatus(filePath: string, newStatus: string): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8');
  const updated = content.replace(
    /^\*\*Status:\*\*\s*.+$/m,
    `**Status:** ${newStatus}`,
  );
  await fs.writeFile(filePath, updated, 'utf-8');
}

// ---------------------------------------------------------------------------
// Inline fallback template (used when .plan-template.md is missing)
// ---------------------------------------------------------------------------

const FALLBACK_TEMPLATE = `# Plan: {{TITLE}}

**ID:** {{PLAN_ID}}
**Bead:** {{BEAD_ID}}
**Created:** {{DATE}}
**Status:** DRAFT
**Project:** {{PROJECT}}

---

## Objective

_Describe the objective here._

## Scope

_Define what's in and out of scope._

## Changes

_List file-by-file changes._

## Risks

_Identify risks._

## Testing

_How to verify._

---

## Audit Log

_Audit notes go here._

---

## Implementation Notes

_Filled in during/after implementation._
`;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export type HandlePlanCommandOpts = {
  workspaceCwd: string;
  beadsCwd: string;
};

export async function handlePlanCommand(
  cmd: PlanCommand,
  opts: HandlePlanCommandOpts,
): Promise<string> {
  const plansDir = path.join(opts.workspaceCwd, 'plans');

  try {
    if (cmd.action === 'help') {
      return [
        '**!plan commands:**',
        '- `!plan <description>` — create a new plan',
        '- `!plan list` — list active plans',
        '- `!plan show <plan-id|bead-id>` — show plan details',
        '- `!plan approve <plan-id|bead-id>` — approve for implementation',
        '- `!plan close <plan-id|bead-id>` — close/abandon a plan',
      ].join('\n');
    }

    if (cmd.action === 'create') {
      if (!cmd.args) return 'Usage: `!plan <description>`';

      await ensurePlansDir(plansDir);

      const num = await getNextPlanNumber(plansDir);
      const planId = `plan-${String(num).padStart(3, '0')}`;
      const slug = toSlug(cmd.args);
      const fileName = `${planId}-${slug}.md`;
      const filePath = path.join(plansDir, fileName);
      const date = new Date().toISOString().split('T')[0]!;

      // Create backing bead
      let bead: BeadData;
      try {
        bead = await bdCreate(
          { title: cmd.args, labels: ['plan'] },
          opts.beadsCwd,
        );
      } catch (err) {
        return `Failed to create backing bead: ${String(err)}`;
      }

      // Load template or use fallback
      let template: string;
      const templatePath = path.join(plansDir, '.plan-template.md');
      try {
        template = await fs.readFile(templatePath, 'utf-8');
      } catch {
        template = FALLBACK_TEMPLATE;
      }

      // Fill template
      const content = template
        .replace(/\{\{TITLE\}\}/g, cmd.args)
        .replace(/\{\{PLAN_ID\}\}/g, planId)
        .replace(/\{\{BEAD_ID\}\}/g, bead.id)
        .replace(/\{\{DATE\}\}/g, date)
        .replace(/\{\{PROJECT\}\}/g, 'discoclaw')
        // Set status to DRAFT (remove the options list)
        .replace(
          /\*\*Status:\*\*\s*DRAFT\s*\|[^\n]*/,
          '**Status:** DRAFT',
        );

      await fs.writeFile(filePath, content, 'utf-8');

      return [
        `Plan created: **${planId}** (bead: \`${bead.id}\`)`,
        `File: \`workspace/plans/${fileName}\``,
        `Description: ${cmd.args}`,
      ].join('\n');
    }

    if (cmd.action === 'list') {
      let entries: string[];
      try {
        entries = await fs.readdir(plansDir);
      } catch {
        return 'No plans directory found.';
      }

      const plans: PlanFileHeader[] = [];
      for (const entry of entries) {
        if (!entry.endsWith('.md') || entry.startsWith('.')) continue;
        try {
          const content = await fs.readFile(path.join(plansDir, entry), 'utf-8');
          const header = parsePlanFileHeader(content);
          if (header) plans.push(header);
        } catch {
          // skip unreadable files
        }
      }

      if (plans.length === 0) return 'No plans found.';

      // Sort by planId
      plans.sort((a, b) => a.planId.localeCompare(b.planId));

      const lines = plans.map(
        (p) => `- \`${p.planId}\` [${p.status}] — ${p.title}${p.beadId ? ` (bead: \`${p.beadId}\`)` : ''}`,
      );
      return lines.join('\n');
    }

    if (cmd.action === 'show') {
      if (!cmd.args) return 'Usage: `!plan show <plan-id|bead-id>`';

      const found = await findPlanFile(plansDir, cmd.args);
      if (!found) return `Plan not found: ${cmd.args}`;

      const content = await fs.readFile(found.filePath, 'utf-8');

      // Extract objective section
      const objMatch = content.match(/## Objective\s*\n([\s\S]*?)(?=\n## |\n---)/);
      const objective = objMatch?.[1]?.trim() || '(no objective)';

      // Extract latest audit verdict
      const verdicts = [...content.matchAll(/#### Verdict\s*\n([\s\S]*?)(?=\n###|\n---|\n$)/g)];
      const latestVerdict = verdicts.length > 0
        ? verdicts[verdicts.length - 1]![1]!.trim()
        : '(no audit yet)';

      return [
        `**${found.header.planId}** — ${found.header.title}`,
        `Status: ${found.header.status}`,
        `Bead: \`${found.header.beadId}\``,
        `Project: ${found.header.project}`,
        `Created: ${found.header.created}`,
        '',
        `**Objective:** ${objective}`,
        '',
        `**Latest audit:** ${latestVerdict}`,
      ].join('\n');
    }

    if (cmd.action === 'approve') {
      if (!cmd.args) return 'Usage: `!plan approve <plan-id|bead-id>`';

      const found = await findPlanFile(plansDir, cmd.args);
      if (!found) return `Plan not found: ${cmd.args}`;

      await updatePlanStatus(found.filePath, 'APPROVED');

      // Update backing bead to in_progress
      if (found.header.beadId) {
        try {
          await bdUpdate(found.header.beadId, { status: 'in_progress' }, opts.beadsCwd);
        } catch {
          // best-effort — bead update failure shouldn't block approval
        }
      }

      return `Plan **${found.header.planId}** approved for implementation.`;
    }

    if (cmd.action === 'close') {
      if (!cmd.args) return 'Usage: `!plan close <plan-id|bead-id>`';

      const found = await findPlanFile(plansDir, cmd.args);
      if (!found) return `Plan not found: ${cmd.args}`;

      await updatePlanStatus(found.filePath, 'CLOSED');

      // Close backing bead
      if (found.header.beadId) {
        try {
          await bdClose(found.header.beadId, 'Plan closed', opts.beadsCwd);
        } catch {
          // best-effort
        }
      }

      return `Plan **${found.header.planId}** closed.`;
    }

    return 'Unknown plan command. Try `!plan` for help.';
  } catch (err) {
    return `Plan command error: ${String(err)}`;
  }
}
