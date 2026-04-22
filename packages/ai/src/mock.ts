import type { AiContext, AiProvider } from './provider.js';
import { ToolCall } from './tools.js';

// ---------------------------------------------------------------------------
// Deterministic rule-based provider. Used in tests and for local dev without
// API keys. Matches a small set of canned phrases so the end-to-end flow can
// be exercised without network calls. Unrecognized prompts return [].
// ---------------------------------------------------------------------------

const URL_RE = /\bhttps?:\/\/\S+/i;

// "tomorrow at 6pm", "saturday at 11am" — very small subset. If we can't
// fully resolve a time we still return a ToolCall with an explicit window
// starting at `ctx.now` plus an hour, so the preview UI shows a reasonable
// default the user can edit before confirming.
function defaultEvent(ctx: AiContext): { startAt: string; endAt: string } {
  const start = new Date(ctx.now.getTime() + 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

function stripLeading(verb: string, src: string): string {
  return src.replace(new RegExp(`^\\s*${verb}\\s+`, 'i'), '').trim();
}

export class MockProvider implements AiProvider {
  readonly name = 'mock';
  readonly enabled = true;

  async parseIntent(prompt: string, ctx: AiContext): Promise<ToolCall[]> {
    const p = prompt.trim();
    if (!p) return [];

    const urlMatch = p.match(URL_RE);
    if (urlMatch && /\b(import|add)\b.*\brecipe\b/i.test(p)) {
      return [{ tool: 'import_recipe', args: { url: urlMatch[0] } }];
    }
    if (urlMatch && /\brecipe\b/i.test(p)) {
      return [{ tool: 'import_recipe', args: { url: urlMatch[0] } }];
    }

    if (/\b(schedule|create|add|book)\b.*\b(event|meeting|lunch|dinner|appointment)\b/i.test(p)) {
      const title = stripLeading('schedule|create|add|book', p).slice(0, 120) || p.slice(0, 120);
      const { startAt, endAt } = defaultEvent(ctx);
      return [{ tool: 'create_event', args: { title, startAt, endAt } }];
    }

    if (/\b(add|create|make)\b.*\b(todo|task|reminder|to[-\s]?do)\b/i.test(p)) {
      let title = p;
      // Drop leading verb + optional "a" / "an".
      title = title.replace(/^\s*(add|create|make)\s+(a\s+|an\s+)?/i, '');
      // Drop trailing clause like "to the shared todo list", "as a task", etc.
      title = title.replace(
        /\s*(to|on|for|as)\s+(the\s+)?(shared|household|user|personal|my)?\s*(todo|task|reminder|to[-\s]?do)s?(\s+list)?\.?$/i,
        '',
      );
      // Drop leading "task/todo to" pattern: "task to call mom" -> "call mom".
      title = title.replace(/^(a\s+)?(todo|task|reminder|to[-\s]?do)\s*(to|for|:)\s+/i, '');
      // Drop leading "for me:" / "for me to" framing.
      title = title.replace(/^(a\s+)?(todo|task|reminder|to[-\s]?do)\s+(for\s+me)\s*:?\s*/i, '');
      title = title.replace(/^for\s+me\s*:\s*/i, '');
      title = title
        .trim()
        .replace(/^[:,-]\s*/, '')
        .slice(0, 500);
      if (!title) return [];
      const scope: 'household' | 'user' =
        /\b(my|personal|for\s+me)\b/i.test(p) && !/\b(shared|household|family)\b/i.test(p)
          ? 'user'
          : 'household';
      return [{ tool: 'create_todo', args: { title, scope } }];
    }

    return [];
  }
}
