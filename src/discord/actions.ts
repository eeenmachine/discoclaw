import { ChannelType } from 'discord.js';
import type { Guild } from 'discord.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiscordActionRequest =
  | { type: 'channelCreate'; name: string; parent?: string; topic?: string }
  | { type: 'channelList' };

export type DiscordActionResult =
  | { ok: true; summary: string }
  | { ok: false; error: string };

type LoggerLike = {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const ACTION_RE = /<discord-action>([\s\S]*?)<\/discord-action>/g;

const VALID_TYPES = new Set(['channelCreate', 'channelList']);

export function parseDiscordActions(text: string): { cleanText: string; actions: DiscordActionRequest[] } {
  const actions: DiscordActionRequest[] = [];
  const cleanText = text.replace(ACTION_RE, (_match, json: string) => {
    try {
      const parsed = JSON.parse(json.trim());
      if (parsed && typeof parsed.type === 'string' && VALID_TYPES.has(parsed.type)) {
        actions.push(parsed as DiscordActionRequest);
      }
    } catch {
      // Malformed JSON — skip silently.
    }
    return '';
  });

  return { cleanText, actions };
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeDiscordActions(
  actions: DiscordActionRequest[],
  guild: Guild,
  log?: LoggerLike,
): Promise<DiscordActionResult[]> {
  const results: DiscordActionResult[] = [];

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'channelCreate': {
          let parent: string | undefined;
          if (action.parent) {
            const cat = guild.channels.cache.find(
              (ch) =>
                ch.type === ChannelType.GuildCategory &&
                ch.name.toLowerCase() === action.parent!.toLowerCase(),
            );
            if (cat) {
              parent = cat.id;
            } else {
              results.push({ ok: false, error: `Category "${action.parent}" not found` });
              continue;
            }
          }

          const created = await guild.channels.create({
            name: action.name,
            type: ChannelType.GuildText,
            parent,
            topic: action.topic,
          });
          results.push({ ok: true, summary: `Created #${created.name}${parent ? ` under ${action.parent}` : ''}` });
          log?.info({ channel: created.name, parent: action.parent }, 'discord:action channelCreate');
          break;
        }

        case 'channelList': {
          const grouped = new Map<string, string[]>();
          const uncategorized: string[] = [];

          for (const ch of guild.channels.cache.values()) {
            if (ch.type === ChannelType.GuildCategory) continue;
            const parentName = ch.parent?.name;
            if (parentName) {
              const list = grouped.get(parentName) ?? [];
              list.push(`#${ch.name}`);
              grouped.set(parentName, list);
            } else {
              uncategorized.push(`#${ch.name}`);
            }
          }

          const lines: string[] = [];
          if (uncategorized.length > 0) {
            lines.push(`(no category): ${uncategorized.join(', ')}`);
          }
          for (const [cat, chs] of grouped) {
            lines.push(`${cat}: ${chs.join(', ')}`);
          }
          results.push({ ok: true, summary: lines.length > 0 ? lines.join('\n') : '(no channels)' });
          log?.info({ channelCount: guild.channels.cache.size }, 'discord:action channelList');
          break;
        }

        default: {
          const unknownType = (action as any).type ?? 'unknown';
          results.push({ ok: false, error: `Unknown action type: ${unknownType}` });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ ok: false, error: msg });
      log?.error({ err, action }, 'discord:action failed');
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Prompt section
// ---------------------------------------------------------------------------

export function discordActionsPromptSection(): string {
  return `## Discord Actions

You can perform Discord server actions by including structured action blocks in your response.

### Available actions

**channelCreate** — Create a text channel:
\`\`\`
<discord-action>{"type":"channelCreate","name":"channel-name","parent":"Category Name","topic":"Optional topic"}</discord-action>
\`\`\`
- \`name\` (required): Channel name (lowercase, hyphens, no spaces).
- \`parent\` (optional): Category name to create the channel under.
- \`topic\` (optional): Channel topic description.

**channelList** — List all channels in the server:
\`\`\`
<discord-action>{"type":"channelList"}</discord-action>
\`\`\`

### Rules
- Only \`channelCreate\` and \`channelList\` are supported. You cannot delete channels, manage roles, or perform moderation actions.
- Confirm with the user before creating channels.
- Action blocks are removed from the displayed message; results are appended automatically.

### Permissions
These actions require the bot to have **Manage Channels** permission in this Discord server. This is a server-level role permission, not a Discord Developer Portal setting.

If an action fails with a "Missing Permissions" or "Missing Access" error, tell the user:
1. Open **Server Settings → Roles**.
2. Find the Discoclaw bot's role (usually named after the bot).
3. Enable **Manage Channels** under the role's permissions.
4. The bot may need to be re-invited with the "moderator" permission profile if the role wasn't granted at invite time. The server owner or an admin can also grant it directly via Server Settings → Roles.`;
}
