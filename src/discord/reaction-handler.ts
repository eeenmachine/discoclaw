import fs from 'node:fs/promises';
import path from 'node:path';
import type { MessageReaction, PartialMessageReaction, User, PartialUser } from 'discord.js';
import type { BotParams, StatusRef } from '../discord.js';
import { splitDiscord, truncateCodeBlocks } from '../discord.js';
import type { KeyedQueue } from '../group-queue.js';
import { isAllowlisted } from './allowlist.js';
import { discordSessionKey } from './session-key.js';
import { ensureIndexedDiscordChannelContext, resolveDiscordChannelContext } from './channel-context.js';
import { parseDiscordActions, executeDiscordActions, discordActionsPromptSection } from './actions.js';
import type { ActionCategoryFlags } from './actions.js';
import { NO_MENTIONS } from './allowed-mentions.js';
import { loadDurableMemory, selectItemsForInjection, formatDurableSection } from './durable-memory.js';
import { loadWorkspacePermissions, resolveTools } from '../workspace-permissions.js';
import type { LoggerLike } from './action-types.js';

type QueueLike = Pick<KeyedQueue, 'run'>;

function groupDirNameFromSessionKey(sessionKey: string): string {
  return sessionKey.replace(/[^a-zA-Z0-9:_-]+/g, '-');
}

async function ensureGroupDir(groupsDir: string, sessionKey: string): Promise<string> {
  const dir = path.join(groupsDir, groupDirNameFromSessionKey(sessionKey));
  await fs.mkdir(dir, { recursive: true });
  const claudeMd = path.join(dir, 'CLAUDE.md');
  try {
    await fs.stat(claudeMd);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
    const body =
      `# Discoclaw Group\n\n` +
      `Session key: \`${sessionKey}\`\n\n` +
      `This directory scopes conversation instructions for this Discord context.\n\n` +
      `Notes:\n` +
      `- The main workspace is mounted separately (see Discoclaw service env).\n` +
      `- Keep instructions short and specific; prefer referencing files in the workspace.\n`;
    await fs.writeFile(claudeMd, body, 'utf8');
  }
  return dir;
}

