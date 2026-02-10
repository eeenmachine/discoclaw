import type { Client } from 'discord.js';
import type { RuntimeAdapter } from '../runtime/types.js';
import type { CronJob } from './types.js';
import type { StatusPoster } from '../discord/status-channel.js';
import type { LoggerLike } from '../discord/action-types.js';
import type { ActionCategoryFlags } from '../discord/actions.js';
import { resolveChannel } from '../discord/action-utils.js';
import { parseDiscordActions, executeDiscordActions } from '../discord/actions.js';
import { splitDiscord, truncateCodeBlocks } from '../discord.js';

export type CronExecutorContext = {
  client: Client;
  runtime: RuntimeAdapter;
  model: string;
  cwd: string;
  timeoutMs: number;
  status: StatusPoster | null;
  log?: LoggerLike;
  discordActionsEnabled: boolean;
  actionFlags: ActionCategoryFlags;
};

export async function executeCronJob(job: CronJob, ctx: CronExecutorContext): Promise<void> {
  // Overlap guard: skip if previous run is still going.
  if (job.running) {
    ctx.log?.warn({ jobId: job.id, name: job.name }, 'cron:skip (previous run still active)');
    return;
  }
  job.running = true;

  try {
    // Resolve the target channel from the job's owning guild.
    const guild = ctx.client.guilds.cache.get(job.guildId);
    if (!guild) {
      ctx.log?.error({ jobId: job.id, guildId: job.guildId }, 'cron:exec guild not found');
      await ctx.status?.runtimeError({ sessionKey: `cron:${job.id}` }, `Cron "${job.name}": guild ${job.guildId} not found`);
      return;
    }

    const targetChannel = resolveChannel(guild, job.def.channel);
    if (!targetChannel) {
      ctx.log?.error({ jobId: job.id, channel: job.def.channel }, 'cron:exec target channel not found');
      await ctx.status?.runtimeError(
        { sessionKey: `cron:${job.id}`, channelName: job.def.channel },
        `Cron "${job.name}": target channel "${job.def.channel}" not found`,
      );
      return;
    }

    const prompt =
      `You are executing a scheduled cron job named "${job.name}".\n\n` +
      `Instruction: ${job.def.prompt}\n\n` +
      `Post your response to the Discord channel #${job.def.channel}. ` +
      `Keep your response concise and focused on the instruction above.`;

    ctx.log?.info({ jobId: job.id, name: job.name, channel: job.def.channel }, 'cron:exec start');

    let finalText = '';
    let deltaText = '';
    for await (const evt of ctx.runtime.invoke({
      prompt,
      model: ctx.model,
      cwd: ctx.cwd,
      timeoutMs: ctx.timeoutMs,
    })) {
      if (evt.type === 'text_final') {
        finalText = evt.text;
      } else if (evt.type === 'text_delta') {
        deltaText += evt.text;
      } else if (evt.type === 'error') {
        ctx.log?.error({ jobId: job.id, error: evt.message }, 'cron:exec runtime error');
        await ctx.status?.runtimeError(
          { sessionKey: `cron:${job.id}`, channelName: job.def.channel },
          `Cron "${job.name}": ${evt.message}`,
        );
        return;
      }
    }

    const output = finalText || deltaText;
    if (!output.trim()) {
      ctx.log?.warn({ jobId: job.id }, 'cron:exec empty output');
      return;
    }

    let processedText = output;

    // Handle Discord actions if enabled.
    if (ctx.discordActionsEnabled) {
      const { cleanText, actions } = parseDiscordActions(processedText, ctx.actionFlags);
      if (actions.length > 0) {
        const actCtx = {
          guild,
          client: ctx.client,
          channelId: targetChannel.id,
          messageId: '',
        };
        const results = await executeDiscordActions(actions, actCtx, ctx.log);
        const resultLines = results.map((r) => r.ok ? `Done: ${r.summary}` : `Failed: ${r.error}`);
        processedText = cleanText.trimEnd() + '\n\n' + resultLines.join('\n');

        if (ctx.status) {
          for (let i = 0; i < results.length; i++) {
            if (!results[i].ok) {
              await ctx.status.actionFailed(actions[i].type, (results[i] as { ok: false; error: string }).error);
            }
          }
        }
      } else {
        processedText = cleanText;
      }
    }

    // Chunk output like the main message handler (fence-safe splitting).
    const outText = truncateCodeBlocks(processedText);
    const chunks = splitDiscord(outText);
    for (const chunk of chunks) {
      if (chunk.trim()) {
        await targetChannel.send(chunk);
      }
    }

    ctx.log?.info({ jobId: job.id, name: job.name, channel: job.def.channel }, 'cron:exec done');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.log?.error({ err, jobId: job.id }, 'cron:exec failed');
    await ctx.status?.runtimeError(
      { sessionKey: `cron:${job.id}`, channelName: job.def.channel },
      `Cron "${job.name}": ${msg}`,
    );
  } finally {
    job.running = false;
  }
}
