import { ChannelType } from 'discord.js';
import type { CategoryChannel, Client, Guild, GuildBasedChannel } from 'discord.js';
import type { LoggerLike } from './action-types.js';

export type SystemScaffold = {
  guildId: string;
  systemCategoryId: string;
  statusChannelId?: string;
  cronsForumId?: string;
  beadsForumId?: string;
};

function norm(s: string): string {
  return (s ?? '').trim().toLowerCase();
}

function isSnowflake(s: string): boolean {
  return /^\d{8,}$/.test((s ?? '').trim());
}

export function selectBootstrapGuild(
  client: Client,
  guildIdFromEnv: string | undefined,
  log?: LoggerLike,
): Guild | null {
  const gid = (guildIdFromEnv ?? '').trim();
  if (gid) {
    const g = client.guilds.cache.get(gid) ?? null;
    if (!g) log?.warn({ guildId: gid }, 'system-bootstrap: guild not found; skipping');
    return g;
  }

  const guilds = [...client.guilds.cache.values()];
  if (guilds.length === 1) return guilds[0] ?? null;

  log?.warn(
    { guildCount: guilds.length },
    'system-bootstrap: multiple guilds (or none) and DISCORD_GUILD_ID not set; skipping',
  );
  return null;
}

async function tryFetchChannel(guild: Guild, id: string): Promise<GuildBasedChannel | null> {
  const trimmed = (id ?? '').trim();
  if (!trimmed || !isSnowflake(trimmed)) return null;
  try {
    const fetched = await guild.channels.fetch(trimmed);
    return (fetched as GuildBasedChannel) ?? null;
  } catch {
    return null;
  }
}

function findByNameAndType(
  guild: Guild,
  name: string,
  type: ChannelType,
): GuildBasedChannel | null {
  const want = norm(name);
  const ch = guild.channels.cache.find((c) => c.type === type && norm(c.name) === want);
  return (ch as GuildBasedChannel) ?? null;
}

function findAnyByName(
  guild: Guild,
  name: string,
): GuildBasedChannel[] {
  const want = norm(name);
  const out: GuildBasedChannel[] = [];
  for (const c of guild.channels.cache.values()) {
    if (norm((c as any)?.name ?? '') === want) out.push(c as GuildBasedChannel);
  }
  return out;
}

async function moveUnderCategory(
  ch: GuildBasedChannel,
  parentCategoryId: string,
  log?: LoggerLike,
): Promise<boolean> {
  const current = String((ch as any)?.parentId ?? '');
  if (current === parentCategoryId) return false;
  try {
    if (typeof (ch as any).setParent === 'function') {
      await (ch as any).setParent(parentCategoryId);
    } else if (typeof (ch as any).edit === 'function') {
      await (ch as any).edit({ parent: parentCategoryId });
    } else {
      return false;
    }
    return true;
  } catch (err) {
    log?.warn({ err, channelId: (ch as any)?.id, name: (ch as any)?.name }, 'system-bootstrap: failed to move channel');
    return false;
  }
}

export async function ensureSystemCategory(guild: Guild, log?: LoggerLike): Promise<CategoryChannel | null> {
  const existing = findByNameAndType(guild, 'System', ChannelType.GuildCategory) as CategoryChannel | null;
  if (existing) return existing;
  try {
    const created = await guild.channels.create({
      name: 'System',
      type: ChannelType.GuildCategory,
    } as any);
    return created as CategoryChannel;
  } catch (err) {
    log?.warn({ err }, 'system-bootstrap: failed to create System category');
    return null;
  }
}

async function ensureChild(
  guild: Guild,
  parentCategoryId: string,
  spec: { name: string; type: ChannelType.GuildText | ChannelType.GuildForum; topic?: string },
  log?: LoggerLike,
): Promise<{ id?: string; created: boolean; moved: boolean }> {
  const exact = findByNameAndType(guild, spec.name, spec.type);
  if (exact) {
    const moved = await moveUnderCategory(exact, parentCategoryId, log);
    return { id: String((exact as any).id ?? ''), created: false, moved };
  }

  const nameClash = findAnyByName(guild, spec.name).filter((c) => c.type !== spec.type);
  if (nameClash.length > 0) {
    log?.warn(
      { name: spec.name, wantType: ChannelType[spec.type], foundTypes: nameClash.map((c) => ChannelType[(c as any).type] ?? String((c as any).type)) },
      'system-bootstrap: name exists with different type; skipping creation',
    );
    return { created: false, moved: false };
  }

  try {
    const created = await guild.channels.create({
      name: spec.name,
      type: spec.type,
      parent: parentCategoryId,
      topic: spec.topic,
    } as any);
    return { id: String((created as any)?.id ?? ''), created: true, moved: false };
  } catch (err) {
    log?.warn({ err, name: spec.name, type: ChannelType[spec.type] }, 'system-bootstrap: failed to create channel');
    return { created: false, moved: false };
  }
}

export async function ensureSystemScaffold(
  params: { guild: Guild; ensureBeads: boolean },
  log?: LoggerLike,
): Promise<SystemScaffold | null> {
  const { guild, ensureBeads } = params;

  const system = await ensureSystemCategory(guild, log);
  if (!system) return null;

  const created: string[] = [];
  const moved: string[] = [];

  const status = await ensureChild(
    guild,
    system.id,
    { name: 'status', type: ChannelType.GuildText, topic: 'Discoclaw status (online/offline/errors).' },
    log,
  );
  if (status.created) created.push('status');
  if (status.moved) moved.push('status');

  const crons = await ensureChild(
    guild,
    system.id,
    { name: 'crons', type: ChannelType.GuildForum, topic: 'Cron jobs (one thread per job).' },
    log,
  );
  if (crons.created) created.push('crons');
  if (crons.moved) moved.push('crons');

  let beads: { id?: string; created: boolean; moved: boolean } | null = null;
  if (ensureBeads) {
    beads = await ensureChild(
      guild,
      system.id,
      { name: 'beads', type: ChannelType.GuildForum, topic: 'Beads (one thread per bead).' },
      log,
    );
    if (beads.created) created.push('beads');
    if (beads.moved) moved.push('beads');
  }

  if (created.length > 0 || moved.length > 0) {
    log?.info(
      {
        guildId: guild.id,
        systemCategoryId: system.id,
        created,
        moved,
      },
      'system-bootstrap:ensured',
    );
  }

  const result: SystemScaffold = {
    guildId: guild.id,
    systemCategoryId: system.id,
  };
  if (status.id) result.statusChannelId = status.id;
  if (crons.id) result.cronsForumId = crons.id;
  if (beads?.id) result.beadsForumId = beads.id;
  return result;
}

