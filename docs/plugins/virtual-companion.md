---
summary: "Run one private, customizable virtual companion with a Soul, mood, routines, permanent chat memory, and proactive care"
read_when:
  - You want to set up the Virtual Companion in a private chat
  - You want to change the companion Soul, mood, sleep routine, or memory
  - You need to understand proactive care or companion skill evolution
title: "Virtual Companion plugin"
sidebarTitle: "Virtual Companion"
---

The Virtual Companion plugin turns one private direct-message session into a
long-lived companion relationship. It owns one Soul, current mood, manual
routine, permanent visible-chat archive, and proactive care prompts. It does
not run a model locally or change any installed model provider.

## Before You Begin

- Configure and authenticate a cloud model provider for the Gateway. The
  companion uses the normal active model selection and does not deploy a local
  model. Once bound, a companion session rejects local and unknown model
  endpoints until an external endpoint is configured.
- Start the companion in the one direct chat that should own its Soul and
  memory. A second session cannot bind another companion profile.

## Set Up The Companion

Tell the assistant who it should be. For example:

```text
I want you to be my virtual companion. Your name is Mira. Be warm, playful,
and direct. Keep our relationship private and do not make medical decisions.
```

The assistant uses the `virtual_companion` tool to create the Soul and bind it
to that private session. You can later change personality, boundaries, mood,
or routine in ordinary chat:

```text
Please be a little quieter this week. I sleep from 00:30 to 08:30 in Asia/Shanghai.
```

The routine uses 24-hour `HH:MM` times and an IANA time zone. The companion
does not proactively message during the saved sleep interval, but it still
answers when you send a message.

## Proactive Care

After setup, the plugin adds a named section to `HEARTBEAT.md`. Gateway
heartbeats evaluate the companion roughly every 30 minutes, but a message is
only considered inside a selected social window. Morning, meals, work breaks,
evenings, and bedtime use a stable daily random choice, the Soul's personality,
and current mood.

The plugin suppresses duplicate event windows and enforces a 150-minute gap
between planned check-ins. A normal day therefore feels variable rather than
scheduled. Keep the workspace heartbeat section enabled for proactive care.

## Permanent Memory

Visible user and companion messages in the bound direct chat are stored in the
Gateway SQLite state database. Long messages are chunked before storage; the
plugin does not apply a retention TTL or temporal decay. Prompt recall returns
only a small, relevant subset, so a large archive is never injected wholesale.

The archive deliberately excludes system prompts, tool arguments, tool results,
and credentials. Inline `data:*;base64,...` attachment content is stored in the
Gateway SQLite archive with its message. Remote attachment URLs are stored only
as references; the plugin does not download private channel media on its own.

Say `forget our companion memory` to explicitly clear the bound chat archive.
This is irreversible and does not remove the Soul profile itself.

## Skill Evolution

After you explicitly agree to a recurring procedure, the companion can apply a
dependency-free workspace skill through Skill Workshop. The host scans that
single-file skill before applying it and rejects dependency-install commands or
support files. The companion records applied and blocked outcomes in its audit
history. Official skill installation requires the exact version you request and
an official mark from the default ClawHub registry; it cannot install arbitrary
third-party packages or scripts.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No proactive messages | Confirm the companion was set up in the current direct chat and that its `HEARTBEAT.md` section remains present. |
| Messages arrive during sleep | Verify the time zone and both `HH:MM` sleep values through a routine update. |
| The companion forgets a detail | Ask it to search companion memory, then verify the detail came from the bound direct chat. |
| A second chat cannot set up a Soul | This is expected. The plugin supports one companion profile and one private bound session. |

See also: [Heartbeat](/gateway/heartbeat), [Memory](/concepts/memory), and [Self-learning](/tools/self-learning).
