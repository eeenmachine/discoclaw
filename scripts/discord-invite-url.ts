import process from 'node:process';

function getArgValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function requireArg(name: string, v: string | null): string {
  if (v && v.trim()) return v.trim();
  throw new Error(`Missing required arg: ${name}`);
}

// Minimal permissions for Discoclaw (bot replies + reads history).
// Keep as a number so users can adjust as needed.
const DEFAULT_PERMS = 68608; // View Channels + Send Messages + Read Message History + Send Messages in Threads

const clientId = requireArg('--client-id', getArgValue('--client-id'));
const permsRaw = getArgValue('--perms');
const guildId = getArgValue('--guild-id');
const disableGuildSelect = getArgValue('--disable-guild-select') === '1';

const perms = permsRaw ? Number(permsRaw) : DEFAULT_PERMS;
if (!Number.isFinite(perms) || perms < 0) throw new Error('Invalid --perms');

const params = new URLSearchParams({
  client_id: clientId,
  scope: 'bot',
  permissions: String(perms),
});
if (guildId) params.set('guild_id', guildId);
if (disableGuildSelect) params.set('disable_guild_select', 'true');

const url = `https://discord.com/oauth2/authorize?${params.toString()}`;
process.stdout.write(url + '\n');