export function createReactionAddHandler(
  params: Omit<BotParams, 'token'>,
  queue: QueueLike,
  statusRef?: StatusRef,
): (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => Promise<void> {
  return async (reaction, user) => {
    try {
      // 1. Self-reaction guard — prevent infinite loops from bot's own reactions.
      if (user.id === reaction.message.client.user?.id) return;

      // 2. Fetch partials.
      try {
        if (reaction.partial) await reaction.fetch();
      } catch (err) {
        params.log?.warn({ err }, 'reaction:partial fetch failed (reaction)');
        return;
      }
      try {
        if (reaction.message.partial) await reaction.message.fetch();
      } catch (err) {
        params.log?.warn({ err }, 'reaction:partial fetch failed (message)');
        return;
      }

      // 3. Guild-only — skip DM reactions.
      if (reaction.message.guildId == null) return;

      // 4. Staleness guard.
      const msgTimestamp = reaction.message.createdTimestamp;
      if (msgTimestamp && params.reactionMaxAgeMs > 0) {
        const age = Date.now() - msgTimestamp;
        if (age > params.reactionMaxAgeMs) return;
      }

      // 5. Allowlist check.
      if (!isAllowlisted(params.allowUserIds, user.id)) return;

      // 6. Channel restriction.
      if (params.allowChannelIds) {
        const ch: any = reaction.message.channel as any;
        const isThread = typeof ch?.isThread === 'function' ? ch.isThread() : false;
        const parentId = isThread ? String(ch.parentId ?? '') : '';
        const allowed =
          params.allowChannelIds.has(reaction.message.channelId) ||
          (parentId && params.allowChannelIds.has(parentId));
        if (!allowed) return;
      }

      // 7. Session key.
      const ch: any = reaction.message.channel as any;
      const isThread = typeof ch?.isThread === 'function' ? ch.isThread() : false;
      const threadId = isThread ? String(ch.id ?? '') : null;
      const threadParentId = isThread ? String(ch.parentId ?? '') : null;
      const sessionKey = discordSessionKey({
        channelId: reaction.message.channelId,
        authorId: user.id,
        isDm: false,
        threadId: threadId || null,
      });

      // 8. Queue.
      await queue.run(sessionKey, async () => {
        try {
          // Join thread if needed.
          if (params.autoJoinThreads && isThread) {
            const th: any = reaction.message.channel as any;
            const joinable = typeof th?.joinable === 'boolean' ? th.joinable : true;
            const joined = typeof th?.joined === 'boolean' ? th.joined : false;
            if (joinable && !joined && typeof th?.join === 'function') {
              try {
                await th.join();
                params.log?.info({ threadId: String(th.id ?? ''), parentId: String(th.parentId ?? '') }, 'reaction:thread joined');
              } catch (err) {
                params.log?.warn({ err, threadId: String(th?.id ?? '') }, 'reaction:thread failed to join');
              }
            }
          }

          const cwd = params.useGroupDirCwd
            ? await ensureGroupDir(params.groupsDir, sessionKey)
            : params.workspaceCwd;

          // Auto-index channel context.
          if (params.discordChannelContext && params.autoIndexChannelContext) {
            const id = (threadParentId && threadParentId.trim()) ? threadParentId : reaction.message.channelId;
            const chName = String((ch as any)?.name ?? (ch as any)?.parent?.name ?? '').trim();
            try {
              await ensureIndexedDiscordChannelContext({
                ctx: params.discordChannelContext,
                channelId: id,
                channelName: chName || undefined,
                log: params.log,
              });
            } catch (err) {
              params.log?.error({ err, channelId: id }, 'reaction:context failed to ensure channel context');
            }
          }

          const channelCtx = resolveDiscordChannelContext({
            ctx: params.discordChannelContext,
            isDm: false,
            channelId: reaction.message.channelId,
            threadParentId,
          });

          if (params.requireChannelContext && !channelCtx.contextPath) {
            params.log?.warn({ channelId: channelCtx.channelId }, 'reaction:missing required channel context');
            return;
          }

          // Build context file list.
          const paFileNames = ['SOUL.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md'];
          const bootstrapPath = path.join(params.workspaceCwd, 'BOOTSTRAP.md');
          const paFiles: string[] = [];
          try { await fs.access(bootstrapPath); paFiles.push(bootstrapPath); } catch { /* no bootstrap */ }
          for (const f of paFileNames) {
            const p = path.join(params.workspaceCwd, f);
            try { await fs.access(p); paFiles.push(p); } catch { /* skip missing */ }
          }

          const contextFiles: string[] = [...paFiles];
          if (params.discordChannelContext) {
            contextFiles.push(...params.discordChannelContext.baseFiles);
          }
          if (channelCtx.contextPath) contextFiles.push(channelCtx.contextPath);

          // Load durable memory.
          let durableSection = '';
          if (params.durableMemoryEnabled) {
            try {
              const store = await loadDurableMemory(params.durableDataDir, user.id);
              if (store) {
                const items = selectItemsForInjection(store, params.durableInjectMaxChars);
                if (items.length > 0) durableSection = formatDurableSection(items);
              }
            } catch (err) {
              params.log?.warn({ err, userId: user.id }, 'reaction:durable memory load failed');
            }
          }

          // Build prompt.
          const emoji = reaction.emoji.name ?? '(unknown)';
          const msg = reaction.message;
          const messageContent = String(msg.content ?? '').slice(0, 1500);
          const messageAuthor = msg.author?.displayName || msg.author?.username || 'Unknown';
          const messageAuthorId = msg.author?.id ?? 'unknown';
          const reactingUser = (user as any).displayName || (user as any).username || 'Unknown';

          // Channel label.
          let channelLabel: string;
          if (isThread) {
            const threadName = String(ch?.name ?? 'unknown');
            const parentName = String(ch?.parent?.name ?? 'unknown');
            channelLabel = `thread ${threadName} in #${parentName}`;
          } else {
            channelLabel = `#${channelCtx.channelName ?? 'unknown'}`;
          }

          let prompt =
            `Context files (read with Read tool before responding, in order):\n` +
            contextFiles.map((p) => `- ${p}`).join('\n') +
            (durableSection
              ? `\n\n---\nDurable memory (user-specific notes):\n${durableSection}\n`
              : '') +
            `\n\n---\nReaction event:\n` +
            `${reactingUser} (ID: ${user.id}) reacted with ${emoji} to a message in ${channelLabel}.\n\n` +
            `Original message by ${messageAuthor} (ID: ${messageAuthorId}):\n` +
            messageContent;

          // Attachments.
          if (msg.attachments && msg.attachments.size > 0) {
            const urls = [...msg.attachments.values()].map((a) => a.url).join(', ');
            prompt += `\nAttachments: ${urls}`;
          }

          // Embeds.
          if (msg.embeds && msg.embeds.length > 0) {
            const embedInfos = msg.embeds.map((e) => {
              const parts: string[] = [];
              if (e.title) parts.push(e.title);
              if (e.url) parts.push(e.url);
              return parts.join(' ') || '(embed)';
            });
            prompt += `\nEmbeds: ${embedInfos.join(', ')}`;
          }

          prompt += `\n\nRespond based on your identity and context. The reaction signals the user wants you to engage with this message. Your response will be posted as a reply.`;

          const actionFlags: ActionCategoryFlags = {
            channels: params.discordActionsChannels,
            messaging: params.discordActionsMessaging,
            guild: params.discordActionsGuild,
            moderation: params.discordActionsModeration,
            polls: params.discordActionsPolls,
            beads: params.discordActionsBeads,
            crons: params.discordActionsCrons ?? false,
          };

          if (params.discordActionsEnabled) {
            prompt += '\n\n---\n' + discordActionsPromptSection(actionFlags);
          }

          const addDirs: string[] = [];
          if (params.useGroupDirCwd) addDirs.push(params.workspaceCwd);
          if (params.discordChannelContext) addDirs.push(params.discordChannelContext.contentDir);

          const permissions = await loadWorkspacePermissions(params.workspaceCwd, params.log);
          const effectiveTools = resolveTools(permissions, params.runtimeTools);
          if (permissions?.note) {
            prompt += `\n\n---\nPermission note: ${permissions.note}\n`;
          }

          // Session continuity.
          const sessionId = params.useRuntimeSessions
            ? await params.sessionManager.getOrCreate(sessionKey)
            : null;

          params.log?.info(
            {
              sessionKey,
              sessionId,
              cwd,
              emoji,
              userId: user.id,
              messageId: msg.id,
              model: params.runtimeModel,
              toolsCount: effectiveTools.length,
              channelId: channelCtx.channelId,
              channelName: channelCtx.channelName,
              hasChannelContext: Boolean(channelCtx.contextPath),
              permissionTier: permissions?.tier ?? 'env',
            },
            'reaction:invoke:start',
          );

          // Non-streaming collect pattern (like cron executor).
          let finalText = '';
          let deltaText = '';
          for await (const evt of params.runtime.invoke({
            prompt,
            model: params.runtimeModel,
            cwd,
            addDirs: addDirs.length > 0 ? Array.from(new Set(addDirs)) : undefined,
            sessionId,
            sessionKey,
            tools: effectiveTools,
            timeoutMs: params.runtimeTimeoutMs,
          })) {
            if (evt.type === 'text_final') {
              finalText = evt.text;
            } else if (evt.type === 'text_delta') {
              deltaText += evt.text;
            } else if (evt.type === 'error') {
              params.log?.error({ sessionKey, error: evt.message }, 'reaction:runtime error');
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              statusRef?.current?.runtimeError({ sessionKey, channelName: channelCtx.channelName }, evt.message);
              return;
            }
          }

          let processedText = finalText || deltaText || '(no output)';

          params.log?.info({ sessionKey, sessionId }, 'reaction:invoke:end');

          // Parse and execute Discord actions.
          if (params.discordActionsEnabled && msg.guild) {
            const parsed = parseDiscordActions(processedText, actionFlags);
            if (parsed.actions.length > 0) {
              const actCtx = {
                guild: msg.guild,
                client: msg.client,
                channelId: msg.channelId,
                messageId: msg.id,
              };
              const results = await executeDiscordActions(parsed.actions, actCtx, params.log, params.beadCtx, params.cronCtx);
              const resultLines = results.map((r) => r.ok ? `Done: ${r.summary}` : `Failed: ${r.error}`);
              processedText = parsed.cleanText.trimEnd() + '\n\n' + resultLines.join('\n');

              if (statusRef?.current) {
                for (let i = 0; i < results.length; i++) {
                  if (!results[i].ok) {
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    statusRef.current.actionFailed(parsed.actions[i].type, (results[i] as { ok: false; error: string }).error);
                  }
                }
              }
            } else {
              processedText = parsed.cleanText;
            }
          }

          // Format and post reply.
          const outText = truncateCodeBlocks(processedText);
          const chunks = splitDiscord(outText);

          await msg.reply({ content: chunks[0] ?? '(no output)', allowedMentions: NO_MENTIONS });
          for (const extra of chunks.slice(1)) {
            await (msg.channel as any).send({ content: extra, allowedMentions: NO_MENTIONS });
          }
        } catch (err) {
          params.log?.error({ err, sessionKey }, 'reaction:handler failed');
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          statusRef?.current?.handlerError({ sessionKey }, err);
        }
      });
    } catch (err) {
      params.log?.error({ err }, 'reaction:messageReactionAdd failed');
    }
  };
}
