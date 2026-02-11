import { splitDiscord, truncateCodeBlocks } from './output-utils.js';
import { NO_MENTIONS } from './allowed-mentions.js';

export function prepareDiscordOutput(text: string): string[] {
  const outText = truncateCodeBlocks(text);
  return splitDiscord(outText);
}

export async function editThenSendChunks(
  reply: { edit: (opts: { content: string; allowedMentions: unknown }) => Promise<unknown> },
  channel: { send: (opts: { content: string; allowedMentions: unknown }) => Promise<unknown> },
  text: string,
): Promise<void> {
  const chunks = prepareDiscordOutput(text);
  await reply.edit({ content: chunks[0] ?? '(no output)', allowedMentions: NO_MENTIONS });
  for (const extra of chunks.slice(1)) {
    await channel.send({ content: extra, allowedMentions: NO_MENTIONS });
  }
}

export async function replyThenSendChunks(
  message: {
    reply: (opts: { content: string; allowedMentions: unknown }) => Promise<unknown>;
    channel: { send: (opts: { content: string; allowedMentions: unknown }) => Promise<unknown> };
  },
  text: string,
): Promise<void> {
  const chunks = prepareDiscordOutput(text);
  await message.reply({ content: chunks[0] ?? '(no output)', allowedMentions: NO_MENTIONS });
  for (const extra of chunks.slice(1)) {
    await message.channel.send({ content: extra, allowedMentions: NO_MENTIONS });
  }
}

export async function sendChunks(
  channel: { send: (opts: { content: string; allowedMentions: unknown }) => Promise<unknown> },
  text: string,
): Promise<void> {
  const chunks = prepareDiscordOutput(text);
  for (const chunk of chunks) {
    if (chunk.trim()) {
      await channel.send({ content: chunk, allowedMentions: NO_MENTIONS });
    }
  }
}
