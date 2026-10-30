import { ConsoleLogger } from '@nestjs/common';

/** One alert per distinct error per window; repeats are counted, not sent. */
const DEDUP_WINDOW_MS = 30 * 60 * 1000;
/** Hard cap so an error storm can't flood the chat (or Telegram's limits). */
const MAX_ALERTS_PER_HOUR = 20;
const MAX_MESSAGE_LENGTH = 3500;
const SEND_TIMEOUT_MS = 5000;

export interface TelegramTarget {
  botToken: string;
  chatId: string;
}

export function telegramTargetFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TelegramTarget | null {
  const botToken = env.TELEGRAM_ALERT_BOT_TOKEN;
  const chatId = env.TELEGRAM_ALERT_CHAT_ID;
  return botToken && chatId ? { botToken, chatId } : null;
}

/**
 * Console logger that also forwards every `error`-level log to Telegram:
 * unhandled 5xx (Nest's ExceptionsHandler), failed sync pushes, S3 failures,
 * cron failures. Without TELEGRAM_ALERT_* it behaves like ConsoleLogger.
 *
 * Alerts are best-effort: sending never throws and never logs at error
 * level (that would alert about alerting).
 */
export class AlertingLogger extends ConsoleLogger {
  private readonly lastSent = new Map<
    string,
    { at: number; repeats: number }
  >();
  private sentThisHour: number[] = [];

  constructor(
    private readonly target: TelegramTarget | null = telegramTargetFromEnv(),
    private readonly environment = process.env.RAILWAY_ENVIRONMENT_NAME ??
      process.env.NODE_ENV ??
      'unknown',
    private readonly send: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    super();
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    super.error(message, ...(optionalParams as [string?, string?]));
    if (this.target) this.alert(message, optionalParams);
  }

  private alert(message: unknown, optionalParams: unknown[]): void {
    // Nest passes the logger's context last; a stack (if any) comes first.
    const params = optionalParams.filter(
      (p): p is string => typeof p === 'string',
    );
    const context = params.length ? params[params.length - 1] : '';
    // `logger.error('Failed to push X', error)` passes the cause as a param.
    const cause = optionalParams.find((p): p is Error => p instanceof Error);
    const stack =
      params.length > 1
        ? params[0]
        : message instanceof Error
          ? message.stack
          : cause?.stack;
    const text = cause
      ? `${describe(message)}\n${describe(cause)}`
      : describe(message);

    const key = `${context}|${text.split('\n')[0]}`;
    const now = this.now();
    const previous = this.lastSent.get(key);
    if (previous && now - previous.at < DEDUP_WINDOW_MS) {
      previous.repeats += 1;
      return;
    }
    this.sentThisHour = this.sentThisHour.filter((t) => now - t < 3600_000);
    if (this.sentThisHour.length >= MAX_ALERTS_PER_HOUR) return;

    const repeats = previous?.repeats ?? 0;
    this.lastSent.set(key, { at: now, repeats: 0 });
    this.sentThisHour.push(now);

    const lines = [
      `🔴 wolog-api [${this.environment}]${context ? ` ${context}` : ''}`,
      text,
    ];
    if (stack && !text.includes(stack)) lines.push(stack);
    if (repeats > 0) {
      lines.push(`(+${repeats} more like this in the last 30 min)`);
    }
    void this.deliver(truncate(lines.join('\n\n')));
  }

  private async deliver(text: string): Promise<void> {
    const { botToken, chatId } = this.target!;
    try {
      const res = await this.send(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        super.warn(`Telegram alert failed: HTTP ${res.status}`, 'Alerts');
      }
    } catch (error) {
      super.warn(`Telegram alert failed: ${describe(error)}`, 'Alerts');
    }
  }
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(text: string): string {
  return text.length > MAX_MESSAGE_LENGTH
    ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…`
    : text;
}
